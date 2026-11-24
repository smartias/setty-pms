// constructionCost.js — the construction cost on record at each deliverable.
//
// The Fee Calculator holds ONE construction cost (project.manualConstructionCost)
// and it can drive the fee the app calculates, so it is not the place to keep
// a figure that moves with every estimate. This module keeps a dated history
// beside it, project.constructionCostLog, one entry each time someone confirms
// or updates the figure: at the proposal, when a cost estimate comes in for
// review, when a deliverable goes out, at bid, at contract award.
//
// Nothing here reads or writes the Fee Calculator's number, except that
// latestConstructionCost falls back to it when the log is empty.
//
// SettyPMS.html (window.ConstructionCost) loads this file; the connector runs a
// byte-identical copy (supabase/functions/pms-mcp/constructionCost.js, kept in
// step by constructionCostDrift.test.mjs).
//
// What the figure is for: preventable RFIs per $1M of construction value, the
// second RFI measure beside the preventable share (rfi_root_cause_summary).
//
// Pure: no DOM, no fetch.

// Where a figure came from. The key is stored; the label is what people see.
export const COST_SOURCES = [
  { key: "cost-estimate", label: "Cost estimate" },
  { key: "owner-budget", label: "Owner's budget" },
  { key: "proposal", label: "Proposal / RFP" },
  { key: "bid", label: "Bid result" },
  { key: "contract", label: "Construction contract" },
  { key: "other", label: "Other" },
];
const SOURCE_KEYS = COST_SOURCES.map((s) => s.key);

// A construction cost below this is a typo or a fee, not a building.
export const COST_MIN = 10000;
export const COST_MAX = 50e9;

export function costSourceLabel(key) {
  const s = COST_SOURCES.find((x) => x.key === key);
  return s ? s.label : "Other";
}

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

// The log, oldest first, entries without a usable value dropped.
export function costLogOf(project) {
  const log = project && Array.isArray(project.constructionCostLog) ? project.constructionCostLog : [];
  return log
    .filter((e) => e && Number.isFinite(+e.value) && +e.value > 0 && e.at)
    .slice()
    .sort((a, b) => (String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : 0));
}

// The construction cost to use for a project today.
//   basis "log"            the newest entry in the history
//   basis "fee-calculator" no history; the cost typed in the Fee Calculator
//   basis null             nothing on record (value null)
// The Fee Calculator's square footage x cost per SF is a rule of thumb for
// pricing a proposal and is never returned here.
export function latestConstructionCost(project) {
  const log = costLogOf(project);
  if (log.length) {
    const e = log[log.length - 1];
    return { value: +e.value, at: e.at, source: e.source || "other", deliverable: e.deliverable || null, basis: "log", checks: log.length };
  }
  const manual = project ? +project.manualConstructionCost : 0;
  if (Number.isFinite(manual) && manual > 0) {
    return { value: manual, at: null, source: null, deliverable: null, basis: "fee-calculator", checks: 0 };
  }
  return { value: null, at: null, source: null, deliverable: null, basis: null, checks: 0 };
}

// A milestone whose completion is a moment to check the figure: a billable
// deliverable of the base contract. Change-order milestones and cancelled ones
// are not.
export function isCostCheckMilestone(m) {
  return !!m && m.type === "billable" && !m.coId && m.phase !== "__CO__" && !m.cancelled;
}

// Mark a milestone as waiting for its cost check. Called when it reaches 100%.
// Returns the same project when the milestone does not qualify or is already
// flagged.
export function flagCostCheck(project, milestoneId) {
  const ms = project && Array.isArray(project.milestones) ? project.milestones : [];
  const m = ms.find((x) => x && x.id === milestoneId);
  if (!isCostCheckMilestone(m) || m.costCheckPending) return project;
  return { ...project, milestones: ms.map((x) => (x === m ? { ...x, costCheckPending: true } : x)) };
}

export function pendingCostChecks(project) {
  const ms = project && Array.isArray(project.milestones) ? project.milestones : [];
  return ms.filter((m) => m && m.costCheckPending && isCostCheckMilestone(m));
}

// Drop the flag without recording anything ("not known yet").
export function skipCostCheck(project, milestoneId) {
  const ms = project && Array.isArray(project.milestones) ? project.milestones : [];
  if (!ms.some((m) => m && m.id === milestoneId && m.costCheckPending)) return project;
  return { ...project, milestones: ms.map((m) => (m && m.id === milestoneId ? { ...m, costCheckPending: null } : m)) };
}

// Find the milestone a caller means: by id, else by exact name, else by phase
// code (the newest completed billable milestone of that phase, else its first).
function findMilestone(project, milestoneId, deliverable) {
  const ms = (project && Array.isArray(project.milestones) ? project.milestones : []).filter(isCostCheckMilestone);
  if (milestoneId) return ms.find((m) => m.id === milestoneId) || null;
  const want = str(deliverable, 200).toLowerCase();
  if (!want) return null;
  const byName = ms.find((m) => str(m.name, 200).toLowerCase() === want);
  if (byName) return byName;
  const inPhase = ms.filter((m) => str(m.phase, 40).toLowerCase() === want);
  if (!inPhase.length) return null;
  const done = inPhase.filter((m) => +m.pctComplete >= 100 || m.status === "Completed");
  return (done.length ? done[done.length - 1] : inPhase[0]) || null;
}

// Plan one entry. Nothing is written here: the caller saves plan.project.
//
// input  { value, unchanged, source, document, note, milestoneId, deliverable }
//          value       dollars; omit with unchanged:true to confirm the figure on record
//          source      one of COST_SOURCES keys
//          document    the file the figure was read from, when there is one
//          deliverable milestone name or phase code, when no milestoneId is known
// stamp  { at, id, by, via }   via: "pms" | "connector"
//
// Returns { ok:false, error } or
//         { ok:true, project, entry, previous, changePct }
// previous is latestConstructionCost before this entry; changePct is the move
// from it (null when there was nothing to compare with).
export function planCostCheck(project, input, stamp) {
  const inp = input || {};
  const st = stamp || {};
  const previous = latestConstructionCost(project);
  const unchanged = inp.unchanged === true && (inp.value === undefined || inp.value === null || inp.value === "");
  let value;
  if (unchanged) {
    if (!previous.value) return { ok: false, error: "There is no construction cost on record to confirm. Give the figure." };
    value = previous.value;
  } else {
    value = Math.round(+inp.value);
    if (!Number.isFinite(value) || value < COST_MIN || value > COST_MAX) {
      return { ok: false, error: "Construction cost must be a dollar amount of at least $10,000 (construction only, not Setty's fee)." };
    }
  }
  const source = SOURCE_KEYS.includes(inp.source) ? inp.source : null;
  if (!source) return { ok: false, error: "Say where the figure came from: " + SOURCE_KEYS.join(", ") + "." };
  if (!st.at || !st.id) return { ok: false, error: "planCostCheck needs a stamp with at and id." };

  const m = findMilestone(project, inp.milestoneId, inp.deliverable);
  const entry = {
    id: st.id,
    at: st.at,
    value,
    unchanged: unchanged || (previous.value ? value === previous.value : false),
    source,
    document: str(inp.document, 300) || null,
    note: str(inp.note, 500) || null,
    milestoneId: m ? m.id : null,
    deliverable: m ? str(m.name, 200) : str(inp.deliverable, 200) || null,
    phase: m ? m.phase || null : null,
    by: str(st.by, 200) || null,
    via: st.via === "connector" ? "connector" : "pms",
  };
  const log = project && Array.isArray(project.constructionCostLog) ? project.constructionCostLog : [];
  const ms = project && Array.isArray(project.milestones) ? project.milestones : [];
  const flags = costDocFlagsOf(project);
  const next = {
    ...project,
    constructionCostLog: [...log, entry],
    ...(m && m.costCheckPending ? { milestones: ms.map((x) => (x === m ? { ...x, costCheckPending: null } : x)) } : {}),
    // Recording a figure answers every cost document flagged so far.
    ...(flags.some((f) => f.status === "open")
      ? { costDocFlags: flags.map((f) => (f.status === "open" ? { ...f, status: "recorded", entryId: entry.id } : f)) }
      : {}),
  };
  const changePct = previous.value ? Math.round(((value - previous.value) / previous.value) * 1000) / 10 : null;
  return { ok: true, project: next, entry, previous, changePct };
}

// ── Cost documents saved to the project folder ───────────────────────────────
// The connector's nightly file sync (pms_documents) calls planCostDocFlags with
// the files it saw for the first time. One that reads like a construction cost
// estimate is flagged on the project (project.costDocFlags) and the Schedule
// tab asks for the figure. The match is on the file and folder NAME only: it
// is a prompt to look, never a figure.

const COST_DOC_EXT = ["pdf", "xlsx", "xls", "xlsm", "docx", "doc", "csv"];
const COST_DOC_STRONG = /cost est|construction (cost|budget|estimate)|probable (construction )?cost|opinion of (probable )?cost|\bopcc?\b|cost plan|cost model|bid tab|budget estimate|\bgmp\b/;
const COST_DOC_WEAK = /\bestimates?\b/;
// Estimates of something else, and the firm's own commercial paper.
const COST_DOC_NEVER = /\bfees?\b|proposal|invoice/;
const COST_DOC_NOT_WEAK = /\bloads?\b|energy|\bhours?\b|labor|schedule|\btime\b|\bflow\b|demand|\bfault\b/;
const COST_DOC_NOT_FOLDER = /proposal|contract|invoice|billing|\bfees?\b|accounting/;
export const COST_DOC_FLAG_MAX = 50;

const words = (v) => String(v == null ? "" : v).toLowerCase().replace(/[_\-.,()\[\]]+/g, " ").replace(/\s+/g, " ").trim();

// doc: { name, folderPath, ext }
export function looksLikeCostDocument(doc) {
  if (!doc || !doc.name) return false;
  const raw = String(doc.name);
  const ext = String(doc.ext || (raw.includes(".") ? raw.split(".").pop() : "")).toLowerCase().replace(/^\./, "");
  if (!COST_DOC_EXT.includes(ext)) return false;
  const name = words(raw.replace(/\.[A-Za-z0-9]+$/, ""));
  if (COST_DOC_NEVER.test(name) || COST_DOC_NOT_FOLDER.test(words(doc.folderPath))) return false;
  if (COST_DOC_STRONG.test(name)) return true;
  return COST_DOC_WEAK.test(name) && !COST_DOC_NOT_WEAK.test(name);
}

export function costDocFlagsOf(project) {
  return project && Array.isArray(project.costDocFlags) ? project.costDocFlags.filter((f) => f && f.itemId) : [];
}
export function openCostDocFlags(project) {
  return costDocFlagsOf(project).filter((f) => f.status === "open");
}

// docs: [{ itemId, name, folderPath, ext, webUrl, seenAt }] newly seen files.
// Adds an open flag for each cost-looking one the project has not been asked
// about before (an answered or dismissed file is never flagged again).
// Returns { project, added }; the SAME project reference when nothing is added.
export function planCostDocFlags(project, docs, now) {
  const have = costDocFlagsOf(project);
  const known = new Set(have.map((f) => f.itemId));
  const added = [];
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || !d.itemId || known.has(d.itemId) || !looksLikeCostDocument(d)) continue;
    known.add(d.itemId);
    added.push({
      itemId: String(d.itemId), name: str(d.name, 300), folderPath: str(d.folderPath, 500) || null,
      webUrl: /^https:\/\//i.test(String(d.webUrl || "")) ? String(d.webUrl) : null,
      seenAt: d.seenAt || now, flaggedAt: now, status: "open",
    });
  }
  if (!added.length) return { project, added };
  // Keep the newest; open flags are never the ones dropped while a closed one remains.
  const all = [...have, ...added];
  const closed = all.filter((f) => f.status !== "open");
  const open = all.filter((f) => f.status === "open");
  const keepClosed = closed.slice(Math.max(0, closed.length - Math.max(0, COST_DOC_FLAG_MAX - open.length)));
  return { project: { ...project, costDocFlags: [...keepClosed, ...open].slice(-COST_DOC_FLAG_MAX) }, added };
}

// "Not a cost estimate": close one flag without recording anything.
export function dismissCostDocFlag(project, itemId) {
  const have = costDocFlagsOf(project);
  if (!have.some((f) => f.itemId === itemId && f.status === "open")) return project;
  return { ...project, costDocFlags: have.map((f) => (f.itemId === itemId && f.status === "open" ? { ...f, status: "dismissed" } : f)) };
}

// ── Cost estimate reviews ────────────────────────────────────────────────────
// A cost estimate sent to Claude for review ("Send to Claude for review" on
// the Schedule tab's cost panel, the same hand-off the RFI and submittal
// modals use). The connector's save_cost_estimate_review writes one entry to
// project.costEstimateReviews: what the estimate carries for mechanical,
// electrical and plumbing, what moved since the previous estimate reviewed,
// and, when asked for, where the estimate and the drawings disagree. The
// review is a reading aid for the engineer. It also records the estimate's
// total in the construction cost history, which is the "ingest".

export const ESTIMATE_DISCIPLINES = [
  { key: "mechanical", label: "Mechanical (HVAC)", divisions: "23, 25" },
  { key: "electrical", label: "Electrical", divisions: "26" },
  { key: "plumbing", label: "Plumbing", divisions: "22" },
  { key: "fireProtection", label: "Fire protection", divisions: "21" },
  { key: "technology", label: "Technology / fire alarm / low voltage", divisions: "27, 28" },
];
const DISCIPLINE_KEYS = ESTIMATE_DISCIPLINES.map((d) => d.key);
export const COST_REVIEW_MAX = 30;
const RECON_SEVERITIES = ["high", "medium", "low"];

export function estimateDisciplineLabel(key) {
  const d = ESTIMATE_DISCIPLINES.find((x) => x.key === key);
  return d ? d.label : String(key || "");
}

// Reviews oldest first.
export function costEstimateReviewsOf(project) {
  const list = project && Array.isArray(project.costEstimateReviews) ? project.costEstimateReviews : [];
  return list.filter((r) => r && r.id && r.at).slice()
    .sort((a, b) => (String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : 0));
}
export function latestCostEstimateReview(project) {
  const list = costEstimateReviewsOf(project);
  return list.length ? list[list.length - 1] : null;
}

const pct = (from, to) => (Number.isFinite(from) && from > 0 && Number.isFinite(to) ? Math.round(((to - from) / from) * 1000) / 10 : null);
const amountOf = (review, key) => {
  if (!review) return null;
  if (key === "total") return Number.isFinite(+review.total) && review.total !== null ? +review.total : null;
  const d = (review.disciplines || []).find((x) => x && x.discipline === key);
  return d && Number.isFinite(+d.amount) ? +d.amount : null;
};

// What moved between two reviews: the total, then each discipline either one
// carries. A side that has no figure is null, and so is its change: a
// discipline the earlier estimate did not break out is "not comparable", not
// "new cost".
export function compareEstimates(prev, next) {
  if (!prev || !next) return [];
  return ["total", ...DISCIPLINE_KEYS]
    .map((key) => {
      const from = amountOf(prev, key), to = amountOf(next, key);
      if (from === null && to === null) return null;
      const both = from !== null && to !== null;
      return { key, label: key === "total" ? "Total construction cost" : estimateDisciplineLabel(key), from, to, delta: both ? to - from : null, deltaPct: both ? pct(from, to) : null };
    })
    .filter(Boolean);
}

// The request / started stamps, like aiReviewRequested / aiReviewStarted on an
// RFI. state: none | waiting (sent, Claude has not opened it) | reviewing |
// ready (a review is newer than the request).
export function costReviewState(project, nowMs) {
  const t = (x) => (x ? Date.parse(x.at || "") || 0 : 0);
  const req = project ? project.costEstimateReviewRequested : null;
  const st = project ? project.costEstimateReviewStarted : null;
  const last = latestCostEstimateReview(project);
  const reqAt = t(req), stAt = t(st), revAt = t(last);
  const mins = (from) => Math.max(0, Math.round(((nowMs || Date.now()) - from) / 60000));
  if (stAt > revAt && stAt >= reqAt) return { state: "reviewing", mins: mins(stAt), document: (req && req.document) || null };
  if (reqAt > revAt) return { state: "waiting", mins: mins(reqAt), by: (req && req.by) || null, document: (req && req.document) || null };
  return { state: last ? "ready" : "none" };
}

// The click on "Send to Claude for review": {at, by, document, reconcile}.
export function markCostReviewRequested(project, req) {
  const r = req || {};
  return { ...project, costEstimateReviewRequested: { at: r.at, by: str(r.by, 200) || null, document: str(r.document, 300) || null, reconcile: !!r.reconcile } };
}
// The connector's first call for a review.
export function markCostReviewStarted(project, st) {
  const x = st || {};
  return { ...project, costEstimateReviewStarted: { at: x.at, by: str(x.by, 200) || null, document: str(x.document, 300) || null } };
}

const money = (v) => {
  const n = Math.round(+v);
  return Number.isFinite(n) && n >= 0 && n <= COST_MAX ? n : null;
};

// Plan one review. Nothing is written here: the caller saves plan.project.
//
// input {
//   document: { name, webUrl, itemId },   the estimate that was read (name required)
//   deliverable, estimateDate, preparedBy, set
//   total, totalBasis                     total construction cost and what it includes
//   disciplines: [{ discipline, amount, basis, note }]
//   breakdown:   [{ discipline, label, amount }]      the larger line items, optional
//   reconciliation: { against, findings: [{ severity, discipline, issue, estimate, drawings, sheets }], notRun }
//   notes, unknowns: [text]
//   recordTotal                           false = do not add the total to the cost history
// }
// stamp { at, id, by }
//
// Returns { ok:false, error } or
//   { ok:true, project, review, previous, changes, recorded }
// previous is the review before this one (null for the first); changes is
// compareEstimates(previous, review); recorded is the cost-history entry the
// total produced, or null.
export function planCostEstimateReview(project, input, stamp) {
  const inp = input || {}, st = stamp || {};
  if (!st.at || !st.id) return { ok: false, error: "planCostEstimateReview needs a stamp with at and id." };
  const docName = str(inp.document && inp.document.name, 300);
  if (!docName) return { ok: false, error: "Name the estimate document that was read (document.name)." };

  const hasTotal = !(inp.total === undefined || inp.total === null || inp.total === "");
  const total = hasTotal ? money(inp.total) : null;
  if (hasTotal && (total === null || total < COST_MIN)) {
    return { ok: false, error: "total must be the estimate's total construction cost in dollars, at least $10,000. Leave it out if the document gives no total." };
  }
  const disciplines = [];
  for (const d of Array.isArray(inp.disciplines) ? inp.disciplines : []) {
    if (!d || !DISCIPLINE_KEYS.includes(d.discipline)) return { ok: false, error: "Unknown discipline. Use one of: " + DISCIPLINE_KEYS.join(", ") + "." };
    if (disciplines.some((x) => x.discipline === d.discipline)) return { ok: false, error: "Each discipline once: " + d.discipline + " appears twice. Add the parts together and say how in its note." };
    const amount = money(d.amount);
    if (amount === null) return { ok: false, error: "The amount for " + d.discipline + " is not a dollar amount." };
    disciplines.push({ discipline: d.discipline, amount, basis: str(d.basis, 300) || null, note: str(d.note, 500) || null });
  }
  if (total === null && !disciplines.length) {
    return { ok: false, error: "Nothing to save: give the total, at least one discipline amount, or both. If the document has neither, it is not a cost estimate: tell the user." };
  }
  const mepTotal = disciplines.reduce((s, d) => s + d.amount, 0);
  if (total !== null && disciplines.length && mepTotal > total * 1.02) {
    return { ok: false, error: "The discipline amounts add up to more than the total. One of them is not on the same basis (markups, alternates, or a subtotal counted twice): check and resend." };
  }

  const breakdown = (Array.isArray(inp.breakdown) ? inp.breakdown : []).slice(0, 80)
    .map((b) => ({ discipline: DISCIPLINE_KEYS.includes(b && b.discipline) ? b.discipline : null, label: str(b && b.label, 200), amount: money(b && b.amount) }))
    .filter((b) => b.label && b.amount !== null);

  const rec = inp.reconciliation || null;
  const findings = (rec && Array.isArray(rec.findings) ? rec.findings : []).slice(0, 60)
    .map((f) => ({
      severity: RECON_SEVERITIES.includes(f && f.severity) ? f.severity : "medium",
      discipline: DISCIPLINE_KEYS.includes(f && f.discipline) ? f.discipline : null,
      issue: str(f && f.issue, 600),
      estimate: str(f && f.estimate, 300) || null,
      drawings: str(f && f.drawings, 300) || null,
      sheets: (Array.isArray(f && f.sheets) ? f.sheets : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 20),
    }))
    .filter((f) => f.issue);
  const reconciliation = rec
    ? { against: str(rec.against, 300) || null, findings, notRun: str(rec.notRun, 400) || null }
    : null;

  const previous = latestCostEstimateReview(project);
  const webUrl = String((inp.document && inp.document.webUrl) || "");
  const review = {
    id: st.id, at: st.at, by: str(st.by, 200) || null,
    document: { name: docName, webUrl: /^https:\/\//i.test(webUrl) ? webUrl : null, itemId: str(inp.document.itemId, 200) || null },
    deliverable: str(inp.deliverable, 200) || null,
    estimateDate: /^\d{4}-\d{2}-\d{2}$/.test(String(inp.estimateDate || "")) ? inp.estimateDate : null,
    preparedBy: str(inp.preparedBy, 200) || null,
    total, totalBasis: str(inp.totalBasis, 400) || null,
    disciplines, mepTotal: disciplines.length ? mepTotal : null,
    mepShare: total && disciplines.length ? Math.round((mepTotal / total) * 1000) / 10 : null,
    breakdown,
    reconciliation,
    notes: str(inp.notes, 3000) || null,
    unknowns: (Array.isArray(inp.unknowns) ? inp.unknowns : []).map((u) => str(u, 400)).filter(Boolean).slice(0, 20),
    comparedTo: previous ? { id: previous.id, document: previous.document ? previous.document.name : null, at: previous.at } : null,
  };
  const changes = compareEstimates(previous, review);
  review.changes = changes;

  const list = project && Array.isArray(project.costEstimateReviews) ? project.costEstimateReviews : [];
  let next = { ...project, costEstimateReviews: [...list, review].slice(-COST_REVIEW_MAX) };
  let recorded = null;
  if (inp.recordTotal !== false && total !== null) {
    const plan = planCostCheck(next, {
      value: total, source: "cost-estimate", document: docName, deliverable: inp.deliverable,
      note: review.totalBasis ? "From the cost estimate review. " + review.totalBasis : "From the cost estimate review.",
    }, { at: st.at, id: st.id + "c", by: st.by, via: "connector" });
    if (plan.ok) { next = plan.project; recorded = plan.entry; }
  }
  return { ok: true, project: next, review, previous, changes, recorded };
}

// Preventable RFIs per $1M of construction value.
// rows: [{ project, preventable, cost }]; cost null when none is on record.
// Projects without a cost are left out of BOTH sides of the ratio and counted,
// so the number is never quietly computed on a subset without saying so.
export function rfisPerMillion(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const withCost = list.filter((r) => r && Number.isFinite(+r.cost) && +r.cost > 0);
  const cost = withCost.reduce((s, r) => s + +r.cost, 0);
  const preventable = withCost.reduce((s, r) => s + (+r.preventable || 0), 0);
  return {
    projects: list.length,
    projectsWithCost: withCost.length,
    constructionValue: cost,
    preventable,
    perMillion: cost > 0 ? Math.round((preventable / (cost / 1e6)) * 100) / 100 : null,
    missingCost: list.filter((r) => !withCost.includes(r)).map((r) => r.project),
  };
}
