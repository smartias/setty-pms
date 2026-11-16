// Which projects have QA ledger rows that are due a back-check
// (list_backcheck_candidates). Pure: the tool reads the rows, this decides.
//
// A row is DUE when the project's newest issued set has not been checked
// against it yet. That is the case unless one of these is true:
//   - the row was raised ON that set (its review names the set): there is
//     nothing newer to check it against;
//   - a back-check review naming that set was recorded after the row was
//     created: the pass already looked at it, whatever it decided.
// So a pass that finds nothing still has to leave its review row
// (record_qa_findings kind:'backcheck', setName = the set's folder name), or
// the same project comes back as due on the next run.
//
// Only rows with status 'open' are considered. 'ready_to_backcheck' rows are
// waiting for a person, and source rfi/submittal rows are construction flags
// that the QA back-check leaves alone.

export type OpenRow = { id: number; project: string; review_id?: number | null; source?: string | null; created_at?: string | null };
export type ReviewRow = { id: number; project: string; set_name?: string | null; kind?: string | null; run_at?: string | null };
export type SetFile = { set_name?: string | null; set_date?: string | null; first_seen_at?: string | null; discipline?: string | null };
export type IssuedSet = { name: string; date: string | null; firstSeenAt: string | null; files: number };

const EXTERNAL = new Set(["drchecks", "owner", "architect", "agency", "other"]);
const NOT_QA = new Set(["rfi", "submittal"]);

// Letters and digits only, so "2025-08-22_100%_CD" and the review's
// "2025-08-22_100%_CD (look-back review)" compare as the same set.
export const setKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The sets a project has issued, newest first, from its Outgoing drawing
// files. A folder counts as a set only when at least one of its files carries
// a discipline: a folder of comment registers or reports is not a drawing set.
// Order: the date in the folder name (never the file's modified time, which a
// bulk migration flattened), then when the index first saw it.
export function issuedSets(files: SetFile[]): IssuedSet[] {
  const by = new Map<string, IssuedSet>();
  for (const f of files ?? []) {
    const name = String(f?.set_name ?? "").trim();
    if (!name || !String(f?.discipline ?? "").trim()) continue;
    const cur = by.get(name) ?? { name, date: null, firstSeenAt: null, files: 0 };
    cur.files++;
    const d = f.set_date ? String(f.set_date).slice(0, 10) : null;
    if (d && (!cur.date || d > cur.date)) cur.date = d;
    const seen = f.first_seen_at ? String(f.first_seen_at) : null;
    if (seen && (!cur.firstSeenAt || seen < cur.firstSeenAt)) cur.firstSeenAt = seen;
    by.set(name, cur);
  }
  return [...by.values()].sort((a, b) =>
    String(b.date ?? "").localeCompare(String(a.date ?? "")) ||
    String(b.firstSeenAt ?? "").localeCompare(String(a.firstSeenAt ?? "")) ||
    a.name.localeCompare(b.name));
}

export type Candidate = {
  project: string;
  newestSet: IssuedSet | null;
  openRows: number;
  due: number; dueExternal: number; dueInternal: number;
  raisedOnThisSet: number; alreadyChecked: number;
  lastBackcheckOfThisSet: string | null;
  dueIds: number[];
};

export function backcheckStatus(project: string, rows: OpenRow[], reviews: ReviewRow[], sets: IssuedSet[]): Candidate {
  const mine = (rows ?? []).filter((r) => r.project === project && !NOT_QA.has(String(r.source ?? "")));
  const newest = sets?.[0] ?? null;
  const out: Candidate = {
    project, newestSet: newest, openRows: mine.length,
    due: 0, dueExternal: 0, dueInternal: 0, raisedOnThisSet: 0, alreadyChecked: 0,
    lastBackcheckOfThisSet: null, dueIds: [],
  };
  if (!newest || !mine.length) return out;
  const key = setKey(newest.name);
  const names = (r: ReviewRow) => !!key && setKey(r.set_name).includes(key);
  const projReviews = (reviews ?? []).filter((r) => r.project === project);
  const byId = new Map(projReviews.map((r) => [r.id, r]));
  const checks = projReviews.filter((r) => r.kind === "backcheck" && names(r) && r.run_at)
    .map((r) => String(r.run_at)).sort();
  out.lastBackcheckOfThisSet = checks.length ? checks[checks.length - 1] : null;
  for (const r of mine) {
    const origin = r.review_id != null ? byId.get(r.review_id) : undefined;
    if (origin && names(origin)) { out.raisedOnThisSet++; continue; }
    const made = Date.parse(String(r.created_at ?? ""));
    const checked = checks.some((c) => !Number.isFinite(made) || Date.parse(c) >= made);
    if (checked) { out.alreadyChecked++; continue; }
    out.due++;
    if (EXTERNAL.has(String(r.source ?? ""))) out.dueExternal++; else out.dueInternal++;
    out.dueIds.push(r.id);
  }
  return out;
}
