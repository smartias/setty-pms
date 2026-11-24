// Tests for qaRoutine.js: which proposed checklist items are stored, and the
// state of a routine run.
//
//   node --test supabase/functions/pms-mcp/qaRoutine.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { planProposals, runState, MIN_PROJECTS, MIN_RFIS, MIN_LESSONS, MIN_LESSON_PROJECTS } from "./qaRoutine.js";

const uncovered = [
  { project: "SAPX1.00", item_number: "001" }, { project: "SAPX1.00", item_number: "002" },
  { project: "SAPX2.00", item_number: "RFI-010" }, { project: "SAPX3.00", item_number: "007" },
  { project: "SAPX4.00", item_number: "A" }, { project: "SAPX4.00", item_number: "B" }, { project: "SAPX4.00", item_number: "C" },
];
const good = {
  text: "Verify freeze protection is shown for every water line that runs through an unconditioned space.",
  details: ["List piping in canopies, exterior walls and unheated rooms.", "Each needs heat trace, a drain-down valve or a dry system: silence is a finding."],
  how: "search_drawings for CANOPY, EXTERIOR, UNHEATED on the P and FP sheets", phases: ["CD", "Bid", "Nope"], rationale: "Three RFIs on three projects.",
  rfis: [{ project: "SAPX1.00", number: "001" }, { project: "sapx2.00", number: "rfi-010" }, { project: "SAPX3.00", number: "007" }, { project: "SAPX9.00", number: "999" }],
};

test("a proposal is stored with only the RFIs that really are uncovered, and its counts are computed", () => {
  const { accepted, refused } = planProposals([good], uncovered, []);
  assert.equal(refused.length, 0);
  assert.equal(accepted.length, 1);
  const a = accepted[0];
  assert.deepEqual([a.rfi_count, a.project_count], [3, 3], "the RFI that is not in the uncovered list is dropped");
  assert.deepEqual(a.phases, ["CD", "Bid"]);
  assert.equal(a.automation, "assisted");
  assert.equal(a.automation_hint, good.how);
});

test("a kind that does not recur is refused, with the reason", () => {
  const oneProject = { ...good, rfis: [{ project: "SAPX4.00", number: "A" }, { project: "SAPX4.00", number: "B" }, { project: "SAPX4.00", number: "C" }] };
  const r1 = planProposals([oneProject], uncovered, []);
  assert.equal(r1.accepted.length, 0);
  assert.match(r1.refused[0].why, /3 uncovered preventable RFI\(s\) on 1 project\(s\)/);
  const two = { ...good, rfis: good.rfis.slice(0, 2) };
  assert.match(planProposals([two], uncovered, []).refused[0].why, /at least 3 RFIs on at least 2 projects/);
  assert.equal(MIN_PROJECTS, 2);
  assert.equal(MIN_RFIS, 3);
});

test("badly formed, repeated and overlapping proposals are refused", () => {
  assert.match(planProposals([{ ...good, text: "Freeze protection" }], uncovered, []).refused[0].why, /too short/);
  assert.match(planProposals([{ ...good, text: "Freeze protection should be shown for every water line in an unconditioned space." }], uncovered, []).refused[0].why, /start with 'Verify'/);
  assert.match(planProposals([{ ...good, details: ["one"] }], uncovered, []).refused[0].why, /at least two details/);
  assert.match(planProposals([good], uncovered, [{ text: good.text.toUpperCase() }]).refused[0].why, /already exists/);
  const second = { ...good, text: "Verify heat trace is scheduled and powered wherever the plumbing drawings call for it." };
  const r = planProposals([good, second], uncovered, []);
  assert.equal(r.accepted.length, 1);
  assert.match(r.refused[0].why, /merge the two/);
  assert.match(planProposals([good, good], uncovered, []).refused[0].why, /already exists/, "the same text twice in one run");
});

const L = (n, project) => ({ lesson_id: `00000000-0000-0000-0000-00000000000${n}`, project_id: project, lesson_summary: `Lesson ${n}  about   freeze protection.` });
const lessons = [L(1, "SAPX1.00"), L(2, "SAPX2.00"), L(3, "SAPX2.00")];

test("a proposal can rest on lessons that recur across projects, with no RFIs", () => {
  const p = { ...good, rfis: undefined, lessons: [lessons[0].lesson_id.toUpperCase(), lessons[1].lesson_id, "not-a-lesson", lessons[1].lesson_id] };
  const { accepted, refused } = planProposals([p], uncovered, [], lessons);
  assert.equal(refused.length, 0);
  const a = accepted[0];
  assert.deepEqual([a.rfi_count, a.lesson_count, a.project_count], [0, 2, 2], "unknown and repeated ids are dropped");
  assert.deepEqual(a.lessons[0], { id: lessons[0].lesson_id, project: "SAPX1.00", summary: "Lesson 1 about freeze protection." });
  assert.deepEqual([MIN_LESSONS, MIN_LESSON_PROJECTS], [2, 2]);
});

test("lessons from one project, or one lesson, do not earn an item; nor do two weak kinds of evidence together", () => {
  const same = { ...good, rfis: [], lessons: [lessons[1].lesson_id, lessons[2].lesson_id] };
  assert.match(planProposals([same], uncovered, [], lessons).refused[0].why, /2 approved lesson\(s\) from 1 project\(s\)/);
  const weak = { ...good, rfis: good.rfis.slice(0, 2), lessons: [lessons[0].lesson_id] };
  assert.match(planProposals([weak], uncovered, [], lessons).refused[0].why, /or at least 2 lessons from at least 2 projects/);
  assert.equal(planProposals([{ ...good, rfis: [], lessons: [lessons[0].lesson_id, lessons[1].lesson_id] }], uncovered, [], []).accepted.length, 0, "a lesson that is not a candidate does not count");
});

test("RFIs and lessons about the same thing are one proposal, and a second one reusing the lessons is refused", () => {
  const both = { ...good, lessons: [lessons[0].lesson_id, lessons[1].lesson_id] };
  const again = { ...good, text: "Verify heat trace is scheduled and powered wherever the plumbing drawings call for it.", rfis: [], lessons: [lessons[0].lesson_id, lessons[1].lesson_id] };
  const r = planProposals([both, again], uncovered, [], lessons);
  assert.deepEqual([r.accepted[0].rfi_count, r.accepted[0].lesson_count, r.accepted[0].project_count], [3, 2, 3]);
  assert.match(r.refused[0].why, /merge the two/);
});

test("run state from the three timestamps", () => {
  const now = Date.parse("2027-01-01T12:00:00Z");
  assert.equal(runState(null, now).state, "never");
  assert.deepEqual(runState({ requested_at: "2027-01-01T11:57:00Z" }, now), { state: "waiting", mins: 3 });
  assert.equal(runState({ requested_at: "2027-01-01T11:30:00Z" }, now).state, "not-started");
  assert.deepEqual(runState({ requested_at: "2027-01-01T11:30:00Z", started_at: "2027-01-01T11:50:00Z" }, now), { state: "running", mins: 10 });
  assert.equal(runState({ requested_at: "2027-01-01T09:00:00Z", started_at: "2027-01-01T09:05:00Z" }, now).state, "stalled");
  assert.deepEqual(runState({ requested_at: "2027-01-01T11:30:00Z", started_at: "2027-01-01T11:31:00Z", finished_at: "2027-01-01T11:45:00Z" }, now), { state: "finished", mins: 15 });
});

// Drift anchors: the tools, the tables, the approval function and the console tab.
test("the routine's tools, tables, approval function and console tab are in step", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const a = src.indexOf('mcp.tool("start_checklist_routine"'), b = src.indexOf('mcp.tool("propose_checklist_items"');
  assert.ok(a > 0 && b > a);
  const propose = src.slice(b, b + 6000);
  assert.ok(propose.includes("planProposals(") && propose.includes('"pms_qa_item_proposals"'));
  assert.ok(!/pms_qa_checklist\?|sbUpsert\("pms_qa_checklist"/.test(src.slice(a, b + 6000).replace(/pms_qa_checklist\?select=[^"]*/g, "")), "the connector reads the checklist and never writes it");
  const sql = readFileSync(new URL("../../migrations/20261124220000_qa_checklist_routine.sql", import.meta.url), "utf8");
  for (const s of ["create table if not exists public.pms_qa_routine_runs", "create table if not exists public.pms_qa_item_proposals",
    "create or replace function public.pms_request_qa_routine()", "create or replace function public.pms_decide_qa_item_proposal("]) assert.ok(sql.includes(s), s);
  assert.ok(sql.split("if not public.is_pms_admin() then").length - 1 >= 2, "both functions are admin-only");
  assert.ok(sql.includes("insert into public.pms_qa_checklist"), "only the approval function adds a checklist item");
  const sql2 = readFileSync(new URL("../../migrations/20261124230000_qa_routine_lessons.sql", import.meta.url), "utf8");
  for (const x of ["create table if not exists public.pms_qa_lesson_coverage", "add column if not exists lessons ", "insert into public.pms_qa_lesson_coverage",
    "if not public.is_pms_admin() then", "update public.pms_rfi_root_causes rc", "revoke all on function public.pms_decide_qa_item_proposal"]) assert.ok(sql2.includes(x), x);
  assert.ok(propose.includes("candidateLessonRows()") && src.includes('"pms_qa_lesson_coverage?on_conflict=lesson_id"'));
  const html = readFileSync(new URL("../../../SettyAdmin.html", import.meta.url), "utf8");
  assert.ok(html.includes('{ key: "qachecklist"') && html.includes("async function renderQaChecklist()"));
  assert.ok(html.includes("rpc/pms_request_qa_routine") && html.includes("rpc/pms_decide_qa_item_proposal"));
  assert.ok(html.includes("start_checklist_routine") && html.includes("propose_checklist_items"), "the console's request names both tools");
});
