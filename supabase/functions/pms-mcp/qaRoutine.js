// qaRoutine.js — the QA checklist review routine: turning the preventable
// RFIs that no checklist item covers, and the approved lessons that recur
// across projects, into PROPOSED checklist items.
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
// A lesson is already a distilled, human-approved statement, so fewer are
// needed: the same thing learned on two projects is a pattern.
export const MIN_LESSONS = 2;
export const MIN_LESSON_PROJECTS = 2;
// A best practice, or a lesson saved firm-wide (no project), is already a
// statement about every project that a person approved: one is enough.
export const MIN_FIRM_WIDE = 1;
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
//   lessons    approved lessons and best practices no checklist item describes yet:
//              [{ lesson_id, project_id, lesson_summary, kind }]; kind "practice"
//              is a best practice, and no project_id means firm-wide
// Returns { accepted: [...], refused: [{ text, why }] }. An accepted proposal
// carries only the RFIs that really are uncovered and the lessons that really
// are candidates, and its counts are computed here, never taken from the
// caller. It must meet the RFI rule or the lesson rule; evidence of one kind
// below its own bar does not top up the other.
export function planProposals(proposals, uncovered, existing, lessons) {
  const open = new Set((Array.isArray(uncovered) ? uncovered : []).map((r) => keyOf(r.project, r.item_number)));
  const lessonById = new Map((Array.isArray(lessons) ? lessons : []).map((l) => [String(l.lesson_id || "").toLowerCase(), l]));
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
    const seenL = new Set();
    const les = [];
    for (const id of Array.isArray(p.lessons) ? p.lessons : []) {
      const k = String((id && id.id) || id || "").trim().toLowerCase();
      const row = lessonById.get(k);
      if (!row || seenL.has(k)) continue;
      seenL.add(k);
      les.push({ id: k, kind: row.kind === "practice" ? "practice" : "lesson", project: text(row.project_id, 60), summary: text(row.lesson_summary, 300) });
    }
    const firmWide = les.filter((l) => l.kind === "practice" || !l.project).length;
    const lessonProjects = new Set(les.map((l) => l.project.toUpperCase()).filter(Boolean));
    const rfiRule = rfis.length >= MIN_RFIS && projects.size >= MIN_PROJECTS;
    const lessonRule = (les.length >= MIN_LESSONS && lessonProjects.size >= MIN_LESSON_PROJECTS) || firmWide >= MIN_FIRM_WIDE;
    if (!rfiRule && !lessonRule) {
      refuse(`It rests on ${rfis.length} uncovered preventable RFI(s) on ${projects.size} project(s) and ${les.length} approved lesson(s) from ${lessonProjects.size} project(s). A new item needs at least ${MIN_RFIS} RFIs on at least ${MIN_PROJECTS} projects, or at least ${MIN_LESSONS} lessons from at least ${MIN_LESSON_PROJECTS} projects, or one best practice or firm-wide lesson. RFIs already tagged to an item or not tagged preventable, and lessons or best practices that are not approved or are already linked to an item, do not count.`);
      continue;
    }
    const evidence = [...rfis.map((r) => keyOf(r.project, r.number)), ...les.map((l) => "lesson|" + l.id)];
    const overlap = evidence.filter((k) => claimed.has(k)).length;
    if (overlap > evidence.length / 2) { refuse("More than half of its RFIs and lessons are already claimed by an earlier proposal in this run: merge the two."); continue; }
    for (const k of evidence) claimed.add(k);
    for (const l of les) if (l.project) projects.add(l.project.toUpperCase());
    const phases = (Array.isArray(p.phases) ? p.phases : []).filter((x) => PROPOSAL_PHASES.includes(x));
    accepted.push({
      text: t, details,
      automation: PROPOSAL_AUTOMATION.includes(p.automation) ? p.automation : "assisted",
      automation_hint: text(p.how, 800) || null,
      phases: phases.length ? phases : ["CD", "Permit", "Bid", "Addendum"],
      rationale: text(p.rationale, 1200) || null,
      rfis, rfi_count: rfis.length, lessons: les, lesson_count: les.length, project_count: projects.size,
    });
    known.add(t.toLowerCase());
  }
  return { accepted, refused };
}
