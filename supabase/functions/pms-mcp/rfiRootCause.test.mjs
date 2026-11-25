// RFI root causes: the vocabulary and the summary a QA review reads.
//
//   node --test supabase/functions/pms-mcp/rfiRootCause.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RFI_ROOT_CAUSES, normalizeRootCause, normalizeQaItem, defaultPreventable, rfiPhase, summarizeRootCauses, lessonCandidates, coveredRfiKeys, rfiKey, designWatchlist, workKindOf } from "./rfiRootCause.ts";

test("root causes fold to the vocabulary", () => {
  assert.equal(normalizeRootCause("DOC-CONFLICT"), "doc-conflict");
  assert.equal(normalizeRootCause("doc missing"), "doc-missing");
  assert.equal(normalizeRootCause("COORD-OTHER-DISCIPLINE"), "coordination");
  assert.equal(normalizeRootCause("substitution"), "contractor");
  assert.equal(normalizeRootCause("field condition"), "field-condition");
  assert.equal(normalizeRootCause("made up"), null);
  assert.equal(normalizeRootCause(""), null);
  assert.equal(RFI_ROOT_CAUSES.length, 8);
});

test("document causes are preventable by default; contractor and field are not", () => {
  for (const c of ["doc-conflict", "doc-missing", "coordination", "scope-gap"]) assert.equal(defaultPreventable(c), true, c);
  for (const c of ["contractor", "field-condition", "owner-change", "other"]) assert.equal(defaultPreventable(c), false, c);
});

test("a QA item is a checklist id or nothing", () => {
  assert.equal(normalizeQaItem("qa-614"), "qa-614");
  assert.equal(normalizeQaItem("QA614"), "qa-614");
  for (const v of ["none", "n/a", "", null, "X-4", "qa-61"]) assert.equal(normalizeQaItem(v), null, String(v));
});

test("bid RFIs are told from construction RFIs by their number", () => {
  assert.equal(rfiPhase("BID-011"), "bid");
  assert.equal(rfiPhase("BID-RFI-298"), "bid");
  assert.equal(rfiPhase("RFI-047"), "construction");
  assert.equal(rfiPhase("047", "bid"), "bid");
});

test("the summary counts what a review could have prevented and what no check covers", () => {
  const rows = [
    { project: "A", item_number: "039", cause: "coordination", preventable: true, qa_item: "qa-614", phase: "construction", subject: "Corridor plenum" },
    { project: "A", item_number: "047", cause: "coordination", preventable: true, qa_item: "qa-614", phase: "construction" },
    { project: "B", item_number: "073", cause: "coordination", preventable: true, qa_item: "qa-614", phase: "construction" },
    { project: "A", item_number: "121", cause: "coordination", preventable: true, qa_item: null, phase: "construction", subject: "Plumbing in electrical rooms" },
    { project: "A", item_number: "BID-011", cause: "contractor", preventable: false, qa_item: null, phase: "bid" },
    { project: "B", item_number: "BID-034", cause: "scope-gap", preventable: true, qa_item: "qa-610", phase: "bid" },
  ];
  const s = summarizeRootCauses(rows);
  assert.equal(s.tagged, 6);
  assert.equal(s.preventable, 5);
  assert.equal(s.preventableShare, 83);
  assert.deepEqual(s.byCause, { coordination: 4, contractor: 1, "scope-gap": 1 });
  assert.deepEqual(s.byPhase, { construction: 4, bid: 2 });
  assert.deepEqual(s.byQaItem.map((x) => [x.qaItem, x.rfis, x.projects]), [["qa-614", 3, 2], ["qa-610", 1, 1]]);
  assert.equal(s.preventableWithNoCheck, 1);
  assert.equal(s.noCheckExamples[0].number, "121");
  assert.equal(s.projects, 2);
  assert.equal(summarizeRootCauses([]).preventableShare, 0);
});

test("the connector saves, back-fills and summarizes root causes", () => {
  const here = new URL(".", import.meta.url);
  const src = readFileSync(new URL("index.ts", here), "utf8");
  assert.match(src, /from "\.\/rfiRootCause\.ts"/);
  assert.match(src, /mcp\.tool\("tag_rfi_root_causes"/);
  assert.match(src, /mcp\.tool\("rfi_root_cause_summary"/);
  assert.match(src, /rootCause: z\.object\(/);
  const mig = readFileSync(new URL("../../migrations/20261116230000_rfi_root_causes.sql", here), "utf8");
  assert.match(mig, /create table if not exists public\.pms_rfi_root_causes/);
  for (const c of RFI_ROOT_CAUSES) assert.ok(mig.includes("'" + c + "'"), "migration check constraint lacks " + c);
  assert.match(readFileSync(new URL("README.md", here), "utf8"), /rfi_root_cause_summary/);
  assert.match(readFileSync(new URL("../../../SettyAdmin.html", here), "utf8"), /tag_rfi_root_causes/);
  assert.match(readFileSync(new URL("../../../.claude/skills/submittal-rfi-review/SKILL.md", here), "utf8"), /rootCause/);
  assert.match(readFileSync(new URL("../../../.claude/skills/qa-coordination-review/SKILL.md", here), "utf8"), /rfi_root_cause_summary/);
});

test("an RFI number written several ways is one RFI", () => {
  const k = rfiKey("SAPX196006.00", "RFI-019");
  for (const n of ["rfi 19", "019", "19", "RFI #019"]) assert.equal(rfiKey("sapx196006.00", n), k, n);
  assert.equal(rfiKey("P", "BID-RFI-338"), rfiKey("P", "BID-338"));
  assert.equal(rfiKey("P", "BID-032"), rfiKey("P", "bid 32"));
  assert.notEqual(rfiKey("P", "BID-032"), rfiKey("P", "032"), "a bid RFI is not the construction RFI of the same number");
  assert.notEqual(rfiKey("P", "19"), rfiKey("Q", "19"));
  assert.notEqual(rfiKey("P", "100"), rfiKey("P", "10"));
});

const TAGS = [
  { project: "A", item_number: "RFI-001", cause: "coordination", preventable: true, qa_item: "qa-614", subject: "Duct over panel", note: "duct crosses panel clearance on M-201" },
  { project: "B", item_number: "012", cause: "coordination", preventable: true, qa_item: "qa-614" },
  { project: "B", item_number: "013", cause: "coordination", preventable: true, qa_item: "qa-614" },
  { project: "A", item_number: "RFI-002", cause: "doc-missing", preventable: true, qa_item: null },
  { project: "A", item_number: "RFI-003", cause: "doc-missing", preventable: true, qa_item: "qa-601" },
  { project: "A", item_number: "RFI-004", cause: "contractor", preventable: false, qa_item: null },
  { project: "C", item_number: "BID-338", cause: "scope-gap", preventable: true, qa_item: "qa-622" },
];

test("preventable RFIs with no lesson are grouped by pattern, widest first", () => {
  const out = lessonCandidates(TAGS, []);
  assert.equal(out.preventable, 6, "the contractor's own question is not a candidate");
  assert.equal(out.withoutALesson, 6);
  assert.equal(out.groups[0].qaItem, "qa-614", "seen on two projects, so it leads");
  assert.equal(out.groups[0].rfis, 3);
  assert.equal(out.groups[0].projects, 2);
  assert.deepEqual(out.groups[0].items[0], { project: "A", number: "RFI-001", cause: "coordination", subject: "Duct over panel", note: "duct crosses panel clearance on M-201" });
  const none = out.groups.find((g) => g.noChecklistItem);
  assert.deepEqual([none.cause, none.rfis], ["doc-missing", 1], "no checklist item: grouped by cause, and flagged");
  assert.equal(out.groupsTotal, 4);
  assert.equal(lessonCandidates(TAGS, [], { groupLimit: 2 }).groups.length, 2);
  const capped = lessonCandidates(TAGS, [], { itemsPerGroup: 2 }).groups[0];
  assert.equal(capped.items.length, 2);
  assert.equal(capped.moreNotShown, 1);
});

test("an RFI a lesson links to, or names in its source, is no longer a candidate", () => {
  const lessons = [
    { project_id: "B", status: "approved", linked_records: [{ type: "rfi", rfi_id: "12", project: "B" }, { type: "email", id: "x" }] },
    { project_id: "C", status: "suggested", linked_records: [{ type: "rfi", rfi_id: "BID-RFI-338", project: "C" }] },
    { project_id: "A", status: "approved", linked_records: null, source_reference: "Tabler Quad, RFI 3 and Submittal 230719-001" },
    { project_id: "A", status: "rejected", linked_records: [{ type: "rfi", rfi_id: "RFI-001", project: "A" }] },
    { project_id: "Z", status: "approved", source_reference: "RFI 2" },
  ];
  const out = lessonCandidates(TAGS, lessons);
  assert.equal(out.alreadyInALesson, 3, "B 012 by link, C BID-338 by a queued draft, A RFI-003 by source text");
  assert.equal(out.withoutALesson, 3);
  const left = out.groups.flatMap((g) => g.items.map((i) => i.project + " " + i.number)).sort();
  assert.deepEqual(left, ["A RFI-001", "A RFI-002", "B 013"], "a rejected lesson covers nothing; another project's 'RFI 2' is not this one's");
  const k = coveredRfiKeys(lessons);
  assert.ok(k.linked.has(rfiKey("B", "012")));
  assert.ok(!k.linked.has(rfiKey("A", "RFI-001")));
});

test("the lessons loop is wired: candidates are listed, drafts queue for review and record their RFIs", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /mcp\.tool\("list_lesson_candidates"/);
  assert.ok(src.includes("status=in.(approved,suggested)"), "a draft already in the queue is not drafted again");
  assert.ok(src.includes('linked_records: rfiLinks, source_type: "rfi"'), "save_knowledge writes the links the candidates reader reads");
  assert.ok(src.includes('const status = pn && !isAutomated && !sensitiveTerm ? "approved" : "suggested";'), "an automated save is never live without a reviewer");
  assert.ok(src.includes("...(untagged ? { coverage: untagged } : {})"), "the summary says how much of the log is untagged");
  assert.match(readFileSync(new URL("../../../SettyAdmin.html", import.meta.url), "utf8"), /list_lesson_candidates/);
});

test("the kind of work is read from the project type, and not guessed", () => {
  assert.equal(workKindOf("Type IV Renovation"), "renovation");
  assert.equal(workKindOf("Type II New Construction"), "new");
  assert.equal(workKindOf("Interior fit-out"), "renovation");
  assert.equal(workKindOf("Type III"), null);
  assert.equal(workKindOf(null), null);
});

const PROJECTS = [
  { projectNumber: "R1", owner: "SUNY", projectType: "Type IV Renovation" },
  { projectNumber: "R2", owner: "DASNY", projectType: "Type III Renovation" },
  { projectNumber: "N1", owner: "SUNY", projectType: "Type II New Construction" },
  { projectNumber: "ME", owner: "SUNY", projectType: "Type V Renovation" },
];
const WTAGS = [
  // qa-630 (existing conditions): renovations only
  { project: "R1", item_number: "1", cause: "field-condition", preventable: true, qa_item: "qa-630", note: "HWR line shown does not exist" },
  { project: "R2", item_number: "2", cause: "field-condition", preventable: true, qa_item: "qa-630", note: "subject only" },
  // qa-614 (ceilings): the most RFIs firm-wide, all on the new building
  { project: "N1", item_number: "3", cause: "coordination", preventable: true, qa_item: "qa-614", note: "duct against cable tray" },
  { project: "N1", item_number: "4", cause: "coordination", preventable: true, qa_item: "qa-614" },
  { project: "N1", item_number: "5", cause: "coordination", preventable: true, qa_item: "qa-614" },
  // noise: not preventable, no item, and the project's own log
  { project: "R1", item_number: "6", cause: "contractor", preventable: false, qa_item: "qa-630" },
  { project: "R1", item_number: "7", cause: "doc-missing", preventable: true, qa_item: null },
  { project: "ME", item_number: "8", cause: "coordination", preventable: true, qa_item: "qa-613" },
];

test("the design watchlist weights the same owner and the same kind of work, and says which applied", () => {
  const w = designWatchlist(WTAGS, PROJECTS, PROJECTS[3]);
  assert.deepEqual(w.basis, { kindOfWork: "renovation", rfisOnSameKindOfWork: 2, owner: "SUNY", rfisForSameOwner: 4, preventableRfisConsidered: 5 });
  assert.deepEqual(w.items.map((i) => i.qaItem), ["qa-614", "qa-630"], "three same-owner RFIs outrank two same-kind ones");
  assert.deepEqual(w.items[1], { qaItem: "qa-630", preventableRfis: 2, projects: 2, onSameKindOfWork: 2, forSameOwner: 1, example: "HWR line shown does not exist" });
  assert.ok(!w.items.some((i) => i.qaItem === "qa-613"), "the project's own RFIs are not a forecast for it");
  // A different owner: the renovation pattern now leads.
  const other = designWatchlist(WTAGS, PROJECTS, { projectNumber: "X", owner: "DASNY", projectType: "Renovation" });
  assert.equal(other.items[0].qaItem, "qa-630");
});

test("with no owner or type to go on, the watchlist is firm-wide and says so", () => {
  const w = designWatchlist(WTAGS, PROJECTS, { projectNumber: "X", owner: null, projectType: "" });
  assert.deepEqual(w.basis, { kindOfWork: null, owner: null, preventableRfisConsidered: 6 });
  assert.equal(w.items[0].qaItem, "qa-614");
  assert.equal("onSameKindOfWork" in w.items[0], false);
  assert.equal("forSameOwner" in w.items[0], false);
  assert.equal(designWatchlist([], PROJECTS, PROJECTS[0]).items.length, 0);
  assert.equal(designWatchlist(WTAGS, PROJECTS, PROJECTS[3], { max: 1 }).items.length, 1);
});

test("the briefing carries the watchlist only before construction, and survives its failure", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes("if (!construction && p.projectNumber) {"), "a job in construction gets no design forecast");
  assert.ok(src.includes("...(watchlist ? { designWatchlist: watchlist } : {}),"));
  assert.ok(src.includes('console.warn("[project_briefing] design watchlist skipped:"'), "a failure drops the extra, not the briefing");
  assert.ok(src.includes("It is a forecast from other jobs, not a finding"));
});
