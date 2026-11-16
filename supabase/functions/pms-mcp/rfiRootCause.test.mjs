// RFI root causes: the vocabulary and the summary a QA review reads.
//
//   node --test supabase/functions/pms-mcp/rfiRootCause.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RFI_ROOT_CAUSES, normalizeRootCause, normalizeQaItem, defaultPreventable, rfiPhase, summarizeRootCauses } from "./rfiRootCause.ts";

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
