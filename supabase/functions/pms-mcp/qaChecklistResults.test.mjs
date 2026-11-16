// Checklist results and the design narrative stored on a QA review row.
//
//   node --test supabase/functions/pms-mcp/qaChecklistResults.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanChecklistResults, normalizeDisposition, checklistCountsLine, QA_RESULT_NOTE_MAX } from "./qaChecklistResults.ts";

const here = new URL(".", import.meta.url);
const read = (p) => readFileSync(new URL(p, here), "utf8");

test("dispositions normalize, and unknown ones are refused", () => {
  assert.equal(normalizeDisposition("Clean"), "clean");
  assert.equal(normalizeDisposition("not  attempted"), "not attempted");
  assert.equal(normalizeDisposition("Not verified"), "not attempted");
  assert.equal(normalizeDisposition("N/A"), "n/a");
  assert.equal(normalizeDisposition("passed"), "clean");
  assert.equal(normalizeDisposition("looks fine"), null);
  assert.equal(normalizeDisposition(undefined), null);
});

test("one entry per item, the last one wins, bad rows are reported", () => {
  const { results, dropped, counts } = cleanChecklistResults([
    { itemId: "qa-001", disposition: "clean", note: "Title blocks on all 64 sheets" },
    { itemId: "qa-002", disposition: "finding", note: "P-3" },
    { itemId: "qa-001", disposition: "partial", note: "E book only" },
    { itemId: "qa-003", disposition: "maybe" },
    { disposition: "clean" },
    { itemId: "qa-004", disposition: "not attempted", note: "x".repeat(2000) },
  ]);
  assert.deepEqual(results.map((r) => r.itemId), ["qa-001", "qa-002", "qa-004"]);
  assert.equal(results[0].disposition, "partial");
  assert.equal(results[0].note, "E book only");
  assert.equal(results[2].note.length, QA_RESULT_NOTE_MAX);
  assert.equal(dropped.length, 2);
  assert.deepEqual(counts, { partial: 1, finding: 1, "not attempted": 1 });
  assert.deepEqual(cleanChecklistResults(undefined).results, []);
});

test("the counts line reads like the report header", () => {
  assert.equal(checklistCountsLine({ clean: 12, finding: 6, flag: 3, partial: 3, "not attempted": 105, "n/a": 4 }),
    "12 clean, 9 finding/flag, 3 partial, 105 not attempted, 4 n/a (of 133)");
  assert.equal(checklistCountsLine({}), "");
});

test("the tool, the migration, the tab and the skill all carry both fields", () => {
  const index = read("./index.ts");
  assert.match(index, /checklistResults: z\.array/);
  assert.match(index, /designNarrative: z\.string/);
  assert.match(index, /checklist_results/);
  assert.match(index, /design_narrative/);
  const mig = read("../../migrations/20261117000000_qa_review_checklist_results.sql");
  assert.match(mig, /add column if not exists checklist_results jsonb/);
  assert.match(mig, /add column if not exists design_narrative\s+text/);
  const pms = read("../../../SettyPMS.html");
  assert.match(pms, /checklist_results/);
  assert.match(pms, /design_narrative/);
  const skill = read("../../../.claude/skills/qa-coordination-review/SKILL.md");
  assert.match(skill, /checklistResults/);
  assert.match(skill, /designNarrative/);
});
