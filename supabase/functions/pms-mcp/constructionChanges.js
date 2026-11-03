// constructionChanges.js — the construction-phase change workflow for jobs
// where SETTY IS PRIME (the PMS is the record; see primeCa.js).
//
// One array, project.constructionChanges, holds five kinds of document:
//   ASI  — supplemental instruction: clarifies or makes a minor change with
//          no change in cost or time. Issued by Setty.
//   PR   — proposal request: revised documents sent to the contractor asking
//          them to price a change. Issued by Setty.
//   CCD  — construction change directive: the owner directs the work before a
//          price is agreed (an estimate rides on it until a CO settles it).
//   COR  — change order request: the CONTRACTOR's price and days for a change
//          (in answer to a PR, an ASI they say costs money, an RFI answer, or a
//          field condition). Setty reviews it and recommends an amount.
//   CO   — change order: signed by the owner; bundles recommended CORs and
//          signed CCDs and changes the contract sum and time.
// project.constructionContract = { contractor, originalSum, originalDays }
// holds the base the running totals start from.
//
// Pure: no DOM, no fetch. Dates are YYYY-MM-DD; money is a number of dollars.

export const KINDS = ["ASI", "PR", "CCD", "COR", "CO"];
export const KIND_LABEL = {
  ASI: "Supplemental Instruction",
  PR: "Proposal Request",
  CCD: "Construction Change Directive",
  COR: "Change Order Request (contractor)",
  CO: "Change Order",
};
export const STATUSES = {
  ASI: ["Draft", "Issued", "Void"],
  PR: ["Draft", "Issued", "Pricing Received", "Closed", "Void"],
  CCD: ["Draft", "Issued", "Signed by Owner", "Finalized in CO", "Void"],
  COR: ["Received", "Under Review", "Pending Sub Review", "Revise and Resubmit", "Recommended", "Not Recommended", "Approved in CO", "Withdrawn", "Void"],
  CO: ["Draft", "Sent for Signature", "Executed", "Void"],
};
const FIRST_STATUS = { ASI: "Draft", PR: "Draft", CCD: "Draft", COR: "Received", CO: "Draft" };
// Statuses after which the document has left Setty (cannot be deleted).
const ISSUED = {
  ASI: ["Issued"], PR: ["Issued", "Pricing Received", "Closed"], CCD: ["Issued", "Signed by Owner", "Finalized in CO"],
  COR: [], CO: ["Sent for Signature", "Executed"],
};
const DONE = {
  ASI: ["Issued", "Void"], PR: ["Closed", "Void"], CCD: ["Finalized in CO", "Void"],
  COR: ["Approved in CO", "Not Recommended", "Withdrawn", "Void"], CO: ["Executed", "Void"],
};

/* ---------- numbers & money ---------- */
export function money(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
const num = (v) => money(v) || 0;
export function days(v) {
  if (v === "" || v == null) return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function numberValue(n) {
  const m = String(n == null ? "" : n).match(/(\d+)(?:\.\d+)?\s*$/);
  return m ? parseInt(m[1], 10) : null;
}
// Next number for a kind ("COR-004"): one past the highest ever used, counting
// the high-water mark project.caNumberHighWater[kind] so a delete never
// reissues a number (same rule as RFIs and submittals).
export function nextChangeNumber(project, kind) {
  let max = +((project && project.caNumberHighWater) || {})[kind] || 0;
  for (const c of (project && project.constructionChanges) || []) {
    if (c && c.kind === kind) { const n = numberValue(c.number); if (n != null && n > max) max = n; }
  }
  return { number: kind + "-" + String(max + 1).padStart(3, "0"), value: max + 1 };
}

/* ---------- create / status / history ---------- */
// A new document of `kind`. `fields` overrides; `ctx` = { id, today, by }.
export function newChange(project, kind, fields, ctx) {
  const c = ctx || {};
  const today = c.today || "";
  const item = {
    id: c.id || "", kind, number: nextChangeNumber(project, kind).number,
    title: "", description: "", status: FIRST_STATUS[kind], discipline: "",
    date: today, dueDate: "", contractorRef: "",
    amountRequested: null, daysRequested: null,       // COR: the contractor's price
    amountRecommended: null, daysRecommended: null,   // COR: Setty's recommendation
    amountEstimate: null,                             // CCD / PR: estimate
    amountApproved: null, daysApproved: null,         // CO (and CCD once finalized)
    sourceIds: [], relatedRfiIds: [], coId: "", subAssigned: "",
    sheets: "", notes: "", spFolderUrl: "",
    history: [{ at: c.at || today, by: c.by || "", status: FIRST_STATUS[kind], note: "Created" }],
    ...(fields || {}),
  };
  return item;
}

// The project with `item` appended and the kind's high-water mark bumped.
export function withChange(project, item) {
  const hw = { ...((project && project.caNumberHighWater) || {}) };
  hw[item.kind] = Math.max(+hw[item.kind] || 0, numberValue(item.number) || 0);
  return { ...project, constructionChanges: [...((project && project.constructionChanges) || []), item], caNumberHighWater: hw };
}

// Status change with a dated history line (the audit trail of the record).
export function setStatus(item, status, ctx) {
  if (!item || item.status === status) return item;
  const c = ctx || {};
  return { ...item, status, history: [...(item.history || []), { at: c.at || "", by: c.by || "", status, from: item.status, note: c.note || "" }] };
}

export function isIssued(item) {
  return !!item && (ISSUED[item.kind] || []).includes(item.status);
}
export function isDone(item) {
  return !!item && (DONE[item.kind] || []).includes(item.status);
}
// A draft can be deleted; anything that left Setty, any COR (the contractor's
// document) and anything bundled into a change order is voided instead.
export function canDelete(item) {
  if (!item) return { ok: false, reason: "" };
  if (item.kind === "COR") return { ok: false, reason: "A change order request is the contractor's document and part of the record. Set it to Withdrawn or Void instead." };
  if (item.coId) return { ok: false, reason: "It is included in a change order. Remove it from that change order first, or set it to Void." };
  if (isIssued(item) || item.status === "Void") return { ok: false, reason: "It has already been issued. Set its status to Void instead; the record keeps it." };
  return { ok: true, reason: "" };
}

/* ---------- ball in court ---------- */
export function ballInCourt(item) {
  if (!item || isDone(item)) return { who: "none", label: "" };
  const s = item.status;
  const m = {
    ASI: { Draft: "setty" },
    PR: { Draft: "setty", Issued: "contractor", "Pricing Received": "setty" },
    CCD: { Draft: "setty", Issued: "owner", "Signed by Owner": "contractor" },
    COR: { Received: "setty", "Under Review": "setty", "Pending Sub Review": "sub", "Revise and Resubmit": "contractor", Recommended: "owner" },
    CO: { Draft: "setty", "Sent for Signature": "owner" },
  };
  const who = (m[item.kind] || {})[s] || "none";
  const label = { setty: "Setty", sub: "Sub", contractor: "Contractor", owner: "Owner", none: "" }[who];
  return { who, label };
}

/* ---------- linking ---------- */
// A contractor COR answering a PR / ASI / CCD (or several).
export function corFromSources(project, sources, ctx) {
  const list = (sources || []).filter(Boolean);
  const first = list[0] || {};
  return newChange(project, "COR", {
    title: first.title || "",
    discipline: first.discipline || "",
    sourceIds: list.map((s) => s.id),
    relatedRfiIds: [...new Set(list.flatMap((s) => s.relatedRfiIds || []))],
  }, ctx);
}

// What a change order would carry for a COR or CCD.
export function coLineAmount(item) {
  if (!item) return { amount: 0, days: 0 };
  if (item.kind === "COR") {
    const a = money(item.amountRecommended) ?? money(item.amountRequested) ?? 0;
    const d = days(item.daysRecommended) ?? days(item.daysRequested) ?? 0;
    return { amount: a, days: d };
  }
  if (item.kind === "CCD") return { amount: money(item.amountApproved) ?? money(item.amountEstimate) ?? 0, days: days(item.daysApproved) ?? 0 };
  return { amount: 0, days: 0 };
}

// CORs and CCDs that can go into a change order: recommended CORs and signed
// CCDs not already in another (non-void) CO. `coId` = the CO being edited,
// whose own members stay eligible.
export function eligibleForCo(changes, coId) {
  const live = new Set((changes || []).filter((c) => c.kind === "CO" && c.status !== "Void").map((c) => c.id));
  return (changes || []).filter((c) => {
    if (c.coId && c.coId !== coId && live.has(c.coId)) return false;
    if (c.kind === "COR") return c.status === "Recommended" || (coId && c.coId === coId);
    if (c.kind === "CCD") return c.status === "Signed by Owner" || (coId && c.coId === coId);
    return false;
  });
}

// Set a CO's members: marks members' coId, clears it on dropped ones, and
// fills the CO amount/days from the members (the person can still edit them).
export function setCoMembers(changes, coId, memberIds) {
  const ids = new Set(memberIds || []);
  let amount = 0, d = 0;
  const out = (changes || []).map((c) => {
    if (c.id === coId) return c;
    if (ids.has(c.id)) { const l = coLineAmount(c); amount += l.amount; d += l.days; return { ...c, coId }; }
    if (c.coId === coId) return { ...c, coId: "" };
    return c;
  });
  return out.map((c) => (c.id === coId ? { ...c, sourceIds: [...ids], amountApproved: Math.round(amount * 100) / 100, daysApproved: d } : c));
}

// The owner signed the CO: it becomes Executed and its members close
// (CORs → "Approved in CO", CCDs → "Finalized in CO").
export function executeCo(changes, coId, ctx) {
  return (changes || []).map((c) => {
    if (c.id === coId) return setStatus(c, "Executed", ctx);
    if (c.coId === coId && c.kind === "COR") return setStatus(c, "Approved in CO", ctx);
    if (c.coId === coId && c.kind === "CCD") return setStatus(c, "Finalized in CO", ctx);
    return c;
  });
}

// A voided CO releases its members so they can go into another one.
export function voidCo(changes, coId, ctx) {
  return (changes || []).map((c) => {
    if (c.id === coId) return setStatus(c, "Void", ctx);
    if (c.coId === coId) return { ...c, coId: "" };
    return c;
  });
}

/* ---------- running totals ---------- */
// The contract sum and time as the record stands.
//   approved  — executed change orders
//   pendingCo — change orders out for signature
//   ccdOpen   — CCDs issued or signed but not yet in an executed CO (estimate)
//   corOpen   — CORs still under review or recommended, not in any CO
//               (Setty's recommended amount when there is one, else requested)
//   projected — revised + pendingCo + ccdOpen + corOpen
export function changeTotals(project) {
  const k = (project && project.constructionContract) || {};
  const original = num(k.originalSum);
  const originalDays = days(k.originalDays) || 0;
  const all = (project && project.constructionChanges) || [];
  const t = { original, originalDays, approved: 0, approvedDays: 0, approvedCount: 0, pendingCo: 0, ccdOpen: 0, corOpen: 0, corOpenCount: 0 };
  const coIds = new Set(all.filter((c) => c.kind === "CO" && c.status !== "Void").map((c) => c.id));
  for (const c of all) {
    if (c.kind === "CO" && c.status === "Executed") { t.approved += num(c.amountApproved); t.approvedDays += days(c.daysApproved) || 0; t.approvedCount++; }
    else if (c.kind === "CO" && c.status === "Sent for Signature") t.pendingCo += num(c.amountApproved);
    else if (c.kind === "CCD" && ["Issued", "Signed by Owner"].includes(c.status) && !(c.coId && coIds.has(c.coId))) t.ccdOpen += coLineAmount(c).amount;
    else if (c.kind === "COR" && ["Received", "Under Review", "Pending Sub Review", "Revise and Resubmit", "Recommended"].includes(c.status) && !(c.coId && coIds.has(c.coId))) {
      t.corOpen += coLineAmount(c).amount; t.corOpenCount++;
    }
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  t.approved = r2(t.approved); t.pendingCo = r2(t.pendingCo); t.ccdOpen = r2(t.ccdOpen); t.corOpen = r2(t.corOpen);
  t.revised = r2(original + t.approved);
  t.revisedDays = originalDays + t.approvedDays;
  t.pending = r2(t.pendingCo + t.ccdOpen + t.corOpen);
  t.projected = r2(t.revised + t.pending);
  t.pctApproved = original ? Math.round((t.approved / original) * 1000) / 10 : null;
  t.pctProjected = original ? Math.round(((t.projected - original) / original) * 1000) / 10 : null;
  return t;
}

/* ---------- log export ---------- */
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const kindOrder = (k) => KINDS.indexOf(k);
// Header + rows for the dated change log (Excel / PDF), grouped by kind then
// number, with every amount, the links between documents, and the status
// history in one readable cell.
export function changeLogRows(project) {
  const all = [...((project && project.constructionChanges) || [])]
    .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || (numberValue(a.number) || 0) - (numberValue(b.number) || 0));
  const byId = new Map(all.map((c) => [c.id, c]));
  const rfis = new Map(((project && project.rfis) || []).map((r) => [r.id, r]));
  const m = (v) => (money(v) == null ? "" : money(v).toFixed(2));
  const headers = ["Number", "Type", "Title", "Status", "Ball in court", "Date", "Due", "Contractor ref", "Discipline",
    "Requested $", "Requested days", "Recommended $", "Recommended days", "Estimate $", "Approved $", "Approved days",
    "Change order", "Linked documents", "Related RFIs", "Affected sheets / specs", "Description", "Status history"];
  const rows = all.map((c) => [
    c.number || "", c.kind, c.title || "", c.status || "", ballInCourt(c).label, c.date || "", c.dueDate || "", c.contractorRef || "", c.discipline || "",
    m(c.amountRequested), days(c.daysRequested) ?? "", m(c.amountRecommended), days(c.daysRecommended) ?? "", m(c.amountEstimate), m(c.amountApproved), days(c.daysApproved) ?? "",
    (c.coId && byId.get(c.coId) && byId.get(c.coId).number) || "",
    (c.sourceIds || []).map((id) => (byId.get(id) || {}).number).filter(Boolean).join(", "),
    (c.relatedRfiIds || []).map((id) => (rfis.get(id) || {}).number).filter(Boolean).join(", "),
    c.sheets || "", strip(c.description),
    (c.history || []).map((h) => `${String(h.at || "").slice(0, 10)} ${h.status}${h.by ? " (" + h.by + ")" : ""}${h.note ? ": " + h.note : ""}`).join("; "),
  ]);
  return { headers, rows };
}
