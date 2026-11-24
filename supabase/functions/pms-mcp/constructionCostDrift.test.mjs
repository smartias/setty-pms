// The connector runs its own copy of constructionCost.js (a deployed edge
// function cannot import a file outside its folder). The copy must be
// byte-identical to the repo-root module the PMS loads, or the connector and
// the Schedule tab would disagree on the construction cost on record.
//   Fix a failure with: cp constructionCost.js supabase/functions/pms-mcp/constructionCost.js
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

test("supabase/functions/pms-mcp/constructionCost.js is the repo-root constructionCost.js", () => {
  const root = readFileSync(new URL("../../../constructionCost.js", import.meta.url), "utf8");
  const copy = readFileSync(new URL("./constructionCost.js", import.meta.url), "utf8");
  assert.equal(copy, root, "copy drifted: cp constructionCost.js supabase/functions/pms-mcp/constructionCost.js");
});

// Drift anchors on the tool registration: the write is fenced like
// set_project_fee, and the log is treated as fee data when a record is read.
test("record_construction_cost is registered, fenced and redacted like fee data", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('mcp.tool("record_construction_cost"'));
  const tool = src.slice(src.indexOf('mcp.tool("record_construction_cost"'), src.indexOf("// ── file_qa_report"));
  assert.ok(tool.includes('c.kind !== "user"'), "signed-in callers only");
  assert.ok(tool.includes('capFor(caps, "fees.view", pn)') && tool.includes('capFor(caps, "projects.edit", pn)'));
  assert.ok(tool.includes("updateProjectRecord(pid"), "goes through the concurrency-safe write");
  assert.ok(tool.includes('via: "connector"'));
  assert.ok(/"manualconstructioncost", "constructioncostlog"/.test(src), "the history is redacted with the other fee keys");
  assert.ok(src.includes("rfisPerMillion("), "rfi_root_cause_summary reports the per-$1M measure");
});

// The nightly file sync flags a cost estimate saved to the project folder.
test("the file sync flags new cost documents and cannot fail over it", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const sync = src.slice(src.indexOf("async function syncProjectDocuments("), src.indexOf("async function walkLibraryFolder("));
  assert.ok(sync.includes("await flagNewCostDocuments(p, scope)"), "project folders only, after the rows are written");
  const fn = src.slice(src.indexOf("async function flagNewCostDocuments("), src.indexOf('mcp.tool("record_construction_cost"'));
  assert.ok(fn.includes("try {") && fn.includes("return 0;"), "a failure is logged and swallowed, never thrown into the sync");
  assert.ok(fn.includes("updateProjectRecord(pid") && fn.includes("planCostDocFlags("));
  assert.ok(/"constructioncostlog", "costdocflags"/.test(src), "flags are redacted with the fee keys");
});
