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
