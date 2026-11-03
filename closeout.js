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
  "Test & Balance", "Commissioning", "Test Report / Certificate", "Inspection / Agency Sign-off",
  "Lien Releases / Affidavits", "Completion Certificate", "Other",
];
export const STATUSES = ["Not Received", "Received", "Under Review", "Revise and Resubmit", "Accepted", "Not Required"];
const DONE = ["Accepted", "Not Required"];

export function isDone(item) { return !!item && DONE.includes(item.status); }

/* ---------- the standard list ---------- */
// General and Mechanical follow SETTY'S MASTER SPECIFICATIONS (Knowledgebase,
// Mechanical/Specs and Narratives): Division 01 — 01 50 00 Project Closeout,
// 01 78 23 Operation and Maintenance Data, 01 78 39 Project Record Documents,
// 01 91 13 General Commissioning Requirements — and Division 23 — 23 05 93
// Testing, Adjusting and Balancing, 23 08 00 Commissioning of HVAC. `n` is the
// spec requirement, copied into the item's notes. Electrical, Plumbing and
// Fire Protection have no master spec sections in the Knowledgebase yet, so
// their rows are typical items with no section cited; a project's own specs
// may number anything differently, so the PM edits as needed.
const G = "General";
export const TEMPLATE = [
  // 01 50 00 Project Closeout
  { d: G, c: "Completion Certificate", t: "Certificate of Substantial Completion", s: "01 50 00",
    n: "Prepared by Setty (Owner's Representative) after the punch-list inspection. Establishes the Date of Substantial Completion (warranties start then), assigns security, maintenance, utilities and insurance, and sets the time to finish the listed items. Owner and Contractor accept it in writing." },
  { d: G, c: "Inspection / Agency Sign-off", t: "Contractor's written notice of readiness for final inspection", s: "01 50 00",
    n: "To the Owner's Representative and the Owner, in writing, 10 days before the project will be ready for final inspection." },
  { d: G, c: "Lien Releases / Affidavits", t: "Release of liens and certification that all bills are paid", s: "01 50 00",
    n: "For the Contractor and every subcontractor, in triplicate, notarized: a full release of liens and damages and a guarantee that all materials and labor are paid. Required before final acceptance." },
  { d: G, c: "Warranty", t: "Contractor's one-year guarantee", s: "01 50 00",
    n: "Written, notarized, in triplicate, before final acceptance. One year from the Date of Substantial Completion (longer where a section requires), in the wording given in 01 50 00." },
  { d: G, c: "Warranty", t: "Bonds, warranties and individual guarantees required by the technical sections", s: "01 50 00",
    n: "Delivered to the Owner through the Owner's Representative." },
  { d: G, c: "Record Drawings", t: "Record drawings (red-line as-builts)", s: "01 78 39",
    n: "Marked-up record prints showing every variation from the contract drawings (routing, concealed work, equipment locations, changes by change order or directive), then the final PDF set marked PROJECT RECORD DRAWINGS." },
  { d: G, c: "Record Drawings", t: "Record specifications", s: "01 78 39",
    n: "Annotated PDF plus one paper copy, including addenda and contract modifications, with the products actually installed (manufacturer, model, substitutions)." },
  { d: G, c: "Record Drawings", t: "Record product data", s: "01 78 39",
    n: "Annotated PDF of each submittal showing the product as installed, with a directory by spec section." },
  { d: G, c: "Test Report / Certificate", t: "Miscellaneous record submittals (tests, inspections by authorities having jurisdiction)", s: "01 78 39",
    n: "Records required by other sections, with a directory by spec section." },
  { d: G, c: "O&M Manual", t: "Operation and maintenance manuals (electronic)", s: "01 78 23",
    n: "Electronic only, no hard copies. Data packages as listed in each technical section, with an index; include sequences of operation updated to as-built. Due 30 days after the item is delivered to site; the Owner's Representative may withhold 50% of the item's price until received." },
  { d: G, c: "Training", t: "Owner training on systems and equipment", s: "01 78 23",
    n: "As required by the technical sections; the O&M manuals carry the manufacturers' training information." },
  { d: G, c: "Completion Certificate", t: "Certificate of Final Completion (recommending final acceptance)", s: "01 50 00",
    n: "Issued by Setty to the Owner after the final inspection and once the closeout documents are satisfactory. Unfinished minor items may be listed and excepted, with a sum withheld to cover them." },
  // Division 23
  { d: "Mechanical", c: "Test & Balance", t: "Testing, adjusting and balancing (TAB) report", s: "23 05 93" },
  { d: "Mechanical", c: "Commissioning", t: "HVAC commissioning report", s: "23 08 00",
    n: "Per 01 91 13: pre-startup reports, approved test procedures, completed and signed test forms, issues log with resolutions, and any unresolved issues listed. PDF with bookmarks." },
  { d: "Mechanical", c: "Record Drawings", t: "Controls (BAS) as-builts, points list and final set points", s: "",
    n: "Final set points are required in the O&M data (01 78 23)." },
  { d: "Mechanical", c: "Training", t: "Controls / BAS training", s: "" },
  { d: "Mechanical", c: "Attic Stock / Spare Parts", t: "Spare filters and belts", s: "" },
  { d: "Mechanical", c: "Test Report / Certificate", t: "Duct and piping pressure test reports", s: "" },
  // No master spec sections in the Knowledgebase yet: typical items.
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
    .map((r) => newItem({ category: r.c, title: r.t, specSection: r.s, discipline: r.d === G ? "" : r.d, notes: r.n ? "Spec " + r.s + ": " + r.n : "" }, { ...c, id: c.newId ? c.newId() : "" }));
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
