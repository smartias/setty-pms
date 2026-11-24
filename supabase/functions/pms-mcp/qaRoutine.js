// qaRoutine.js — the QA checklist review routine: turning the preventable
// RFIs that no checklist item covers into PROPOSED checklist items.
// (tools start_checklist_routine / propose_checklist_items, tables
// pms_qa_routine_runs / pms_qa_item_proposals, Admin Console "QA Checklist" tab)
//
// The routine is started from the Admin Console and run by a Claude session.
// It never adds to the checklist: it writes proposals, and an admin approves
// or rejects each one in the console. These are the rules a proposal must
// meet before it is stored. Pure.

export const PROPOSAL_PHASES = ["SD", "DD", "CD", "Permit", "Bid", "Addendum"];
export const PROPOSAL_AUTOMATION = ["auto", "assisted", "manual"];
// A kind of RFI earns a checklist item when it recurs: on at least this many
// projects, with at least this many RFIs. One project's repeated question is
// that project's problem, not a firm check.
export const MIN_PROJECTS = 2;
export const MIN_RFIS = 3;
export const PROPOSALS_MAX = 12;

const text = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const keyOf = (project, number) => String(project || "").trim().toUpperCase() + "|" + String(number || "").trim().toUpperCase();

// The state of a run, from its three timestamps.
export function runState(run, nowMs) {
  if (!run) return { state: "never" };
  const t = (v) => (v ? Date.parse(v) || 0 : 0);
  const mins = (from) => Math.max(0, Math.round(((nowMs || Date.now()) - from) / 60000));
  if (run.finished_at) return { state: "finished", mins: mins(t(run.finished_at)) };
  if (run.started_at) { const m = mins(t(run.started_at)); return { state: m >= 60 ? "stalled" : "running", mins: m }; }
  const m = mins(t(run.requested_at));
  return { state: m >= 10 ? "not-started" : "waiting", mins: m };
}

// Check proposals against the uncovered RFIs they claim to rest on.
//   proposals  [{ text, details, automation, how, phases, rationale, rfis: [{ project, number }] }]
//   uncovered  rows of pms_rfi_root_causes that are preventable with no qa_item:
//              [{ project, item_number }]
//   existing   [{ text }] items and open proposals already on file, to refuse a repeat
// Returns { accepted: [...], refused: [{ text, why }] }. An accepted proposal
// carries only the RFIs that really are uncovered, and its counts are computed
// here, never taken from the caller.
export function planProposals(proposals, uncovered, existing) {
  const open = new Set((Array.isArray(uncovered) ? uncovered : []).map((r) => keyOf(r.project, r.item_number)));
  const known = new Set((Array.isArray(existing) ? existing : []).map((e) => text(e && e.text, 2000).toLowerCase()).filter(Boolean));
  const accepted = [], refused = [];
  const claimed = new Set();
  for (const p of (Array.isArray(proposals) ? proposals : []).slice(0, PROPOSALS_MAX)) {
    const t = text(p && p.text, 600);
    const refuse = (why) => refused.push({ text: t || "(no text)", why });
    if (t.length < 40) { refuse("The item text is missing or too short to be a check. Write it as 'Verify ...', one sentence a reviewer can act on."); continue; }
    if (!/^(verify|on |confirm)/i.test(t)) { refuse("Write the item as a check: start with 'Verify', like the items already in the checklist."); continue; }
    if (known.has(t.toLowerCase())) { refuse("An item or an open proposal with this exact text already exists."); continue; }
    const details = (Array.isArray(p.details) ? p.details : []).map((d) => text(d, 600)).filter(Boolean).slice(0, 10);
    if (details.length < 2) { refuse("Give at least two details: what to look at, and what counts as a finding."); continue; }
    const seen = new Set();
    const rfis = [];
    for (const r of Array.isArray(p.rfis) ? p.rfis : []) {
      const k = keyOf(r && r.project, r && r.number);
      if (!open.has(k) || seen.has(k)) continue;
      seen.add(k);
      rfis.push({ project: text(r.project, 60), number: text(r.number, 60) });
    }
    const projects = new Set(rfis.map((r) => r.project.toUpperCase()));
    if (rfis.length < MIN_RFIS || projects.size < MIN_PROJECTS) {
      refuse(`It rests on ${rfis.length} uncovered preventable RFI(s) on ${projects.size} project(s). A new item needs at least ${MIN_RFIS} RFIs on at least ${MIN_PROJECTS} projects; RFIs that are already tagged to an item, or not tagged preventable, do not count.`);
      continue;
    }
    const overlap = rfis.filter((r) => claimed.has(keyOf(r.project, r.number))).length;
    if (overlap > rfis.length / 2) { refuse("More than half of its RFIs are already claimed by an earlier proposal in this run: merge the two."); continue; }
    for (const r of rfis) claimed.add(keyOf(r.project, r.number));
    const phases = (Array.isArray(p.phases) ? p.phases : []).filter((x) => PROPOSAL_PHASES.includes(x));
    accepted.push({
      text: t, details,
      automation: PROPOSAL_AUTOMATION.includes(p.automation) ? p.automation : "assisted",
      automation_hint: text(p.how, 800) || null,
      phases: phases.length ? phases : ["CD", "Permit", "Bid", "Addendum"],
      rationale: text(p.rationale, 1200) || null,
      rfis, rfi_count: rfis.length, project_count: projects.size,
    });
    known.add(t.toLowerCase());
  }
  return { accepted, refused };
}
