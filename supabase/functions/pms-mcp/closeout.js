// closeout.js — the closeout checklist for jobs where SETTY IS PRIME (the PMS
// is the record; see primeCa.js and constructionChanges.js).
//
// project.closeout = { items: [ item ], startedAt }
// item = { id, category, title, specSection, discipline, responsible,
//          required, status, dueDate, dateReceived, dateAccepted,
//          reviewerSubId, comments, notes, spFolderUrl, history[] }
//
// Each deliverable the contractor owes at the end of the job (O&M manuals,
// warranties, record drawings, attic stock, training, test reports, agency
// sign-offs, the completion certificates) moves Not Received → Received →
// Under Review → Accepted (or Revise and Resubmit, or Not Required).
// Pure: no DOM, no fetch. Dates are YYYY-MM-DD.

export const CATEGORIES = [
  "O&M Manual", "Warranty", "Record Drawings", "Attic Stock / Spare Parts", "Training",
  "Test & Balance", "Test Report / Certificate", "Inspection / Agency Sign-off", "Completion Certificate", "Other",
];
export const STATUSES = ["Not Received", "Received", "Under Review", "Revise and Resubmit", "Accepted", "Not Required"];
const DONE = ["Accepted", "Not Required"];

export function isDone(item) { return !!item && DONE.includes(item.status); }

/* ---------- the standard list ---------- */
// Typical MEP closeout deliverables, by discipline. Spec sections are the
// usual MasterFormat homes (Division 01 closeout sections; 23 05 93 TAB);
// a project's own specs may number them differently, so the PM edits them.
const G = "General";
export const TEMPLATE = [
  { d: G, c: "Completion Certificate", t: "Certificate of Substantial Completion", s: "01 77 00" },
  { d: G, c: "Completion Certificate", t: "Certificate of Final Completion", s: "01 77 00" },
  { d: G, c: "Record Drawings", t: "Record (as-built) drawings, all trades", s: "01 78 39" },
  { d: G, c: "O&M Manual", t: "Operation and maintenance manuals, all trades", s: "01 78 23" },
  { d: G, c: "Warranty", t: "Warranties and guarantees, all trades", s: "01 78 36" },
  { d: G, c: "Training", t: "Owner training sessions (agenda, sign-in sheets, recordings)", s: "01 79 00" },
  { d: G, c: "Inspection / Agency Sign-off", t: "Final inspections and agency sign-offs", s: "" },
  { d: "Mechanical", c: "Test & Balance", t: "Testing, adjusting and balancing (TAB) report", s: "23 05 93" },
  { d: "Mechanical", c: "Test Report / Certificate", t: "Equipment start-up reports (manufacturer's)", s: "" },
  { d: "Mechanical", c: "Record Drawings", t: "Building automation (controls) as-builts, sequences and points list", s: "" },
  { d: "Mechanical", c: "Training", t: "Controls / BAS training", s: "" },
  { d: "Mechanical", c: "Attic Stock / Spare Parts", t: "Spare filters and belts", s: "" },
  { d: "Mechanical", c: "Test Report / Certificate", t: "Duct and piping pressure test reports", s: "" },
  { d: "Electrical", c: "Test Report / Certificate", t: "Electrical testing reports (insulation resistance, grounding)", s: "" },
  { d: "Electrical", c: "Record Drawings", t: "Typed panel directories / panel schedules", s: "" },
  { d: "Electrical", c: "Test Report / Certificate", t: "Lighting controls functional test", s: "" },
  { d: "Electrical", c: "Attic Stock / Spare Parts", t: "Spare fuses, lamps and devices", s: "" },
  { d: "Plumbing", c: "Test Report / Certificate", t: "Domestic water disinfection and bacteriological test", s: "" },
  { d: "Plumbing", c: "Test Report / Certificate", t: "Backflow preventer test certificates", s: "" },
  { d: "Plumbing", c: "Test Report / Certificate", t: "Piping pressure test reports (water, waste, gas)", s: "" },
  { d: "Fire Protection", c: "Test Report / Certificate", t: "Contractor's material and test certificate (sprinkler)", s: "" },
  { d: "Fire Protection", c: "Attic Stock / Spare Parts", t: "Spare sprinkler heads and wrench cabinet", s: "" },
  { d: "Fire Protection", c: "Inspection / Agency Sign-off", t: "Fire alarm acceptance test and sign-off", s: "" },
];

// Which template disciplines a project gets: General always, plus each
// discipline named in `disciplines` (case-insensitive; "FP" / "Fire" match
// Fire Protection). An empty list means all of them.
export function templateFor(disciplines) {
  const want = (disciplines || []).map((d) => String(d).toLowerCase());
  const has = (name) => {
    if (!want.length || name === G) return true;
    const n = name.toLowerCase();
    return want.some((w) => w === n || n.startsWith(w) || (n === "fire protection" && /^(fp|fire)/.test(w)));
  };
  return TEMPLATE.filter((r) => has(r.d));
}

// Rows from the template that the checklist does not already hold (matched by
// title, case-insensitive), as new items. `ctx` = { newId(), at, by }.
export function seedItems(existing, disciplines, ctx) {
  const c = ctx || {};
  const have = new Set((existing || []).map((i) => String(i.title || "").trim().toLowerCase()));
  return templateFor(disciplines)
    .filter((r) => !have.has(r.t.toLowerCase()))
    .map((r) => newItem({ category: r.c, title: r.t, specSection: r.s, discipline: r.d === G ? "" : r.d }, { ...c, id: c.newId ? c.newId() : "" }));
}

export function newItem(fields, ctx) {
  const c = ctx || {};
  return {
    id: c.id || "", category: "Other", title: "", specSection: "", discipline: "", responsible: "",
    required: true, status: "Not Received", dueDate: "", dateReceived: "", dateAccepted: "",
    reviewerSubId: "", comments: "", notes: "", spFolderUrl: "",
    history: [{ at: c.at || "", by: c.by || "", status: "Not Received", note: "Added" }],
    ...(fields || {}),
  };
}

// Status change with a dated history line; fills dateReceived / dateAccepted
// the first time the item reaches those states.
export function setStatus(item, status, ctx) {
  if (!item || item.status === status) return item;
  const c = ctx || {};
  const day = String(c.at || "").slice(0, 10);
  const out = { ...item, status, history: [...(item.history || []), { at: c.at || "", by: c.by || "", status, from: item.status, note: c.note || "" }] };
  if (["Received", "Under Review", "Accepted"].includes(status) && !out.dateReceived) out.dateReceived = day;
  if (status === "Not Received") out.dateReceived = "";
  if (status === "Accepted") { if (!out.dateAccepted) out.dateAccepted = day; }
  else out.dateAccepted = "";
  return out;
}

/* ---------- who holds it ---------- */
// Completion certificates are issued BY Setty (as prime, after inspecting the
// work), not submitted by the contractor, so an unissued one is Setty's move.
export const ISSUED_BY_SETTY = ["Completion Certificate"];
const settyIssues = (i) => ISSUED_BY_SETTY.includes(i && i.category);
export function ballInCourt(item, subs) {
  if (!item || isDone(item)) return { who: "none", label: "" };
  if (settyIssues(item)) return { who: "setty", label: "Setty (issues it)" };
  if (item.status === "Not Received" || item.status === "Revise and Resubmit") return { who: "contractor", label: item.responsible ? "Contractor (" + item.responsible + ")" : "Contractor" };
  const sub = (subs || []).find((s) => s && s.id === item.reviewerSubId);
  if (sub) return { who: "sub", label: "Sub: " + (sub.firm || sub.name || "") };
  return { who: "setty", label: "Setty" };
}
export function isOverdue(item, today) {
  return !!item && !isDone(item) && item.required !== false && !!item.dueDate && String(item.dueDate).slice(0, 10) < today;
}

/* ---------- progress ---------- */
export function progress(items, today) {
  const req = (items || []).filter((i) => i.required !== false && i.status !== "Not Required");
  const accepted = req.filter((i) => i.status === "Accepted").length;
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = (items || []).filter((i) => i.status === s).length;
  const outstanding = req.filter((i) => i.status !== "Accepted");
  return {
    required: req.length, accepted, pct: req.length ? Math.round((accepted / req.length) * 100) : 0,
    outstanding: outstanding.length,
    withContractor: outstanding.filter((i) => ballInCourt(i).who === "contractor").length,
    inReview: outstanding.filter((i) => ballInCourt(i).who !== "contractor").length,
    overdue: (items || []).filter((i) => isOverdue(i, today)).length,
    byStatus,
    // Final completion needs everything else accepted first.
    readyForFinal: req.filter((i) => i.status !== "Accepted" && !/final completion/i.test(i.title || "")).length === 0 && req.length > 0,
  };
}

/* ---------- the request to the contractor ---------- */
// Required items the contractor still owes (not received, or sent back),
// grouped by category, for the "request outstanding items" email.
export function outstandingForContractor(items) {
  const rows = (items || []).filter((i) => i.required !== false && !settyIssues(i) && ["Not Received", "Revise and Resubmit"].includes(i.status));
  const order = (c) => { const k = CATEGORIES.indexOf(c); return k < 0 ? 99 : k; };
  return rows.slice().sort((a, b) => order(a.category) - order(b.category) || String(a.title).localeCompare(String(b.title)));
}

/* ---------- export ---------- */
export function closeoutLogRows(project) {
  const items = ((project && project.closeout && project.closeout.items) || []).slice();
  const order = (c) => { const k = CATEGORIES.indexOf(c); return k < 0 ? 99 : k; };
  items.sort((a, b) => order(a.category) - order(b.category) || String(a.discipline || "").localeCompare(String(b.discipline || "")) || String(a.title).localeCompare(String(b.title)));
  const subs = (project && project.subconsultants) || [];
  const headers = ["Category", "Item", "Spec section", "Discipline", "Responsible", "Required", "Status", "Ball in court",
    "Due", "Received", "Accepted", "Review comments", "Status history"];
  const rows = items.map((i) => [
    i.category || "", i.title || "", i.specSection || "", i.discipline || "", i.responsible || "", i.required === false ? "No" : "Yes",
    i.status || "", ballInCourt(i, subs).label, i.dueDate || "", i.dateReceived || "", i.dateAccepted || "", i.comments || "",
    (i.history || []).map((h) => `${String(h.at || "").slice(0, 10)} ${h.status}${h.by ? " (" + h.by + ")" : ""}${h.note ? ": " + h.note : ""}`).join("; "),
  ]);
  return { headers, rows };
}
