// A running QA review shows its status in the QA Reviews tab.
// Drift anchors across the migration, the tool, the tab, the skill and the
// prompt: each one alone is useless.
//
//   node --test supabase/functions/pms-mcp/qaReviewProgress.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const read = (p) => readFileSync(new URL(p, here), "utf8");

test("the migration adds the status columns and limits the status values", () => {
  const mig = read("../../migrations/20261117010000_qa_review_status.sql");
  for (const col of ["status", "progress_step", "progress_note", "progress_at"]) {
    assert.match(mig, new RegExp("add column if not exists " + col + "\\s"));
  }
  assert.match(mig, /status in \('running', 'complete', 'stopped'\)/);
  assert.match(mig, /status is null or/, "rows recorded before the migration must stay valid");
});

test("the tool opens a review, updates it, and cannot reopen a recorded one", () => {
  const index = read("./index.ts");
  assert.match(index, /mcp\.tool\("set_qa_review_progress"/);
  const tool = index.slice(index.indexOf('mcp.tool("set_qa_review_progress"'), index.indexOf('mcp.tool("mark_qa_key_item"'));
  assert.match(tool, /qaLedgerCaller\(\)/, "progress writes need a signed-in caller");
  assert.match(tool, /existing\[0\]\.status === "complete"/);
  assert.match(tool, /progressNotStored/);
  // record_qa_findings finishes a running review, and only a running one.
  assert.match(index, /pms_qa_reviews\?id=eq\.\$\{rid\}&status=eq\.running/);
});

test("the tab shows running, stale and stopped, and never trusts an old 'running'", () => {
  const pms = read("../../../SettyPMS.html");
  assert.match(pms, /function qaReviewStatus\(r, now\)/);
  assert.match(pms, /QA_REVIEW_STALE_MS = 90 \* 60 \* 1000/);
  assert.match(pms, /kind: stale \? "stale" : "running"/);
  assert.match(pms, /set_qa_review_progress/, "the QA tab prompt does not ask for progress");
});

test("the skill tells the review to report its step and record on the same review", () => {
  const skill = read("../../../.claude/skills/qa-coordination-review/SKILL.md");
  assert.match(skill, /set_qa_review_progress/);
  assert.match(skill, /status: 'stopped'/);
  assert.match(skill, /Pass the `reviewId` that `set_qa_review_progress` returned/);
});
