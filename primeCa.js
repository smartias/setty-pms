// primeCa.js — construction administration when SETTY IS PRIME.
//
// On a sub job the GC's or prime's portal (Procore, Newforma, …) is the record
// and the PMS mirrors it. On a prime job there is no portal: the contractor
// emails RFIs and submittals to us, we route them to our subconsultants, and
// the PMS log IS the official record. This module holds the pure rules for
// that, shared by SettyPMS.html (window.PrimeCa) and primeCa.test.mjs:
//
//   - settyIsPrime: is the project's Prime set to Setty?
//   - nextCaNumber: the next RFI / submittal number. Numbers are never reused,
//     even after a delete (a high-water mark rides on the project).
//   - canDeleteCaItem: on prime jobs an issued item can be voided, not deleted.
//   - ballInCourt: who owes the next move (Setty, a sub, the contractor).
//   - subDueDefault / subRoutingState: the sub's internal deadline, earlier
//     than the contractor's, and whether the sub is late.
//   - findIntakeCandidates: filed emails that look like a contractor's RFI or
//     submittal and are not in the log yet.
//
// Pure: no DOM, no fetch. Dates are YYYY-MM-DD strings.

/* ---------- prime detection ---------- */
// Same substring rule as isSettyFirm in SettyPMS.html ("Setty", "Setty &
// Associates", "Setty Engineering" all match).
export function isSettyFirm(name) {
  return !!(name && String(name).toLowerCase().includes("setty"));
}
// An unset Prime is NOT prime mode: the prime-only rules (no delete, routing
// deadlines) switch on only when someone has said Setty is prime.
export function settyIsPrime(project) {
  return !!project && isSettyFirm(project.prime);
}

/* ---------- numbering ---------- */
export const CA_PREFIX = { rfi: "RFI-", submittal: "SUB-" };

// Trailing integer of a log number: "RFI-012" → 12, "SUB-7" → 7, "014" → 14,
// "RFI-12.1" → 12 (a revision suffix does not bump the series). null if none.
export function numberValue(num) {
  const m = String(num == null ? "" : num).match(/(\d+)(?:\.\d+)?\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

// Next number for a new item: one past the highest number ever used, counting
// both the items still in the log and the project's high-water mark (which
// remembers deleted ones). The old rule (count + 1) reissued a number after a
// delete and could collide with an existing item.
export function nextCaNumber(items, type, highWater) {
  let max = Number.isFinite(+highWater) ? +highWater : 0;
  for (const it of items || []) {
    const n = numberValue(it && it.number);
    if (n != null && n > max) max = n;
  }
  return { number: CA_PREFIX[type] + String(max + 1).padStart(3, "0"), value: max + 1 };
}

// The project's high-water mark after adding `value`.
export function bumpHighWater(project, type, value) {
  const cur = (project && project.caNumberHighWater) || {};
  const prev = Number.isFinite(+cur[type]) ? +cur[type] : 0;
  return { ...cur, [type]: Math.max(prev, value || 0) };
}

/* ---------- issued / delete rules ---------- */
const ISSUED = { rfi: ["Responded", "Closed"], submittal: ["Returned", "Resubmittal Required"] };

// Has this item gone out to the contractor? A response date, a response
// status, or a recorded issue all count.
export function isIssued(item, type) {
  if (!item) return false;
  if (item.issuedAt) return true;
  if (type === "rfi" && item.dateResponded) return true;
  if (type === "submittal" && item.dateReturned) return true;
  return (ISSUED[type] || []).includes(item.status);
}

// { ok, reason }. Sub jobs: anything can be deleted (the portal is the
// record). Prime jobs: an item that was issued, or that came from a filed
// contractor email, stays in the log; Void is the way to retire it.
export function canDeleteCaItem(project, item, type) {
  if (!settyIsPrime(project)) return { ok: true, reason: "" };
  if (isIssued(item, type)) {
    return { ok: false, reason: "It has already been issued to the contractor. On a job where Setty is prime the PMS log is the official record, so set its status to Void instead." };
  }
  if (item && item.sourceEmail && item.sourceEmail.recordId) {
    return { ok: false, reason: "It was logged from a contractor's email, so it is part of the official record. Set its status to Void instead (for example if it was a duplicate)." };
  }
  return { ok: true, reason: "" };
}

/* ---------- working days ---------- */
function parseDay(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
const fmtDay = (d) => d.toISOString().slice(0, 10);
// Add (or with a negative n, subtract) working days, skipping weekends.
export function addWorkdays(day, n) {
  const d = parseDay(day);
  if (!d) return "";
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return fmtDay(d);
}

// Default lead between the sub's deadline and the contractor's: Setty needs
// time to check the sub's answer and issue it under our name.
export const SUB_LEAD_WORKDAYS = 2;

// The sub's internal due date: SUB_LEAD_WORKDAYS before the contractor's due
// date, but never earlier than the next working day after `today`.
export function subDueDefault(contractorDue, today, lead) {
  const floor = addWorkdays(today, 1);
  if (!parseDay(contractorDue)) return floor;
  const d = addWorkdays(contractorDue, -(lead == null ? SUB_LEAD_WORKDAYS : lead));
  return d < floor ? floor : d;
}

/* ---------- sub routing ---------- */
// item.subRouting = { subId, firm, sentAt, dueDate, respondedAt }
// state: "none" | "waiting" | "late" | "responded"
export function subRoutingState(item, today) {
  const r = item && item.subRouting;
  if (!r || !r.sentAt) return { state: "none", daysLate: 0 };
  if (r.respondedAt) return { state: "responded", daysLate: 0 };
  const due = parseDay(r.dueDate), now = parseDay(today);
  if (due && now && now > due) return { state: "late", daysLate: Math.round((now - due) / 86400000) };
  return { state: "waiting", daysLate: 0 };
}

/* ---------- ball in court ---------- */
const CLOSED = { rfi: ["Closed", "Void"], submittal: ["Void"] };
const WITH_CONTRACTOR = { rfi: ["Responded"], submittal: ["Returned", "Resubmittal Required"] };
const WITH_SUB = { rfi: ["Pending Sub Response"], submittal: ["Pending Sub Review"] };

// Who owes the next move. { who: "setty"|"sub"|"contractor"|"none", label }.
// A sub that was sent the item and has not answered holds the ball even if
// someone forgot to move the status.
export function ballInCourt(item, type, subs) {
  if (!item) return { who: "none", label: "" };
  const st = item.status || "";
  if ((CLOSED[type] || []).includes(st)) return { who: "none", label: "" };
  if ((WITH_CONTRACTOR[type] || []).includes(st)) return { who: "contractor", label: "Contractor" };
  const r = item.subRouting || {};
  const waitingOnSub = (WITH_SUB[type] || []).includes(st) || (r.sentAt && !r.respondedAt);
  if (waitingOnSub) {
    const sub = (subs || []).find((s) => s && s.id === (r.subId || item.subAssigned));
    const firm = r.firm || (sub && (sub.firm || sub.name)) || "";
    return { who: "sub", label: firm ? "Sub: " + firm : "Sub" };
  }
  return { who: "setty", label: "Setty" };
}

/* ---------- intake from contractor emails ---------- */
// Subjects WE send (assignment, sub forward, response/return) and replies to
// them. These are never a new contractor item.
const OUR_SUBJECTS = /(RFI|Submittal)\s+Assignment:|Sub Response Requested|RFI Response:|Submittal Return\b/i;
const RFI_RE = /\bRFI\b(?:\s*(?:#|No\.?|Number)?\s*[-:]?\s*([A-Z]{0,4}-?\d{1,4}(?:\.\d+)?))?/i;
const SUBMITTAL_RE = /\b(submittal|shop\s*drawings?|product\s*data|cut\s*sheets?)\b/i;
const SPEC_RE = /\b(\d{2})\s?(\d{2})\s?(\d{2})(?:\.\d+)?\b/;

// "RE: FW: RFI #12 – Duct clash" → "RFI #12 – Duct clash"
export function cleanSubject(s) {
  let t = String(s || "").trim();
  for (;;) {
    const next = t.replace(/^\s*(re|fw|fwd|aw|wg)\s*:\s*/i, "");
    if (next === t) break;
    t = next;
  }
  return t.trim();
}

// What kind of contractor item does this subject look like? null if neither.
// { type, ref, specSection, title }
export function classifyContractorEmail(subject) {
  const s = cleanSubject(subject);
  if (!s || OUR_SUBJECTS.test(s)) return null;
  const rfi = s.match(RFI_RE);
  if (rfi) {
    const ref = rfi[1] ? rfi[1].replace(/^[-:]/, "") : "";
    const title = s.slice(rfi.index + rfi[0].length).replace(/^[\s\-–—:,#|]+/, "").trim() || s;
    return { type: "rfi", ref, specSection: "", title };
  }
  if (SUBMITTAL_RE.test(s)) {
    const sp = s.match(SPEC_RE);
    return { type: "submittal", ref: "", specSection: sp ? sp[1] + " " + sp[2] + " " + sp[3] : "", title: s };
  }
  return null;
}

// Filed emails that look like a contractor RFI / submittal and are not in the
// log yet. Skips: our own outgoing mail (from a Setty address or with one of
// our subjects), portal notifications (the scheduled intake handles those),
// replies ("RE:") — a reply is part of an existing thread, not a new item —,
// emails already logged (item.sourceEmail.recordId) and ones a person
// dismissed. Newest first. emails: pms_project_emails rows.
export const PORTAL_SENDERS = /procore|autodesk|newforma|pmweb|e-builder|ebuilder|kahua/i;
export function findIntakeCandidates(emails, project, opts) {
  const o = opts || {};
  const settyDomains = (o.settyDomains || ["setty.com", "setty.onmicrosoft.com"]).map((d) => d.toLowerCase());
  const logged = new Set();
  for (const k of ["rfis", "submittals"]) {
    for (const it of (project && project[k]) || []) {
      if (it && it.sourceEmail && it.sourceEmail.recordId) logged.add(String(it.sourceEmail.recordId));
    }
  }
  const dismissed = new Set(((project && project.caIntakeDismissed) || []).map(String));
  const out = [];
  for (const e of emails || []) {
    if (!e || !e.record_id) continue;
    const id = String(e.record_id);
    if (logged.has(id) || dismissed.has(id)) continue;
    const from = String(e.from_address || "").toLowerCase();
    if (settyDomains.some((d) => from.endsWith("@" + d) || from.endsWith("." + d))) continue;
    if (from.includes("setty")) continue;
    if (PORTAL_SENDERS.test(from)) continue;
    if (/^\s*(re|aw)\s*:/i.test(String(e.subject || ""))) continue;
    const c = classifyContractorEmail(e.subject);
    if (!c) continue;
    out.push({
      recordId: id, type: c.type, ref: c.ref, specSection: c.specSection, title: c.title,
      subject: String(e.subject || ""), fromName: e.from_name || "", fromAddress: e.from_address || "",
      date: String(e.email_date || "").slice(0, 10),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// A new log item built from a candidate. `base` is the empty item the PMS
// makes (newRFI / newSubmittal) so every default field stays; this fills in
// what the email says and records where it came from.
export function itemFromCandidate(base, cand, bodyText, dueDays) {
  const received = cand.date || base.dateReceived;
  const text = String(bodyText || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
  const item = {
    ...base,
    from: cand.fromName || cand.fromAddress || base.from,
    dateReceived: received,
    dueDate: addWorkdays(received, dueDays),
    contractorRef: cand.ref || "",
    sourceEmail: { recordId: cand.recordId, subject: cand.subject, from: cand.fromAddress || cand.fromName, date: cand.date },
  };
  if (cand.type === "rfi") { item.title = cand.title; item.description = text; }
  else { item.description = cand.title; item.specSection = cand.specSection || base.specSection || ""; item.notes = text ? "From the contractor's email:\n" + text : base.notes; }
  return item;
}

/* ---------- distribution lists ---------- */
// project.caDistribution = { rfi: { to: "a@x.com; b@y.com", cc: "…" }, submittal: { … } }
// Who gets every outgoing RFI response / submittal return, so each one goes to
// the same people. Stored as the text the person typed; parsed on use.
const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Every address in a free-text list ("Bob <bob@gc.com>; ann@x.com"),
// lower-cased and de-duplicated, in the order written.
export function parseEmails(text) {
  const seen = new Set(), out = [];
  for (const m of String(text || "").match(EMAIL_RE) || []) {
    const a = m.toLowerCase();
    if (!seen.has(a)) { seen.add(a); out.push(a); }
  }
  return out;
}
// { to, cc } for an outgoing response. `extraTo` (e.g. the contractor who
// emailed the item in) goes first in To; an address never appears twice, and
// To wins over Cc.
export function distributionFor(project, type, extraTo) {
  const d = ((project && project.caDistribution) || {})[type] || {};
  const to = parseEmails([...(extraTo || []), d.to || ""].join(";"));
  const cc = parseEmails(d.cc || "").filter((a) => !to.includes(a));
  return { to, cc };
}

/* ---------- log export (the official record) ---------- */
// Header + rows for a dated log export (CSV or printable PDF). One row per
// item, oldest number first, with every date the record carries: received,
// due, sent to sub, sub due, sub answered, issued, and where it came from.
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
export function caLogRows(project, type) {
  const isRFI = type === "rfi";
  const items = [...((project && project[isRFI ? "rfis" : "submittals"]) || [])]
    .sort((a, b) => (numberValue(a.number) || 0) - (numberValue(b.number) || 0) || String(a.number).localeCompare(String(b.number)));
  const subs = (project && project.subconsultants) || [];
  const subName = (it) => {
    const r = it.subRouting || {};
    const s = subs.find((x) => x && x.id === (r.subId || it.subAssigned));
    return r.firm || (s && (s.firm || s.name)) || "";
  };
  const headers = [
    "Number", "Contractor ref", isRFI ? "Subject" : "Description", ...(isRFI ? [] : ["Spec section"]), "Discipline", "From",
    "Received", "Due", "Status", ...(isRFI ? [] : ["Stamp"]), "Ball in court",
    "Subconsultant", "Sent to sub", "Sub due", "Sub answered",
    isRFI ? "Responded" : "Returned", "Issued", isRFI ? "Question" : "Notes", isRFI ? "Response" : "Review comments", "Logged from email",
  ];
  const rows = items.map((it) => {
    const r = it.subRouting || {};
    const src = it.sourceEmail ? `${it.sourceEmail.date || ""} ${it.sourceEmail.from || ""}: ${it.sourceEmail.subject || ""}`.trim() : "";
    return [
      it.number || "", it.contractorRef || "", isRFI ? (it.title || "") : (it.description || ""), ...(isRFI ? [] : [it.specSection || ""]),
      it.discipline || "", it.from || "", it.dateReceived || "", it.dueDate || "", it.status || "",
      ...(isRFI ? [] : [it.stamp && it.stamp !== "—" ? it.stamp : ""]), ballInCourt(it, type, subs).label,
      subName(it), r.sentAt || "", r.dueDate || "", r.respondedAt || "",
      (isRFI ? it.dateResponded : it.dateReturned) || "", String(it.issuedAt || "").slice(0, 10),
      strip(isRFI ? it.description : it.notes), strip(isRFI ? it.response : it.comments), src,
    ];
  });
  return { headers, rows };
}
