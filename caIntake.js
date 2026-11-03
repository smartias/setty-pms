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
// Newforma prints "Label: value" on one line.
export const lineLabel = (body, name) => {
  const m = body.match(new RegExp("^[ \\t]*" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ \\t]*:[ \\t]*(.+?)[ \\t]*$", "im"));
  return m ? m[1].trim() : "";
};
// One comparable key per RFI number, whatever the portal prints:
// "RFI-091", "#91", "91" → "91"; "RFI-005R" → "5R"; "121.1" / "RFI-121.1" → "121.1"
// (a follow-up, NOT RFI 121); "BID-RFI-306" → "BID-306". Leading zeros of each
// number group are dropped, decimals kept.
export function rfiKey(s) {
  let t = String(s == null ? "" : s).trim().toUpperCase().replace(/^#\s*/, "");
  t = t.replace(/\bRFI\s*[-#:]?\s*/g, "").replace(/^[-\s]+|[-\s]+$/g, "");
  return t.replace(/(^|[^\d.])0+(\d)/g, "$1$2");
}
// Display form for a log number: integer part padded to 3 ("5R" → "005R").
export const rfiDisplay = (key) => String(key || "").replace(/^(\d+)/, (m) => m.padStart(3, "0"));
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
    stamp: formaStamp(body),
  };
}
// "Final Response … Response\n\n\nApproved as noted" → "Approved as Noted".
function formaStamp(body) {
  const i = body.indexOf("Final Response"); if (i < 0) return "";
  const r = label(body.slice(i + "Final Response".length), "Response");
  return SUB_STAMPS.find((x) => x.toLowerCase() === r.toLowerCase()) || "";
}

/* ---------- Newforma forwards ---------- */
// Subjects (all seen in the filed log, 2024-11..2026-10):
//   "RFI Forwarded: Follow up to RFI 005 - Stony Brook University, Tabler Quad New Residence Hall - RFI:RFI-005R:SM1mU"
//   "RFI Forwarded: SAPX196006.00_SUNY StonyBrook TblrQud - Load Bank Location - RFI:RFI-138:FCqqN"   (Setty's own Newforma)
//   "RFI Forwarded: RFI-188.1 Follow Up to RFI-188-Access Panel Locations - 1018037.01_Stony Brook … - RFI:188.1:SM1mU"
//   "RFI Forwarded: SAPX188032.00_NVCC Howsmon & Colgan - RFI-40 Lab Gas Valve Box Door Clarification - RFI:166:YvTUq"
//   "Submittal Forwarded: SAPX259009.00_Gordonsville FireCompany - Diffusers, Registers & Grilles - Submittal:233713-001-0 :9PAkD"
//   "Submittal Responded to and Closed: SAPX196006.00_… - 1st Floor Sheetmetal … - Submittal:233113-002-0:FCqqN"
// The id sits between "RFI:"/"Submittal:" and the trailing Info Exchange tag.
// Only a notification counts: "RE:", "FW:" and "Automatic reply:" are people
// answering it, never a new event. The same item forwarded by the architect's
// Newforma and by Setty's own (two tags, same id) collapses on the id; Setty's
// own forwards stop once Newforma is retired internally.
const NF_HEAD = /^\s*(RFI|Submittal)\s+(Forwarded|Responded to and Closed)\s*:\s*/i;
// The subject's middle is "<a> - <b> - …"; one segment is the project (a
// SAPX… code, a project number, or the body's "Project:" name, possibly cut
// off with "..."), the rest is the title.
function newformaTitle(core, body) {
  const proj = lineLabel(body, "Project").replace(/^[\w.]+\s+/, "").toLowerCase();
  const isProj = (seg) => {
    const t = seg.trim(), lc = t.replace(/\.\.\.$/, "").trim().toLowerCase();
    if (/^[A-Z]{3,4}\d{6}\.\d{2}_/.test(t) || /^\d{5,}(\.\d+)?_/.test(t)) return true;  // SAPX196006.00_…, 1018037.01_…
    if (/^\d+$/.test(t)) return true;                                                  // a bare number segment
    if (/\.\.\.$/.test(t)) return true;                                               // Newforma cut the project name short
    return !!(proj && lc.length >= 8 && (proj.startsWith(lc) || lc.startsWith(proj)));
  };
  const segs = core.split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  const keep = segs.filter((x) => !isProj(x));
  return (keep.length ? keep : segs.slice(-1)).join(" - ");
}
function newformaCommon(email, body) {
  const internal = /@setty\.com\s*$/i.test(email.from_address || "");
  const remarks = between(body, "Remarks", ["Download all files", "RFI Info", "Submittal Info"]);
  return {
    dueDate: normDate(lineLabel(body, "Due back")),
    from: lineLabel(body, "From").replace(/\s*\(.*\)\s*$/, "") || email.from_name || "",
    purpose: lineLabel(body, "Purpose"),
    // Setty's own forwards carry the CA team's instructions template, not the question.
    question: internal ? "" : remarks,
    internal,
  };
}
export function parseNewformaFwdRfi(email) {
  const subj = email.subject || "", body = bodyOf(email);
  const h = subj.match(NF_HEAD); if (!h || !/^RFI$/i.test(h[1])) return null;
  const rest = subj.slice(h[0].length);
  const nm = rest.match(/^(.*?)\s*-\s*RFI:\s*([^:]+?)\s*:\s*\w+\s*$/i); if (!nm) return null;
  const key = rfiKey(nm[2]); if (!key || !/\d/.test(key)) return null;
  const c = newformaCommon(email, body);
  return {
    ...base(email), extNum: key, rawId: nm[2].trim(), event: /Closed/i.test(h[2]) ? "RFI Closed" : "New RFI",
    title: newformaTitle(nm[1], body), dueDate: c.dueDate, askedBy: c.from, question: c.question,
    dateInit: dayOf(email.email_date), internal: c.internal,
  };
}
// The submittal id IS the log's spec-based number (232113-012, optional
// letter suffix "016C", trailing -rev), so matching runs on the base id.
export function parseNewformaFwdSub(email) {
  const subj = email.subject || "", body = bodyOf(email);
  const h = subj.match(NF_HEAD); if (!h || !/^Submittal$/i.test(h[1])) return null;
  const rest = subj.slice(h[0].length);
  const nm = rest.match(/^(.*?)\s*-\s*Submittal:\s*([\d.]+-\d+[A-Za-z]?(?:-\d+)?)\s*:\s*\w+\s*$/i); if (!nm) return null;
  const raw = nm[2]; const rm = raw.match(/^([\d.]+-\d+[A-Za-z]?)-(\d+)$/); const baseId = rm ? rm[1] : raw; const rev = rm ? +rm[2] : 0;
  const c = newformaCommon(email, body);
  const closed = /Closed/i.test(h[2]);
  return {
    ...base(email), extNum: baseId, isRev: rev > 0, rev, title: newformaTitle(nm[1], body),
    specSection: (baseId.match(/^\d{5,6}(\.\d+)?/) || [""])[0], formaStatus: "", dueDate: c.dueDate,
    ballInCourt: c.from, status: closed ? "Returned" : "", dateReceived: closed ? "" : dayOf(email.email_date), internal: c.internal,
  };
}

/* ---------- Kahua (NYC SCA's CAMP) ---------- */
// All from outbox@kahua.com, the person in the display name ("X (via Kahua)").
// Subjects seen in the filed log (Q119, 2025-01..2026-10):
//   "CI00034 Q119 (RFI#34) Exposed Rough Carpentry"                        a new RFI
//   "RFI  - Q119 (RFI#3) Casement Millwork - Additional Clarification on C000016114-MC0034 - …"   new, no CI number yet
//   "RFI CI00033 - Q119 (RFI#33) Data Points response received on C000016114-MC0034 - …"   body has the question
//   "RFI CI00020 for Q119 C000016114-MC0034 D021838 has been returned"      sent back to us: never a close
//   "CAMP Submittal: 16730-003 Returned in Project C000016114-MC0034"       body: "returned with response Revise Resubmit"
//   "03542-001 Official Reviewer Task on Q119 (IS119Q) - …"                 a submittal assigned to us
// "RFI#34" and "CI00034" are the same item; the log numbers it RFI-034.
const KAHUA_SKIP = /Weekly Summary|Meeting Minutes|^\s*(RE|FW|Fwd)\s*:/i;
const viaKahua = (email) => (email.from_name || "").replace(/\s*\(via Kahua\)\s*$/i, "").trim();
// "Revise Resubmit" / "Approved As Noted" → the log's stamp vocabulary.
function normalizeStamp(s) {
  const k = (x) => String(x || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
  const t = k(s); return t ? (SUB_STAMPS.find((x) => k(x) === t) || "") : "";
}
export function parseKahuaRfi(email) {
  const subj = (email.subject || "").replace(/\s+/g, " ").trim(), body = bodyOf(email);
  if (KAHUA_SKIP.test(subj) || /Submittal|Reviewer Task/i.test(subj)) return null;
  const rn = subj.match(/\(RFI\s*#\s*([\w.-]+)\)/i), cn = subj.match(/\bCI0*(\d+)\b/i);
  if (!rn && !cn) return null;
  if (!rn && !/^RFI\b/i.test(subj)) return null;
  const key = rn ? rfiKey(rn[1]) : String(+cn[1]);
  const event = /has been returned/i.test(subj) ? "Returned to Us" : /response received/i.test(subj) ? "Response Received" : "New RFI";
  const tm = subj.match(/\(RFI\s*#\s*[\w.-]+\)\s*(.*?)(?:\s+response received on\b.*|\s+on\s+C\d{6,}.*|\s+has been returned.*)?$/i);
  const unq = (x) => String(x || "").trim().replace(/^"+|"+$/g, "").trim();
  return {
    ...base(email), extNum: key, kahuaId: cn ? "CI" + cn[1].padStart(5, "0") : "", event,
    title: tm ? tm[1].trim() : "", dueDate: "", askedBy: viaKahua(email),
    question: unq(between(body, "Question:", ["Additional Information", "Return for clarification", "Please see full information"])),
    dateInit: dayOf(email.email_date),
  };
}
export function parseKahuaSub(email) {
  const subj = (email.subject || "").replace(/\s+/g, " ").trim(), body = bodyOf(email);
  if (KAHUA_SKIP.test(subj)) return null;
  let m = subj.match(/^CAMP Submittal:\s*(\d{5,6})-(\d{3})\s+(\w+)/i), event = "";
  if (m) event = m[3].toLowerCase();
  else { m = subj.match(/^(\d{5,6})-(\d{3})\s+Official Reviewer Task\b/i); if (m) event = "assigned"; }
  if (!m) return null;
  const extNum = `${m[1]}-${m[2]}`;
  const full = lineLabel(body, "Submittal");                       // "Q119-16730-003-001-Data Cabling Product Data R1"
  const title = full.replace(/^[A-Z]\d{3}-\d{5,6}-\d{3}-\d{3}-/i, "").trim();
  const rv = title.match(/\bR(\d+)\s*$/i);
  const resp = (body.match(/returned with response\s+(.+?)\s*\.\s*(?:\n|$)/i) || [])[1] || "";
  const returned = event === "returned";
  return {
    ...base(email), extNum, rev: rv ? +rv[1] : 0, isRev: false, title, event,
    status: returned ? "Returned" : "Received", stamp: returned ? normalizeStamp(resp) : "", response: resp,
    specSection: m[1], dueDate: "", ballInCourt: viaKahua(email), dateReceived: returned ? "" : dayOf(email.email_date),
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
  { match: /kahua/i,       vendor: "Kahua",          kind: "rfi",       arrKey: "rfis",       parse: parseKahuaRfi },
  { match: /kahua/i,       vendor: "Kahua",          kind: "submittal", arrKey: "submittals", parse: parseKahuaSub },
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
      recordId: first.recordId, spFolder: first.spFolder, lastEvent: last.event, lastRecordId: last.recordId,
    };
    const rev = Math.max(...evs.map((e) => e.rev));
    // Procore events carry their own status; Forma's comes from its Status field.
    const status = last.status || (last.isRev ? SUB_REVISION_STATUS : (FORMA_SUB_STATUS[(last.formaStatus || "").toLowerCase()] || "Received"));
    const stamp = [...evs].reverse().map((e) => e.stamp).find(Boolean) || "";
    return {
      extNum: num, title: last.title || first.title, specSection: last.specSection || first.specSection, rev, status, stamp,
      dueDate: last.dueDate || first.dueDate, ballInCourt: last.ballInCourt, dateReceived: first.dateReceived || "", lastDate: dayOf(last.date),
      recordId: last.recordId, spFolder: last.spFolder, lastRecordId: last.recordId,
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
// By the full RFI key (so follow-up 121.1 is not RFI 121, and 5R not 5),
// then by title, which catches the same RFI under another system's number.
export function matchRFI(extNum, title, logged) {
  const k = rfiKey(extNum), t = (title || "").toLowerCase().trim();
  return logged.find((r) => rfiKey(r.number) === k || (r.extNumber != null && rfiKey(r.extNumber) === k))
    || logged.find((r) => t.length >= 6 && (r.title || "").toLowerCase().includes(t)) || null;
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
  // Forma "#202": a spec-based log number carries it as the item segment
  // ("237313.13-202-2"); an earlier tracker import logged it as "SUB-202".
  const h = logged.filter((s) => itemSeg(s.number) === extNum || new RegExp("^SUB-?0*" + extNum + "$", "i").test(String(s.number || "")));
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
  return { id: `sync-procore-${pid}-${it.extNum}`, number: `RFI-${rfiDisplay(it.extNum)}`, title: it.title || "",
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

/* ---------- status updates on items already in the log ---------- */
// A portal's closing or answering event moves a logged item FORWARD, never
// back: RFI Open → Responded → Closed; submittal (any open state) → Returned.
// Only explicit events count: Procore "Response to RFI" / "RFI Closed",
// Newforma "Responded to and Closed", a Procore distribution or Setty approver
// response, a Forma item whose status is Closed. "Status Update", reminders
// and forwards never change a status. Void items are never touched.
const RFI_RANK = { "Open": 0, "Pending Sub Response": 0, "Responded": 1, "Closed": 2 };
const SUB_RANK = { "Received": 0, "Under Review": 0, "Pending Sub Review": 0, "Resubmittal Required": 0, "Returned": 1 };
const RFI_UPDATE_EVENTS = { "Response to RFI": "Responded", "RFI Closed": "Closed" };
// The ONE logged RFI this portal item is, by number only (a title match is
// good enough to avoid creating a twin, not to change someone's record).
function strictRfiRow(it, logged) {
  const k = rfiKey(it.extNum);
  const hits = logged.filter((r) => rfiKey(r.number) === k || (r.extNumber != null && rfiKey(r.extNumber) === k));
  return hits.length === 1 ? hits[0] : null;
}
// The ONE logged submittal row that is this item AND revision. Spec-based
// numbers carry the revision ("237313.13-202-2", "262416-001-0"); a bare
// "SUB-202" row counts only when its resubNumber is that revision.
function strictSubRow(it, logged) {
  const ext = String(it.extNum), rev = +it.rev || 0;
  const hits = logged.filter((s) => {
    const n = String(s.number || "");
    if (/[-.]/.test(ext)) return n === ext + "-" + rev || (rev === 0 && n === ext);
    const m = n.match(/-(\d+)-(\d+)$/);
    if (m) return String(+m[1]) === ext && +m[2] === rev;
    return new RegExp("^SUB-?0*" + ext + "$", "i").test(n) && (+s.resubNumber || 0) === rev;
  });
  return hits.length === 1 ? hits[0] : null;
}
// What one collapsed portal item would change on its logged row, or null.
// The patch only ever sets status, the responded/returned date when empty,
// and (submittals) the stamp when none is recorded; text fields are never
// written. `prev` holds the old values so a person can Undo it.
// A change a person undid is not re-applied from the same (or an older)
// event; only a newer portal event can move the item again.
const undoneFor = (row, it) => !!(row && row.intakeStatus && row.intakeStatus.undone && (row.intakeStatus.eventDate || "") >= (it.lastDate || ""));
export function statusUpdateFor(it, kind, logged, opts = {}) {
  if (kind === "rfi") {
    const to = RFI_UPDATE_EVENTS[it.lastEvent]; if (!to) return null;
    const row = strictRfiRow(it, logged); if (!row || !row.id || undoneFor(row, it)) return null;
    const from = row.status || "";
    if (!(from in RFI_RANK) || RFI_RANK[to] <= RFI_RANK[from]) return null;
    const patch = { status: to }, prev = { status: from };
    if (!row.dateResponded && it.lastDate) { patch.dateResponded = it.lastDate; prev.dateResponded = row.dateResponded || ""; }
    return { row, from, to, patch, prev };
  }
  if (it.status !== "Returned") return null;
  const row = strictSubRow(it, logged); if (!row || !row.id || undoneFor(row, it)) return null;
  const from = row.status || "";
  if (!(from in SUB_RANK) || SUB_RANK.Returned <= SUB_RANK[from]) return null;
  const patch = { status: "Returned" }, prev = { status: from };
  if (!row.dateReturned && it.lastDate) { patch.dateReturned = it.lastDate; prev.dateReturned = row.dateReturned || ""; }
  if (it.stamp && (!row.stamp || row.stamp === "—")) { patch.stamp = it.stamp; prev.stamp = row.stamp || "—"; }
  return { row, from, to: "Returned", patch, prev };
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
// Which portals the unattended intake reads for one project. A confirmed CA
// platform (project.caPortal, set in the tracker) names the ONE portal whose
// mail becomes log items, so a Newforma job never also imports the Procore
// copy of the same RFI under the contractor's number, and vice versa. With
// nothing confirmed, Procore only (its numbering is the contractor's own and
// it was the first portal proven against the log). PMWeb and email-only jobs
// import nothing unattended.
export const PLATFORM_VENDORS = { "Procore": ["Procore"], "Autodesk Build": ["Autodesk Forma"], "Newforma": ["Newforma"], "Kahua": ["Kahua"], "PMWeb": [], "Email only": [] };
export function intakeVendorsFor(project) {
  const p = project && project.caPortal && project.caPortal.platform;
  return p && PLATFORM_VENDORS[p] ? PLATFORM_VENDORS[p] : ["Procore"];
}
export function planIntake(emails, project, pid, opts = {}) {
  // opts.vendors is what the caller allows; the project's platform narrows it.
  const allowed = opts.vendors || ["Procore"];
  const vendorNames = intakeVendorsFor(project).filter((v) => allowed.includes(v));
  const since = opts.since || "";
  const at = opts.at || new Date().toISOString();
  const rfis = Array.isArray(project && project.rfis) ? project.rfis : [];
  const subs = Array.isArray(project && project.submittals) ? project.submittals : [];
  const inbox = buildInbox(emails, rfis, subs, pid, VENDORS.filter((v) => vendorNames.includes(v.vendor)));
  const out = { rfis: [], submittals: [], updates: [], skipped: { matched: 0, update: 0, old: 0 } };
  const have = new Set([...rfis, ...subs].map((r) => r && r.id));
  for (const kind of ["rfi", "submittal"]) {
    for (const it of inbox[kind]) {
      if (it.verdict !== "new") {
        // A logged item: maybe its status moved forward in the portal (recent events only).
        const u = opts.updates !== false && it.verdict === "matched" && !(since && (it.lastDate || "") < since)
          ? statusUpdateFor(it, kind, kind === "rfi" ? rfis : subs) : null;
        if (u) {
          out.updates.push({ kind, id: u.row.id, number: u.row.number, from: u.from, to: u.to, patch: u.patch,
            intakeStatus: { from: u.from, to: u.to, prev: u.prev, at, by: "ca-items-intake", vendor: it.vendor,
              emailId: it.lastRecordId || it.recordId || "", eventDate: it.lastDate || "", reviewed: false } });
        } else out.skipped[it.verdict === "update" ? "update" : "matched"]++;
        continue;
      }
      if (since && (it.lastDate || "") < since) { out.skipped.old++; continue; }
      if (have.has(it.record.id)) { out.skipped.matched++; continue; }
      have.add(it.record.id);
      const rec = { ...it.record, intakeReviewed: false, intake: { at, by: "ca-items-intake", vendor: it.vendor } };
      (kind === "rfi" ? out.rfis : out.submittals).push(rec);
    }
  }
  return out;
}

// Apply planIntake's updates to a project's arrays (pure; returns new arrays).
// The row is found again by id, and its status must still be the one the plan
// saw, so a person's edit between plan and write always wins.
export function applyStatusUpdates(project, updates) {
  const by = { rfi: (project.rfis || []).slice(), submittal: (project.submittals || []).slice() };
  let applied = 0;
  for (const u of updates || []) {
    const arr = by[u.kind], i = arr.findIndex((r) => r && r.id === u.id);
    if (i < 0 || (arr[i].status || "") !== u.from) continue;
    arr[i] = { ...arr[i], ...u.patch, intakeStatus: u.intakeStatus };
    applied++;
  }
  return { rfis: by.rfi, submittals: by.submittal, applied };
}

/* ---------- which CA platform a project runs on ---------- */
// Read from the filed notification emails, for the tracker's platform badge.
// A guess until someone confirms it on the project (project.caPortal).
export const CA_PLATFORMS = ["Procore", "Autodesk Build", "Newforma", "Kahua", "PMWeb", "Email only"];
export function platformOfEmail(e) {
  const from = (e && e.from_address) || "", subj = (e && e.subject) || "";
  if (/procoretech/i.test(from)) return "Procore";
  if (/forma\.autodesk|autodesk\.com|acc\.autodesk|bim360/i.test(from)) return "Autodesk Build";
  if (/newforma/i.test(from) || /\b(RFI|Submittal)\s*Forwarded\s*:/i.test(subj) || /Responded to and Closed:/i.test(subj)) return "Newforma";
  if (/kahua\.com/i.test(from)) return "Kahua";
  if (/pmweb/i.test(from) || /\bPMWeb\b/i.test(subj)) return "PMWeb";
  return "";
}
// {projectId: {platform: count}} → {projectId: {platform, counts, total}};
// platform is the one with the most emails (ties: CA_PLATFORMS order).
export function detectPlatforms(emails) {
  const by = {};
  for (const e of emails || []) {
    const p = platformOfEmail(e); if (!p) continue;
    const pid = String(e.project_id || "");
    const c = (by[pid] = by[pid] || {}); c[p] = (c[p] || 0) + 1;
  }
  const out = {};
  for (const [pid, counts] of Object.entries(by)) {
    const platform = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || CA_PLATFORMS.indexOf(a) - CA_PLATFORMS.indexOf(b))[0];
    out[pid] = { platform, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  }
  return out;
}
