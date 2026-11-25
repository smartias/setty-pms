// Tests for docsSyncPlan.ts: which scopes one documents-sync run starts.
import { strict as assert } from "node:assert";
import test from "node:test";
import { docsScopeDecision, isBigDocsScope, DOCS_BIG_SCOPE_FILES, DOCS_RUN_BUDGET_MS } from "./docsSyncPlan.ts";

test("a scope is big when its last walk was large or incomplete", () => {
  assert.equal(isBigDocsScope(undefined), false);
  assert.equal(isBigDocsScope({ fileCount: 10, complete: true }), false);
  assert.equal(isBigDocsScope({ fileCount: DOCS_BIG_SCOPE_FILES, complete: true }), true);
  assert.equal(isBigDocsScope({ fileCount: 200, complete: false }), true);
  assert.equal(isBigDocsScope({ fileCount: null, complete: null }), false);
});

test("a big scope runs only first, and nothing starts after it", () => {
  const base = { maxScopes: 6, ranBig: false, elapsedMs: 0 };
  assert.equal(docsScopeDecision({ ...base, started: 0, big: true }), "run");
  assert.equal(docsScopeDecision({ ...base, started: 2, big: true, elapsedMs: 5000 }), "skip");
  assert.equal(docsScopeDecision({ ...base, started: 1, big: false, ranBig: true }), "stop");
});

test("no new scope starts after the budget or the scope cap", () => {
  const base = { maxScopes: 6, ranBig: false, big: false };
  assert.equal(docsScopeDecision({ ...base, started: 3, elapsedMs: DOCS_RUN_BUDGET_MS - 1 }), "run");
  assert.equal(docsScopeDecision({ ...base, started: 3, elapsedMs: DOCS_RUN_BUDGET_MS + 1 }), "stop");
  assert.equal(docsScopeDecision({ ...base, started: 6, elapsedMs: 0 }), "stop");
  assert.equal(docsScopeDecision({ ...base, started: 0, elapsedMs: 10, budgetMs: 5 }), "stop");
});
