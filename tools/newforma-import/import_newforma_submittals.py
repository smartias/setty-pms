#!/usr/bin/env python3
"""Refresh the PMS submittal log from a Newforma "Multi-Project Report" (Submittal Log) export.

Reads the .xlsx Newforma produces (one header row per submittal, followed by its
workflow rows and its attachment rows), maps each submittal onto the PMS
submittal record shape (the same mapping the 2026-06-23 import used), matches it
against what is already logged on the project by item number, and writes:

  * a PATCH (jsonb merge) for every existing record that came from Newforma
    (id "nf-sub-…" or source "newforma") — Newforma is the system of record
    for those during the cutover, so its fields overwrite; human-edited notes
    are left alone, and comments are only overwritten when Newforma has some;
  * a FILL for records logged by hand or by the Forma/Procore sync that share
    a number — only blank fields are filled, nothing is overwritten;
  * an APPEND for numbers not logged yet.

It never deletes and never touches assignedTo / links / aiReview / spFolderUrl.

Usage:
  import_newforma_submittals.py REPORT.xlsx --targets targets.json --existing existing.json --out plan/
     targets.json  : { "<report project number>": {"id": "<pms row id>", "projectNumber": "<pms number>"} }
     existing.json : snapshot of the logged submittals per PMS project number (see README for the SQL)
     plan/         : one .sql per project (version-guarded UPDATE) plus summary.json
  Add --apply with SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment to read the live
  rows over PostgREST and write them back with the same version guard the app uses.
"""
import argparse, collections, datetime, json, os, re, sys, urllib.request

SOURCE_FILE = None  # set from the report filename

STAMP_BY_ACTION = {
    "accepted as noted": "Approved as Noted", "reviewed as noted": "Approved as Noted",
    "furnish as corrected": "Approved as Noted", "make correction noted": "Approved as Noted",
    "make corrections noted": "Approved as Noted",
    "revise and resubmit": "Revise and Resubmit", "reviewed and resubmit": "Revise and Resubmit",
    "partial resubmittal": "Revise and Resubmit",
    "accepted": "Approved", "no exceptions taken": "Approved", "reviewed": "Approved",
    "rejected": "Rejected",
}
DISCIPLINES = {"mechanical": "Mechanical", "hvac": "Mechanical", "electrical": "Electrical",
               "plumbing": "Plumbing", "fire protection": "Fire Protection", "structural": "Structural",
               "architectural": "Architectural", "civil": "Civil", "technology": "Technology"}
# Fields Newforma owns on a Newforma-origin record (overwritten on refresh).
OWNED = ["description", "specSection", "from", "discipline", "status", "stamp",
         "dateReceived", "dueDate", "dateReturned", "resubNumber", "source"]
BLANK_FLAG = {"D": "description", "S": "specSection", "F": "from", "I": "discipline", "T": "status",
              "M": "stamp", "R": "dateReceived", "U": "dueDate", "E": "dateReturned", "C": "comments", "N": "notes"}


def d(v):
    """Excel cell -> YYYY-MM-DD or ''."""
    if v in (None, ""): return ""
    if isinstance(v, datetime.datetime): return v.strftime("%Y-%m-%d")
    s = str(v)
    return s[:10] if re.match(r"\d{4}-\d{2}-\d{2}", s) else s


def clean_number(v):
    return re.sub(r"\.+$", "", str(v or "").strip())


def forma_key(number):
    """'233423-098-3' -> ('forma', 98, 3): the Forma sync logs that item as SUB-098 rev 3."""
    parts = clean_number(number).split("-")
    if len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
        return ("forma", int(parts[1]), int(parts[2]))
    return None


def norm_key(number):
    """'232113-012-1', '232113-12-01', '232113-012-1.' and '232113-012-1 ' all collapse to one key."""
    parts = clean_number(number).lower().split("-")
    head = parts[0]
    tail = tuple(int(p) if p.isdigit() else p for p in parts[1:])
    return (head,) + tail


def map_discipline(raw):
    s = str(raw or "").strip().lower()
    if not s: return "Other"
    names = [x.strip() for x in s.split(",") if x.strip()]
    mapped = [DISCIPLINES.get(n) for n in names]
    if len(mapped) == 1 and mapped[0]: return mapped[0]
    if len(mapped) > 1 and all(mapped): return "Multi-Discipline"
    return "Other"


def parse_report(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and r[0] == "Project" and r[3] == "ID")
    hdr = list(rows[hi])
    subs, cur = [], None
    for r in rows[hi + 1:]:
        if r is None or all(v in (None, "") for v in r): continue
        rec = {hdr[i]: r[i] for i in range(min(len(hdr), len(r)))}
        if rec.get("Project"):            # a submittal header row
            cur = {"head": rec, "workflow": []}
            subs.append(cur)
            continue
        if cur is None: continue
        # workflow rows reuse the header columns positionally:
        # Project Number=ID, Project Manager=Type, ID=Action, Sender ID=Date, Package ID=From, Spec Section=To, Subject=Due, Discipline=Remarks
        typ = rec.get("Project Manager")
        if typ in ("Received", "Forwarded", "Review Response", "Closed", "Sent", "Expected", "Pending", "Responded"):
            cur["workflow"].append({"type": typ, "action": rec.get("ID"), "date": d(rec.get("Sender ID")),
                                    "from": rec.get("Package ID"), "to": rec.get("Spec Section"),
                                    "remarks": rec.get("Discipline")})
    return subs


def to_record(sub, pms_project_number, report_project_number):
    h, wf = sub["head"], sub["workflow"]
    number = clean_number(h.get("ID"))
    nf_status = str(h.get("Status") or "").strip()
    last_action = str(h.get("Last Action") or "").strip()
    reviews = [w for w in wf if w["type"] == "Review Response"]
    closed = [w for w in wf if w["type"] == "Closed"]
    if reviews:
        action = reviews[-1]["action"]
    elif re.match(r"(Responded|Sent) and Closed - ", last_action):
        action = last_action.split(" - ", 1)[1]
    else:
        action = ""
    action = str(action or "").strip()
    stamp = STAMP_BY_ACTION.get(action.lower(), "—")
    low = nf_status.lower()
    if low.startswith("closed"):
        status = "Void" if "void" in last_action.lower() else "Returned"
    elif low.startswith(("pending", "expected")):
        status = "Pending Sub Review"
    elif reviews:
        status = "Returned"          # engineer answered; Newforma just wasn't closed out
    elif last_action.lower().startswith("forwarded"):
        status = "Under Review"
    else:
        status = "Received"
    date_returned = reviews[-1]["date"] if reviews else (d(h.get("Closed Date")) if status in ("Returned", "Void") else "")
    if len(reviews) > 1:
        comments = "\n\n".join(f"[{w['date']} — {w['action']}]\n{str(w['remarks'] or '').strip()}" for w in reviews)
    else:
        comments = str(reviews[0]["remarks"] or "").strip() if reviews else ""
    notes = ["Imported from Newforma", f"Newforma status: {nf_status}"]
    if last_action: notes.append(f"Last action: {last_action}")
    if action: notes.append(f"Review action: {action}")
    if h.get("Related Items"): notes.append(f"Related: {h['Related Items']}")
    if h.get("Forwarded To"): notes.append(f"Reviewers: {h['Forwarded To']}")
    if h.get("Internal Notes"): notes.append(f"Internal notes: {h['Internal Notes']}")
    notes.append(f"Source: {SOURCE_FILE}")
    segs = number.split("-")
    resub = int(segs[-1]) if len(segs) >= 3 and segs[-1].isdigit() else 0
    return {
        "id": f"nf-sub-{report_project_number}-{number}",
        "number": number,
        "specSection": str(h.get("Spec Section") or "").strip(),
        "description": str(h.get("Subject") or "").strip(),
        "from": str(h.get("From") or h.get("Originated By") or "").strip(),
        "discipline": map_discipline(h.get("Discipline")),
        "assignedTo": [], "subAssigned": "",
        "dateReceived": d(h.get("Received")), "dueDate": d(h.get("Due Date")), "dateReturned": date_returned,
        "comments": comments, "status": status, "stamp": stamp, "resubNumber": resub,
        "notes": "\n".join(notes), "spFolderUrl": "", "links": [], "registerItemId": "",
        "source": "newforma",
    }


def build_plan(subs, targets, existing):
    by_project = collections.defaultdict(list)
    for s in subs: by_project[str(s["head"].get("Project Number") or "").strip()].append(s)
    plan, summary = {}, {}
    for rep_num, items in sorted(by_project.items()):
        tgt = targets.get(rep_num)
        if not tgt:
            summary[rep_num] = {"skipped": True, "reportItems": len(items), "name": items[0]["head"].get("Project")}
            continue
        pms_num = tgt["projectNumber"]
        # last row wins when the export repeats an ID (it does, rarely)
        recs = {}
        for s in items:
            r = to_record(s, pms_num, rep_num)
            recs[norm_key(r["number"])] = r
        ex_rows = existing.get(pms_num, [])
        ex_by_key = collections.defaultdict(list)
        for e in ex_rows:
            ex_by_key[norm_key(e["number"])].append(e)
            if e.get("source") == "forma" and str(e.get("ext", "")).isdigit():
                ex_by_key[("forma", int(e["ext"]), int(e.get("rev") or 0))].append(e)
        ids = [e["id"] for e in ex_rows]
        assert len(ids) == len(set(ids)), f"{pms_num}: duplicate submittal ids in the PMS, refusing to patch by id"
        patches, news, stats = {}, [], collections.Counter()
        for key, r in recs.items():
            matches = ex_by_key.get(key) or ex_by_key.get(forma_key(r["number"]))
            if not matches:
                news.append(r); stats["new"] += 1; continue
            for e in matches:
                nf_origin = e["id"].startswith("nf-sub-") or e.get("source") == "newforma"
                if nf_origin:
                    p = {k: r[k] for k in OWNED}
                    if r["comments"]: p["comments"] = r["comments"]
                    n22 = e.get("notes22", "")
                    if not n22 or n22.startswith("Imported from Newforma"): p["notes"] = r["notes"]
                    patches[e["id"]] = p; stats["refreshed"] += 1
                else:
                    blanks = set(e.get("blank", ""))
                    p = {BLANK_FLAG[f]: r[BLANK_FLAG[f]] for f in blanks if f in BLANK_FLAG and f != "N" and r.get(BLANK_FLAG[f]) not in ("", "—")}
                    if p: patches[e["id"]] = p; stats["filled"] += 1
                    else: stats["unchanged"] += 1
        plan[rep_num] = {"target": tgt, "patches": patches, "news": news}
        summary[rep_num] = {"pmsProject": pms_num, "reportItems": len(items), "distinct": len(recs),
                            "existing": len(ex_rows), **stats,
                            "openInReport": sum(1 for s in items if str(s["head"].get("Status") or "").lower() != "closed")}
    return plan, summary


def sql_literal(obj):
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def to_sql(rep_num, entry):
    t = entry["target"]
    guard = f" and t.version = {int(t['version'])}" if t.get("version") is not None else ""
    return f"""-- Newforma refresh {rep_num} -> {t['projectNumber']} ({len(entry['patches'])} patched, {len(entry['news'])} appended)
with p as (select {sql_literal(entry['patches'])} as patches), n as (select {sql_literal(entry['news'])} as items)
update pms_projects t set
  project = jsonb_set(t.project, '{{submittals}}',
    (select coalesce(jsonb_agg(case when (select patches from p) ? (s->>'id') then s || ((select patches from p)->(s->>'id')) else s end order by ord), '[]'::jsonb)
       from jsonb_array_elements(coalesce(t.project->'submittals', '[]'::jsonb)) with ordinality x(s, ord))
    || (select items from n)),
  version = t.version + 1, updated_at = now()
where t.id = '{t['id']}'{guard}
returning t.id, t.project->>'projectNumber' as project, t.version, jsonb_array_length(t.project->'submittals') as submittals;
"""


def apply_rest(plan):
    url, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_KEY"]
    hdr = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}
    for rep_num, entry in plan.items():
        rid = entry["target"]["id"]
        req = urllib.request.Request(f"{url}/rest/v1/pms_projects?select=id,project,version&id=eq.{rid}", headers=hdr)
        row = json.load(urllib.request.urlopen(req))[0]
        proj, ver = row["project"], row["version"]
        arr = [dict(s, **entry["patches"][s["id"]]) if s.get("id") in entry["patches"] else s for s in proj.get("submittals", [])]
        proj["submittals"] = arr + entry["news"]
        body = json.dumps({"project": proj, "version": ver + 1, "updated_at": datetime.datetime.utcnow().isoformat() + "Z"}).encode()
        req = urllib.request.Request(f"{url}/rest/v1/pms_projects?id=eq.{rid}&version=eq.{ver}", data=body, method="PATCH",
                                     headers={**hdr, "Prefer": "return=representation"})
        back = json.load(urllib.request.urlopen(req))
        if not back: sys.exit(f"{rep_num}: version race — project changed since read; re-run")
        print(f"{rep_num}: wrote {len(proj['submittals'])} submittals (v{ver}->v{ver+1})")


def mgmt_query(ref, token, query):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/database/query",
                                 data=json.dumps({"query": query}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r: return json.load(r)


def apply_mgmt(plan, ref, token):
    """Run the per-project UPDATEs through the Supabase management API (same guard as the app: the
    row's version is read just before the write and the UPDATE only lands if it is unchanged)."""
    results = {}
    for rep_num, entry in plan.items():
        rid = entry["target"]["id"]
        for attempt in range(4):
            ver = mgmt_query(ref, token, f"select version from pms_projects where id = '{rid}'")[0]["version"]
            entry["target"]["version"] = ver
            out = mgmt_query(ref, token, to_sql(rep_num, entry))
            if out: results[rep_num] = out[0]; print(rep_num, out[0]); break
            print(f"{rep_num}: version {ver} moved under us, retrying")
        else:
            sys.exit(f"{rep_num}: could not get a clean write after 4 tries")
    return results


def main():
    global SOURCE_FILE
    ap = argparse.ArgumentParser()
    ap.add_argument("report")
    ap.add_argument("--targets", required=True)
    ap.add_argument("--existing", required=True)
    ap.add_argument("--out", default="plan")
    ap.add_argument("--apply", action="store_true", help="write via PostgREST (SUPABASE_URL + SUPABASE_SERVICE_KEY)")
    ap.add_argument("--apply-mgmt", metavar="PROJECT_REF", help="write via the management API (SUPABASE_ACCESS_TOKEN)")
    a = ap.parse_args()
    SOURCE_FILE = re.sub(r"^[0-9a-f]{8}-", "", os.path.basename(a.report))
    subs = parse_report(a.report)
    targets = json.load(open(a.targets))
    existing = json.load(open(a.existing))
    plan, summary = build_plan(subs, targets, existing)
    os.makedirs(a.out, exist_ok=True)
    for rep_num, entry in plan.items():
        open(os.path.join(a.out, f"{rep_num}.sql"), "w").write(to_sql(rep_num, entry))
        json.dump(entry, open(os.path.join(a.out, f"{rep_num}.json"), "w"), ensure_ascii=False, indent=1)
    json.dump(summary, open(os.path.join(a.out, "summary.json"), "w"), indent=1)
    for k, v in summary.items(): print(k, v)
    if a.apply: apply_rest(plan)
    if a.apply_mgmt:
        res = apply_mgmt(plan, a.apply_mgmt, os.environ["SUPABASE_ACCESS_TOKEN"])
        json.dump(res, open(os.path.join(a.out, "applied.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
