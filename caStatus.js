// caStatus.js — the status rules for RFIs and submittals, in one place.
//
// SettyPMS.html (window.CaStatus) and RFISubmittalSync_Preview.html (the
// Tracker) both import this file, so the two cannot drift. The Outlook add-in
// (setty-pms-addin taskpane.js) keeps a copy of statusForStamp as
// subStatusForStamp: change both together.
//
// The rules:
//   1. When a submittal is ISSUED, its stamp sets the status. Revise and
//      Resubmit / Rejected → Resubmittal Required (the contractor's move);
//      anything else → Returned. An issued RFI is Responded. Picking a stamp
//      does not move the status by itself: the engineer stamps and marks the
//      answer ready, and the item stays open (and on the overdue clock) until
//      someone actually sends it back.
//   2. A status that means "our answer went out" gets its date. Responded or
//      Closed fills dateResponded; Returned or Resubmittal Required fills
//      dateReturned. Only when the date is empty: a date someone typed stays.
//   3. Overdue starts the day AFTER the due date, and only while the item is
//      ours to answer. Done statuses (answered, returned, with the contractor
//      for resubmittal, closed, void) are never overdue.
//
// Pure: no DOM, no fetch. Dates are YYYY-MM-DD strings in local time.

export const RFI_STATUSES = ["Open", "Pending Sub Response", "Responded", "Closed", "Void"];
export const SUBMITTAL_STATUSES = ["Received", "Under Review", "Pending Sub Review", "Returned", "Resubmittal Required", "Void"];

// Our answer has gone out (or the item is dead): the clock is stopped.
export const RFI_DONE_STATUSES = ["Responded", "Closed", "Void"];
export const SUBMITTAL_DONE_STATUSES = ["Returned", "Resubmittal Required", "Void"];
// RFI and submittal status names never overlap, so one list serves callers
// that do not know which kind of item they hold.
export const DONE_STATUSES = [...RFI_DONE_STATUSES, ...SUBMITTAL_DONE_STATUSES.filter((s) => s !== "Void")];

// Statuses that carry an "answered on" date (Void does not).
const DATED = { rfi: ["Responded", "Closed"], submittal: ["Returned", "Resubmittal Required"] };

const kindOf = (type) => (type === "rfi" ? "rfi" : "submittal");

export function localISO(d) {
  const x = d instanceof Date ? d : new Date();
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}

export function isRealStamp(stamp) {
  const s = String(stamp || "").trim();
  return !!s && s !== "—" && s !== "-";
}

// "" when the stamp is blank.
export function statusForStamp(stamp) {
  if (!isRealStamp(stamp)) return "";
  return stamp === "Revise and Resubmit" || stamp === "Rejected" ? "Resubmittal Required" : "Returned";
}

export function doneDateKey(type) {
  return kindOf(type) === "rfi" ? "dateResponded" : "dateReturned";
}

export function isDoneStatus(type, status) {
  return (kindOf(type) === "rfi" ? RFI_DONE_STATUSES : SUBMITTAL_DONE_STATUSES).includes(status || "");
}

// Rule 1: the status an item takes when our answer is sent.
export function issuedStatus(type, stamp) {
  return kindOf(type) === "rfi" ? "Responded" : (statusForStamp(stamp) || "Returned");
}

// Rule 2 applied to an edit. `prev` is the item before the edit, `next` after
// it; returns `next` with the date the rule adds.
export function applyStatusRules(prev, next, type, todayISO) {
  const kind = kindOf(type);
  const before = prev || {};
  const out = { ...next };
  const key = doneDateKey(kind);
  if ((out.status || "") !== (before.status || "") && DATED[kind].includes(out.status) && !out[key]) {
    out[key] = todayISO || localISO();
  }
  return out;
}

// Rule 3. An item the intake logged and nobody has confirmed yet is never
// overdue (a mis-read email must not raise an alarm).
export function isOverdue(item, todayISO) {
  if (!item || !item.dueDate) return false;
  if (item.intakeReviewed === false) return false;
  if (DONE_STATUSES.includes(item.status)) return false;
  return String(item.dueDate).slice(0, 10) < (todayISO || localISO());
}
