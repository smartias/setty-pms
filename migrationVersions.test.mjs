// Version rules for supabase/migrations/ file names
// (.github/scripts/migration-versions.mjs), plus checks that the Tests
// workflow actually runs them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  migrationVersion, malformedNameProblems, duplicateVersionProblems, staleVersionProblems,
} from "./.github/scripts/migration-versions.mjs";

const A = "20261124130000_emails_search_snippet_cap.sql";
const B = "20261124140000_knowledge_embeddings.sql";
const C = "20261124140000_qa_rfi_history_items_2027.sql";
const C_RENAMED = "20261124150000_qa_rfi_history_items_2027.sql";

test("the version is the 14 digits before the first underscore", () => {
  assert.equal(migrationVersion(B), "20261124140000");
  assert.equal(migrationVersion("2026112414_short.sql"), null);
  assert.equal(migrationVersion("202611241400001_long.sql"), null);
  assert.equal(migrationVersion("20261124140000.sql"), null);
  assert.equal(migrationVersion("README.md"), null);
});

test("a .sql file without a 14-digit version is reported; other files are ignored", () => {
  assert.deepEqual(malformedNameProblems([A, "README.md", ".gitkeep"]), []);
  const problems = malformedNameProblems([A, "2026112414_short.sql", "fix.sql"]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /supabase\/migrations\/2026112414_short\.sql/);
  assert.match(problems[1], /supabase\/migrations\/fix\.sql/);
});

test("unique versions pass", () => {
  assert.deepEqual(duplicateVersionProblems([A, B, C_RENAMED]), []);
  assert.deepEqual(duplicateVersionProblems([]), []);
});

test("two files with one version fail, and the message names both (PRs #564 and #565)", () => {
  const problems = duplicateVersionProblems([C, A, B]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /20261124140000/);
  assert.ok(problems[0].includes(B), "names the first file");
  assert.ok(problems[0].includes(C), "names the second file");
});

test("each duplicated version is reported once, with every file that uses it", () => {
  const problems = duplicateVersionProblems([
    "20260101000000_a.sql", "20260101000000_b.sql", "20260101000000_c.sql",
    "20260202000000_d.sql", "20260202000000_e.sql", "20260303000000_f.sql",
  ]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /3 files share the version 20260101000000: 20260101000000_a\.sql and 20260101000000_b\.sql and 20260101000000_c\.sql/);
  assert.match(problems[1], /2 files share the version 20260202000000/);
});

test("a new file must sort after the newest migration on main", () => {
  // Nothing new, or a later version: fine.
  assert.deepEqual(staleVersionProblems([A, B], [A, B]), []);
  assert.deepEqual(staleVersionProblems([A, B, C_RENAMED], [A, B]), []);
  // main has no migrations at all: nothing to compare with.
  assert.deepEqual(staleVersionProblems([A], []), []);

  // Same version as the newest on main: the two-open-PRs case. The branch has
  // not picked up B yet, so the folder itself holds no duplicate.
  const same = staleVersionProblems([A, C], [A, B]);
  assert.equal(same.length, 1);
  assert.ok(same[0].includes(C) && same[0].includes(B), "names the new file and the one on main");
  assert.match(same[0], /is the same as/);

  // Older than the newest on main.
  const older = staleVersionProblems([A, B, "20261124135900_late.sql"], [A, B]);
  assert.equal(older.length, 1);
  assert.match(older[0], /20261124135900_late\.sql.*sorts before.*20261124140000_knowledge_embeddings\.sql/);
});

test("old files that main already has are never reported, whatever their order", () => {
  assert.deepEqual(staleVersionProblems([B, A], [A, B]), []);
  // A migration removed on the branch is not this check's business.
  assert.deepEqual(staleVersionProblems([B], [A, B]), []);
});

test("the Tests workflow runs both checks", () => {
  const script = readFileSync(".github/scripts/check-source.mjs", "utf8");
  assert.match(script, /from "\.\/migration-versions\.mjs"/);
  assert.match(script, /duplicateVersionProblems\(/);
  assert.match(script, /staleVersionProblems\(/);
  const workflow = readFileSync(".github/workflows/tests.yml", "utf8");
  assert.match(workflow, /node \.github\/scripts\/check-source\.mjs/);
  assert.match(workflow, /MIGRATIONS_BASE_REF:.*origin\/main/);
  assert.match(workflow, /git fetch .*refs\/remotes\/origin\/main/);
});
