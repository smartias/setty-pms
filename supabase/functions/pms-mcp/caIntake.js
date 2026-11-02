// caIntake.js — portal notification email → RFI / submittal event parsers.
//
// Step 1 of supabase/functions/pms-mcp/PROPOSAL-portal-email-intake.md: the
// parsers that used to live inline in RFISubmittalSync_Preview.html, moved
// here so they can be tested (caIntake.test.mjs) and later shared with the
// connector's scheduled intake (step 2). Pure: an email row in, an event (or
// null) out. No project lookup, no matching against the log, no writes.
//
// Loaded by the tracker as <script type="module"> and hung on window.CaIntake.
//
// Email row shape (pms_project_emails): { record_id, subject, from_name,
// from_address, email_date, body_text, sp_folder_url }.

/* ---------- status vocab (mirrors SettyPMS.html) ---------- */
export const RFI_EVENT_STATUS = { "New RFI": "Open", "Response to RFI": "Responded", "Status Update on RFI": "Responded", "RFI Closed": "Closed" };
export const FORMA_SUB_STATUS = { "open": "Received", "required": "Received", "closed": "Returned", "void": "Void" };
export const SUB_REVISION_STATUS = "Resubmittal Required";
export const SUB_STAMPS = ["Approved", "Approved as Noted", "Revise and Resubmit", "Rejected"];

/* ---------- helpers ---------- */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad2 = (n) => String(n).padStart(2, "0");
// "July 7, 2026" / "Jul 7, 2026" / "7/7/2026" → "2026-07-07"; anything else → "".
export function normDate(s) {
  if (!s) return "";
  let m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mo < 0 ? "" : `${m[3]}-${pad2(mo + 1)}-${pad2(m[2])}`;
  }
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) return `${m[3]}-${pad2(m[1])}-${pad2(m[2])}`;
  return "";
}
export const dayOf = (iso) => (iso || "").slice(0, 10);
// Text after marker `a`, up to the first of the `b` markers (or 800 chars).
export const between = (body, a, b) => {
  const i = body.indexOf(a); if (i < 0) return "";
  const j = b.map((x) => { const k = body.indexOf(x, i + a.length); return k < 0 ? Infinity : k; }).reduce((m, x) => Math.min(m, x), Infinity);
  return body.slice(i + a.length, j === Infinity ? i + a.length + 800 : j).replace(/\s+\n/g, "\n").trim();
};
// Value on the line after "Name:" (portal emails put label and value on separate lines).
export const label = (body, name) => {
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:?\\s*\\n+\\s*([^\\n]+)", "i");
  const m = body.match(re); return m ? m[1].trim() : "";
};
// Procore prints "--" for an empty field.
const val = (s) => { s = (s || "").trim(); return s === "--" ? "" : s; };
const bodyOf = (email) => (email.body_text || "").replace(/\r/g, "");
const base = (email) => ({ date: email.email_date, recordId: email.record_id, spFolder: email.sp_folder_url || "" });

/* ---------- Procore RFIs ---------- */
// Subjects (all seen in the filed log):
//   "Action Required: J10313.000, <proj>: New RFI #RFI-91, Condensate lines in cellar"
//   "<num>, <proj>: New RFI #2218, CP - Automated Isolation Valves"
//   "<num>, <proj>: Response to RFI #662, Fire Alarm Drawing Update"
//   "<num>, <proj>: Status Update on RFI #664, ..."
//   "<num>, <proj>: RFI Closed, #17, New Riser Installation Requirements"
// Some GCs number RFIs "RFI-91" in Procore; the subject then reads "#RFI-91"
// and the body "RFI RFI-91: <subject>". extNum is the bare number either way.
export function parseProcore(email) {
  const subj = email.subject || "", body = bodyOf(email);
  if (/overdue RFI/i.test(subj)) return null;
  const sm = subj.match(/(New RFI|Response to RFI|Status Update on RFI|RFI Closed)\s*,?\s*#\s*(?:RFI[-\s]?)?(\d+)/i);
  if (!sm) return null;
  // Canonical key of RFI_EVENT_STATUS (the old title-casing produced
  // "Response To RFI", which missed the map and imported responded RFIs as Open).
  const event = Object.keys(RFI_EVENT_STATUS).find((k) => k.toLowerCase() === sm[1].toLowerCase());
  const titleM = body.match(/RFI\s+(?:RFI[-\s]?)?\d+:\s*(.+)/) || subj.match(/#\s*(?:RFI[-\s]?)?\d+,\s*(.+)$/);
  return {
    ...base(email), extNum: String(+sm[2]), event, title: (titleM ? titleM[1] : "").trim(),
    dueDate: normDate(label(body, "Due Date")), askedBy: val(label(body, "Asked by")),
    question: between(body, "Question:", ["Attachments", "Additional Information", "Official Responses"]),
    dateInit: normDate(label(body, "Date Initiated")),
  };
}

/* ---------- Procore submittals ---------- */
// Subjects:
//   "<num>, <proj>: Submittal Distributed 262416-1.0, Panelboard and Accessories - Product Data"
//   "<num>, <proj>: Approver Setty CA Updated their Response for Submittal 102800-1.0, 102800-001 - Toilet Accessories"
//   "Action Required: <num>, <proj>: Submitter Garrett Dawson Updated their Response for Submittal 238219-1.0, Fan Coil Units - ..."
// Procore numbers a submittal <spec>-<item>.<revision>. The log uses the
// Newforma-style spec-based id <spec>-<item padded to 3>-<rev>, so
// "110000-1.1" becomes extNum "110000-001" rev 1 — the same base the
// tracker's matchSub already matches on (prefix + relative revision).
export function parseProcoreSub(email) {
  const subj = email.subject || "", body = bodyOf(email);
  const sm = subj.match(/Submittal\s+(?:Distributed\s+)?(\d{5,6})-(\d+)\.(\d+)\s*,?\s*(.*)$/i);
  if (!sm) return null;
  const extNum = `${sm[1]}-${String(+sm[2]).padStart(3, "0")}`, rev = +sm[3];
  let event = "update", status = "Received";
  const apr = subj.match(/Approver\s+(.+?)\s+Updated their Response/i);
  if (/Submittal Distributed/i.test(subj)) { event = "distributed"; status = "Returned"; }
  else if (apr) { event = "approver-response"; status = /setty/i.test(apr[1]) ? "Returned" : "Under Review"; }
  else if (/Submitter\s+.+?\s+Updated their Response/i.test(subj)) { event = "submitter-response"; status = "Received"; }
  const bodyTitle = body.match(/Submittal\s+\d{5,6}-\d+\.\d+:\s*(.+)/);
  let title = (bodyTitle ? bodyTitle[1] : sm[4] || "").trim().replace(/\.\s*$/, "");
  title = title.replace(new RegExp("^" + extNum + "(?:-\\d+)?\\s*-\\s*"), ""); // drop a repeated "102800-001 - " prefix
  const resp = val(label(body, "Response"));
  const stamp = SUB_STAMPS.find((s) => s.toLowerCase() === resp.toLowerCase()) || "";
  const spec = val(label(body, "Spec Section"));
  return {
    ...base(email), extNum, rev, isRev: false, event, status, title, stamp, response: resp,
    specSection: spec || sm[1],
    dueDate: normDate(label(body, "Final Due Date")) || normDate(label(body, "Ball in court due date")) || normDate(label(body, "Due Date")),
    ballInCourt: val(label(body, "Ball in court")) || val(label(body, "Responsible Contractor")) || email.from_name || "",
    dateReceived: dayOf(email.email_date),
  };
}

/* ---------- Autodesk Forma submittals ---------- */
export function parseForma(email) {
  const subj = email.subject || "", body = bodyOf(email);
  const sm = subj.match(/Submittal\s*#(\d+)/i); if (!sm) return null;
  const isRev = /new revision/i.test(subj);
  const im = body.match(/item\s*#\d+\s*(?:\(Rev\s*(\d+)\))?\s*(.+)/i);
  const details = body.slice(Math.max(0, body.indexOf("Item Details")));
  return {
    ...base(email), extNum: String(+sm[1]), isRev, rev: im && im[1] ? +im[1] : 0, title: (im ? im[2] : "").trim(),
    specSection: label(details, "Sub Spec Section") || label(details, "Spec Section"), formaStatus: (label(details, "Status") || "").trim(),
    dueDate: normDate(label(details, "Due Date")), ballInCourt: label(details, "Ball in court"),
  };
}

/* ---------- Newforma forwards ---------- */
// "RFI Forwarded:" — subject carries the number and title; the body varies
// too much to trust, so only subject-derived fields are filled.
export function parseNewformaFwdRfi(email) {
  const subj = email.subject || ""; if (!/RFI\s*Forwarded\s*:/i.test(subj)) return null;
  const nm = subj.match(/-\s*RFI:(\d+)/i) || subj.match(/RFI:(\d+)\s*:?\w*$/i); if (!nm) return null;
  const tm = subj.match(/RFI\s*Forwarded:\s*(.+?)\s*-\s*RFI:/i); const segs = tm ? tm[1].split(" - ") : [];
  const title = (segs.length ? segs[segs.length - 1] : "").trim();
  return { ...base(email), extNum: String(+nm[1]), event: "New RFI", title, dueDate: "", askedBy: email.from_name || "", question: "", dateInit: dayOf(email.email_date) };
}
// "Submittal Forwarded:" — the id IS the log's spec-based number
// (232113-012, optional trailing -rev), so matching runs on the full id.
export function parseNewformaFwdSub(email) {
  const subj = email.subject || ""; if (!/Submittal\s*Forwarded\s*:/i.test(subj)) return null;
  const nm = subj.match(/Submittal:\s*([\d.]+(?:-\d+)+)/i); if (!nm) return null;
  const raw = nm[1]; const rm = raw.match(/^([\d.]+-\d+)-(\d+)$/); const baseId = rm ? rm[1] : raw; const rev = rm ? +rm[2] : 0;
  const tm = subj.match(/Submittal\s*Forwarded:\s*(.+?)\s*-\s*\d/i); // title ends where the numeric project segment begins
  return {
    ...base(email), extNum: baseId, isRev: rev > 0, rev, title: (tm ? tm[1] : "").trim(),
    specSection: (baseId.match(/^\d{6}/) || [""])[0], formaStatus: "", dueDate: "", ballInCourt: email.from_name || "",
  };
}

/* ---------- vendors ---------- */
// The parser is the real gate (each returns null unless the subject has its
// vendor's shape); `match` is the sender/subject fast path. Newforma
// notifications often arrive FORWARDED by a person, so they gate on the
// parser alone.
export const VENDORS = [
  { match: /procoretech/i, vendor: "Procore",        kind: "rfi",       arrKey: "rfis",       parse: parseProcore },
  { match: /procoretech/i, vendor: "Procore",        kind: "submittal", arrKey: "submittals", parse: parseProcoreSub },
  { match: /forma/i,       vendor: "Autodesk Forma", kind: "submittal", arrKey: "submittals", parse: parseForma },
  { match: /./,            vendor: "Newforma",       kind: "rfi",       arrKey: "rfis",       parse: parseNewformaFwdRfi },
  { match: /./,            vendor: "Newforma",       kind: "submittal", arrKey: "submittals", parse: parseNewformaFwdSub },
];
export const vendorPool = (v, emails) =>
  v.match.source === "." ? emails : emails.filter((e) => v.match.test(e.from_address || "") || v.match.test(e.subject || ""));

/* ---------- collapse: many events for one item → one inbox row ---------- */
export function collapse(events, kind) {
  const by = {};
  for (const e of events) (by[e.extNum] = by[e.extNum] || []).push(e);
  return Object.entries(by).map(([num, evs]) => {
    evs.sort((a, b) => new Date(a.date) - new Date(b.date));
    const last = evs[evs.length - 1], first = evs[0];
    if (kind === "rfi") return {
      extNum: num, title: last.title || first.title, status: RFI_EVENT_STATUS[last.event] || "Open", dueDate: last.dueDate || first.dueDate,
      from: first.askedBy, question: first.question || last.question, dateReceived: first.dateInit, lastDate: dayOf(last.date),
      recordId: first.recordId, spFolder: first.spFolder,
    };
    const rev = Math.max(...evs.map((e) => e.rev));
    // Procore events carry their own status; Forma's comes from its Status field.
    const status = last.status || (last.isRev ? SUB_REVISION_STATUS : (FORMA_SUB_STATUS[(last.formaStatus || "").toLowerCase()] || "Received"));
    const stamp = [...evs].reverse().map((e) => e.stamp).find(Boolean) || "";
    return {
      extNum: num, title: last.title || first.title, specSection: last.specSection || first.specSection, rev, status, stamp,
      dueDate: last.dueDate || first.dueDate, ballInCourt: last.ballInCourt, dateReceived: first.dateReceived || "", lastDate: dayOf(last.date),
      recordId: last.recordId, spFolder: last.spFolder,
    };
  }).sort((a, b) => { const x = +a.extNum, y = +b.extNum; return (isNaN(x) || isNaN(y)) ? String(a.extNum).localeCompare(String(b.extNum)) : x - y; });
}

/* ---------- matching against the logged items ---------- */
// Moved unchanged from RFISubmittalSync_Preview.html so the tracker and the
// connector's scheduled intake decide NEW / matched / UPDATE the same way.
export const RFI_DISC = ["Mechanical", "Electrical", "Plumbing", "Fire Protection", "Technology", "Multi-Discipline", "Other"];
export const SUB_DISC = ["Mechanical", "Electrical", "Plumbing", "Fire Protection", "Technology", "Architectural", "Structural", "Civil", "Other"];
export const digits = (s) => (String(s || "").match(/\d+/) || [""])[0].replace(/^0+/, "") || "0";
const itemSeg = (s) => { const m = String(s || "").match(/-(\d+)-\d+$/); return m ? String(+m[1]) : null; };
const revSeg = (s) => { const m = String(s || "").match(/-(\d+)$/); return m ? +m[1] : 0; };
export function matchRFI(extNum, title, logged) {
  const t = (title || "").toLowerCase().trim();
  return logged.find((r) => digits(r.number) === extNum) || logged.find((r) => t && (r.title || "").toLowerCase().includes(t)) || null;
}
export function matchSub(extNum, logged) {
  // Newforma/Procore ids are the full spec-based number ("232113-012") — match
  // by prefix on the logged number; bare numeric ids keep the Forma
  // item-segment rule.
  if (/[-.]/.test(String(extNum))) {
    const base = String(extNum);
    // Only the base itself or base-<rev> count (never base+extra digits), and
    // the revision is RELATIVE to the base: a bare logged "232113-012" is rev 0
    // (revSeg would misread its item segment "-012" as rev 12 — Codex P1).
    const h = logged.filter((s) => { const n = String(s.number || ""); return n === base || n.startsWith(base + "-"); });
    if (!h.length) return null;
    const relRev = (n) => { n = String(n || ""); if (n === base) return 0; const m = n.slice(base.length).match(/^-(\d+)$/); return m ? +m[1] : 0; };
    return { row: h[0], maxRev: Math.max(...h.map((s) => relRev(s.number))) };
  }
  const h = logged.filter((s) => itemSeg(s.number) === extNum);
  return h.length ? { row: h[0], maxRev: Math.max(...h.map((s) => revSeg(s.number))) } : null;
}

/* ---------- discipline inference: spec division first, keywords second, "" when unsure ---------- */
const DISC_BY_DIV = { "03": "Structural", "04": "Structural", "05": "Structural", "08": "Architectural", "09": "Architectural",
  "21": "Fire Protection", "22": "Plumbing", "23": "Mechanical", "26": "Electrical", "27": "Technology", "28": "Technology",
  "31": "Civil", "32": "Civil", "33": "Civil" };
const DISC_KEYWORDS = [
  [/fire\s*(protection|alarm|pump|suppression)|sprinkler|standpipe/i, "Fire Protection"],
  [/plumbing|domestic\s*water|sanitary|storm\s*(drain|piping)|floor\s*drain|water\s*heater|fixture\s*carrier/i, "Plumbing"],
  [/mechanical|hvac|duct|diffuser|\bahu\b|\brtu\b|\bvav\b|chiller|boiler|cooling\s*tower|heat\s*pump|exhaust\s*fan|refrigerant|hydronic/i, "Mechanical"],
  [/electrical|switchgear|switchboard|panelboard|transformer|conduit|breaker|lighting|receptacle|generator|busway|feeder/i, "Electrical"],
  [/low[\s-]*voltage|telecom|data\s*(cabling|outlet)|security\s*(system|camera)|cctv|access\s*control|audio[\s/-]*visual|paging|nurse\s*call/i, "Technology"],
];
export function inferDiscipline(it, kind) {
  const vocab = kind === "rfi" ? RFI_DISC : SUB_DISC;
  const div = (String(it.specSection || "").trim().match(/^(\d{2})/) || [])[1];
  if (div && DISC_BY_DIV[div] && vocab.includes(DISC_BY_DIV[div])) return DISC_BY_DIV[div];
  const hay = (it.title || "") + " " + (it.question || "");
  for (const [re, d] of DISC_KEYWORDS) if (re.test(hay) && vocab.includes(d)) return d;
  return "";
}

/* ---------- log records ---------- */
export function toRfiRecord(it, pid, vendor) {
  return { id: `sync-procore-${pid}-${it.extNum}`, number: `RFI-${String(it.extNum).padStart(3, "0")}`, title: it.title || "",
    description: (it.question || "").replace(/\s+/g, " ").trim().slice(0, 200), from: it.from || "", discipline: inferDiscipline(it, "rfi"), assignedTo: [], subAssigned: "",
    dateReceived: it.dateReceived || "", dueDate: it.dueDate || "", dateResponded: (it.status === "Responded" || it.status === "Closed") ? it.lastDate : "", response: "",
    status: it.status, notes: `Imported from ${vendor} · RFI #${it.extNum}`, spFolderUrl: it.spFolder || "", links: [], source: "procore", extNumber: String(it.extNum), sourceEmailId: it.recordId || "" };
}
export function toSubRecord(it, pid, vendor) {
  const nf = /[-.]/.test(String(it.extNum));
  return { id: `sync-${nf ? "nf" : "forma"}-${pid}-${it.extNum}`, number: nf ? `${it.extNum}-${it.rev || 0}` : `SUB-${String(it.extNum).padStart(3, "0")}`, specSection: it.specSection || "",
    description: (it.title || "").slice(0, 200), from: it.ballInCourt || "", discipline: inferDiscipline(it, "submittal"), assignedTo: [], subAssigned: "", dateReceived: it.dateReceived || "", dueDate: it.dueDate || "",
    dateReturned: it.status === "Returned" ? it.lastDate : "", comments: "", status: it.status, stamp: it.stamp || "—", resubNumber: it.rev || 0,
    notes: `Imported from ${vendor} · Submittal #${it.extNum}${it.rev ? ` (Rev ${it.rev})` : ""}`, spFolderUrl: it.spFolder || "", links: [], registerItemId: "", source: "forma", extNumber: String(it.extNum), sourceEmailId: it.recordId || "" };
}

/* ---------- inbox: every portal item on one project, with its verdict ---------- */
// The tracker's 📥 To import strip. Each item carries `vendor`, `verdict`
// ("new" | "matched" | "update"), the matched row, and the record an import
// would append.
export function buildInbox(emails, loggedRFIs, loggedSubs, pid, vendors = VENDORS) {
  const inbox = { rfi: [], submittal: [] };
  for (const v of vendors) {
    const parsed = vendorPool(v, emails).map(v.parse).filter(Boolean);
    if (!parsed.length) continue;
    const items = collapse(parsed, v.kind);
    for (const it of items) {
      it.vendor = v.vendor;
      if (v.kind === "rfi") { it.match = matchRFI(it.extNum, it.title, loggedRFIs); it.verdict = it.match ? "matched" : "new"; it.record = toRfiRecord(it, pid, v.vendor); }
      else { const m = matchSub(it.extNum, loggedSubs); it.match = m && m.row; it.loggedRev = m ? m.maxRev : null; it.verdict = !m ? "new" : (it.rev > m.maxRev ? "update" : "matched"); it.record = toSubRecord(it, pid, v.vendor); }
    }
    inbox[v.kind] = [...inbox[v.kind], ...items]; // vendors of the same kind merge, never overwrite
  }
  return inbox;
}

/* ---------- scheduled intake: what to append, unattended ---------- */
// The connector's admin/ca-items-intake route calls this per project. It is
// deliberately narrower than the tracker's manual import:
//   - only the vendors named (Procore by default; Newforma forwards can carry
//     a different number for an item already logged, so they stay manual);
//   - only verdict "new" (a newer revision of a logged submittal is an UPDATE
//     a person handles in the tracker, never an automatic write);
//   - only items with an email on or after `since` (YYYY-MM-DD), so the first
//     run does not backfill years of closed items. The item's FULL history is
//     still used to build it (status, question, received date);
//   - never an id already in the log.
// Each record is marked intakeReviewed:false; the PMS shows it as Unreviewed
// until a person confirms the discipline and assignee.
export function planIntake(emails, project, pid, opts = {}) {
  const vendorNames = opts.vendors || ["Procore"];
  const since = opts.since || "";
  const at = opts.at || new Date().toISOString();
  const rfis = Array.isArray(project && project.rfis) ? project.rfis : [];
  const subs = Array.isArray(project && project.submittals) ? project.submittals : [];
  const inbox = buildInbox(emails, rfis, subs, pid, VENDORS.filter((v) => vendorNames.includes(v.vendor)));
  const out = { rfis: [], submittals: [], skipped: { matched: 0, update: 0, old: 0 } };
  const have = new Set([...rfis, ...subs].map((r) => r && r.id));
  for (const kind of ["rfi", "submittal"]) {
    for (const it of inbox[kind]) {
      if (it.verdict !== "new") { out.skipped[it.verdict === "update" ? "update" : "matched"]++; continue; }
      if (since && (it.lastDate || "") < since) { out.skipped.old++; continue; }
      if (have.has(it.record.id)) { out.skipped.matched++; continue; }
      have.add(it.record.id);
      const rec = { ...it.record, intakeReviewed: false, intake: { at, by: "ca-items-intake", vendor: it.vendor } };
      (kind === "rfi" ? out.rfis : out.submittals).push(rec);
    }
  }
  return out;
}
