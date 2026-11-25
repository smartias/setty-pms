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

// Cost estimate review: the packet marks the start, the save is fenced and
// goes through the shared rules, and the skill names both tools.
test("the cost estimate review tools are registered and fenced", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const a = src.indexOf('mcp.tool("get_cost_estimate_packet"'), b = src.indexOf('mcp.tool("save_cost_estimate_review"'), c = src.indexOf("// ── file_qa_report");
  assert.ok(a > 0 && b > a && c > b);
  const packet = src.slice(a, b), save = src.slice(b, c);
  assert.ok(packet.includes("costReviewGate(projectNumber, false)") && packet.includes("markCostReviewStarted("));
  assert.ok(save.includes("costReviewGate(input.projectNumber, true)") && save.includes("planCostEstimateReview(") && save.includes("updateProjectRecord(g.pid"));
  const gate = src.slice(src.indexOf("async function costReviewGate("), a);
  assert.ok(gate.includes('c.kind !== "user"') && gate.includes('"fees.view"') && gate.includes('"projects.edit"'));
  assert.ok(/"costdocflags", "costestimatereviews"/.test(src), "reviews are redacted with the fee keys");
  const skill = readFileSync(new URL("../../../.claude/skills/cost-estimate-review/SKILL.md", import.meta.url), "utf8");
  for (const t of ["get_cost_estimate_packet", "save_cost_estimate_review", "read_document", "get_current_set"]) assert.ok(skill.includes("`" + t + "`"), t);
  assert.ok(skill.includes("**Do not price anything.**"));
  const html = readFileSync(new URL("../../../SettyPMS.html", import.meta.url), "utf8");
  assert.ok(html.includes("get_cost_estimate_packet") && html.includes("save_cost_estimate_review"), "the PMS request names both tools");
  assert.ok(html.includes("CC.markCostReviewRequested("));
});

// Line-by-line detail: stored through the fenced gate, replaced as a set, and
// the workbook and PDF reads are both tied to the project by the file index.
test("the estimate line tools are registered, fenced and tied to the project", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const a = src.indexOf('mcp.tool("save_cost_estimate_lines"'), b = src.indexOf('mcp.tool("get_cost_estimate_lines"'), c = src.indexOf("// ── file_qa_report");
  assert.ok(a > 0 && b > a && c > b);
  const save = src.slice(a, b), read = src.slice(b, c);
  assert.ok(save.includes("costReviewGate(projectNumber, !preview)"), "a preview needs no edit right; a write does");
  assert.ok(save.includes("deleteCostLines(g.pn, review.id)") && save.includes("setReviewLines("));
  assert.ok(save.includes("verifyLinesAgainstPages(") && save.includes("extractSheetLines("));
  assert.ok(read.includes("costReviewGate(projectNumber, false)"));
  // Both file reads go through one gate. The index ties a file to the project;
  // a file the index has not seen must be visible to the caller AND either sit
  // in the project's folder or have been attached to the project by a person.
  for (const fn of ["async function projectWorkbookRows(", "async function projectPdfPageTexts("]) {
    const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 500);
    assert.ok(body.includes("await costFileForProject(pn, proj, itemId)"), fn + " checks the file belongs to the project");
  }
  const gate = src.slice(src.indexOf("async function costFileForProject("), src.indexOf("async function projectWorkbookRows("));
  assert.ok(gate.includes('"&scope=eq." + encodeURIComponent(pn.trim().toLowerCase())'));
  assert.ok(gate.includes("await sharePointItemVisible(drive, meta)"));
  assert.ok(gate.includes("if (!inProjectFolder && !attached)") && gate.includes("f.manual === true"));
  const skill = readFileSync(new URL("../../../.claude/skills/cost-estimate-review/SKILL.md", import.meta.url), "utf8");
  for (const t of ["save_cost_estimate_lines", "get_cost_estimate_lines"]) assert.ok(skill.includes("`" + t + "`"), t);
  const html = readFileSync(new URL("../../../SettyPMS.html", import.meta.url), "utf8");
  assert.ok(html.includes("function CostEstimateLinesTable(") && html.includes("pms_cost_estimate_lines?select="));
  assert.ok(html.includes("save_cost_estimate_lines"), "the PMS request asks for the lines to be stored");
});

// get_cost_estimates reads the same data for a design narrative or a briefing,
// behind the same fence, and writes nothing: no "started" stamp, no record
// update. The design-narrative skill names it.
test("get_cost_estimates is read-only and fenced like fee data", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const a = src.indexOf('mcp.tool("get_cost_estimates"'), b = src.indexOf('mcp.tool("get_cost_estimate_packet"');
  assert.ok(a > 0 && b > a, "registered just before the packet");
  const tool = src.slice(a, b);
  assert.ok(tool.includes("costReviewGate(projectNumber, false)"), "signed-in, fees permission, no edit right needed");
  for (const w of ["markCostReviewStarted(", "updateProjectRecord(", "planCostEstimateReview(", "sbPatch(", "sbPost("]) assert.ok(!tool.includes(w), "writes nothing: " + w);
  assert.ok(tool.includes("estimateReviewView(r)") && tool.includes("costLogOf(p)"));
  const skill = readFileSync(new URL("../../../.claude/skills/design-narrative/SKILL.md", import.meta.url), "utf8");
  assert.ok(skill.includes("`get_cost_estimates`"), "the design-narrative skill reads the cost estimate");
  assert.ok(!skill.includes("`get_cost_estimate_packet`"), "and never starts a review from a narrative");
});
