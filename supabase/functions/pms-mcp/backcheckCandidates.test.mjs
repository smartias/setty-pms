// Which QA ledger rows are due a back-check (list_backcheck_candidates).
//
//   node --test supabase/functions/pms-mcp/backcheckCandidates.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { issuedSets, backcheckStatus, setKey } from "./backcheckCandidates.ts";

const P = "SAPX236012.00";
const files = [
  { set_name: "2024-08-29_100% DD", set_date: "2024-08-29", first_seen_at: "2026-05-01T00:00:00Z", discipline: "M" },
  { set_name: "2025-08-22_100%_CD", set_date: "2025-08-22", first_seen_at: "2026-05-01T00:00:00Z", discipline: "M" },
  { set_name: "2025-08-22_100%_CD", set_date: "2025-08-22", first_seen_at: "2026-05-01T00:00:00Z", discipline: "E" },
  // A folder of comment registers: typed Drawing by the index, no discipline.
  { set_name: "2026-04-16 Comment Response", set_date: "2026-04-16", first_seen_at: "2026-05-17T00:00:00Z", discipline: null },
  { set_name: null, set_date: null, discipline: "M" },
];

test("the newest set is the newest dated folder that holds discipline drawings", () => {
  const sets = issuedSets(files);
  assert.deepEqual(sets.map((s) => s.name), ["2025-08-22_100%_CD", "2024-08-29_100% DD"]);
  assert.equal(sets[0].files, 2);
  assert.equal(sets[0].date, "2025-08-22");
  assert.deepEqual(issuedSets([]), []);
});

test("undated sets fall back to when the index first saw them", () => {
  const sets = issuedSets([
    { set_name: "Bulletin 2", first_seen_at: "2026-11-10T00:00:00Z", discipline: "E" },
    { set_name: "Bulletin 1", first_seen_at: "2026-10-01T00:00:00Z", discipline: "E" },
  ]);
  assert.equal(sets[0].name, "Bulletin 2");
});

test("set names compare on letters and digits", () => {
  assert.equal(setKey("2025-08-22_100%_CD"), "2025 08 22 100 cd");
  assert.ok(setKey("2025-08-22_100%_CD (look-back review, run 2026-11-16)").includes(setKey("2025-08-22_100%_CD")));
});

const reviews = [
  { id: 36, project: P, set_name: "2025-08-22_100%_CD (look-back review, run 2026-11-16)", kind: "review", run_at: "2026-11-16T17:52:00Z" },
  { id: 37, project: P, set_name: "2024-08-29_100% DD: BPL / Envoie review comments", kind: "comment-log", run_at: "2026-11-16T18:00:00Z" },
];
const rows = [
  { id: 168, project: P, review_id: 36, source: "qa", created_at: "2026-11-16T17:52:00Z" },
  { id: 201, project: P, review_id: 37, source: "owner", created_at: "2026-11-16T18:00:00Z" },
  { id: 202, project: P, review_id: 37, source: "owner", created_at: "2026-11-16T18:00:01Z" },
  { id: 300, project: P, review_id: null, source: "rfi", created_at: "2026-11-01T00:00:00Z" },
  { id: 400, project: "OTHER", review_id: null, source: "qa", created_at: "2026-11-01T00:00:00Z" },
];

test("old comments are due against the newest set; rows raised on that set are not", () => {
  const c = backcheckStatus(P, rows, reviews, issuedSets(files));
  assert.equal(c.newestSet.name, "2025-08-22_100%_CD");
  assert.equal(c.openRows, 3, "the rfi flag and the other project's row are not counted");
  assert.deepEqual(c.dueIds, [201, 202]);
  assert.equal(c.dueExternal, 2);
  assert.equal(c.dueInternal, 0);
  assert.equal(c.raisedOnThisSet, 1);
});

test("a recorded back-check of the set clears it, including a pass that moved nothing", () => {
  const done = [...reviews, { id: 39, project: P, set_name: "2025-08-22_100%_CD", kind: "backcheck", run_at: "2026-11-16T19:00:00Z" }];
  const c = backcheckStatus(P, rows, done, issuedSets(files));
  assert.equal(c.due, 0);
  assert.equal(c.alreadyChecked, 2);
  assert.equal(c.lastBackcheckOfThisSet, "2026-11-16T19:00:00Z");
});

test("a comment ingested after the back-check is due again; so is everything when a newer set lands", () => {
  const done = [...reviews, { id: 39, project: P, set_name: "2025-08-22_100%_CD", kind: "backcheck", run_at: "2026-11-16T19:00:00Z" }];
  const late = [...rows, { id: 500, project: P, review_id: 37, source: "agency", created_at: "2026-11-17T09:00:00Z" }];
  assert.deepEqual(backcheckStatus(P, late, done, issuedSets(files)).dueIds, [500]);
  const bulletin = [...files, { set_name: "2026-11-20_Bulletin 1", set_date: "2026-11-20", discipline: "E" }];
  const c = backcheckStatus(P, rows, done, issuedSets(bulletin));
  assert.equal(c.newestSet.name, "2026-11-20_Bulletin 1");
  assert.deepEqual(c.dueIds, [168, 201, 202], "rows raised on the earlier set are due against the bulletin");
});

test("a project with no issued set, or no open rows, is never due", () => {
  assert.equal(backcheckStatus(P, rows, reviews, []).due, 0);
  assert.equal(backcheckStatus("NONE", rows, reviews, issuedSets(files)).due, 0);
});

test("the connector registers the tool and the docs name it", () => {
  const here = new URL(".", import.meta.url);
  const src = readFileSync(new URL("index.ts", here), "utf8");
  assert.match(src, /mcp\.tool\("list_backcheck_candidates"/);
  assert.match(src, /from "\.\/backcheckCandidates\.ts"/);
  assert.match(readFileSync(new URL("README.md", here), "utf8"), /list_backcheck_candidates/);
  assert.match(readFileSync(new URL("../../../SettyAdmin.html", here), "utf8"), /list_backcheck_candidates/);
  assert.match(readFileSync(new URL("../../../.claude/skills/qa-coordination-review/SKILL.md", here), "utf8"), /list_backcheck_candidates/);
});
