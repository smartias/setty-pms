// The proposal draft reads project-record facts out of the RFP (address, area,
// building category, project type, construction budget). The rules live in two
// places that must agree: buildClaudeDraftPrompt in SettyPMS.html and the
// proposal-draft edge function. The PMS drops any category or type it does not
// know, so a list that drifts silently loses the field.
//
//   node --test proposalRecordFacts.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./SettyPMS.html", import.meta.url), "utf8");
const edge = readFileSync(new URL("./supabase/functions/proposal-draft/index.ts", import.meta.url), "utf8");

const quoted = (s) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

test("the edge function's building categories are the app's cost-per-SF keys", () => {
  const app = page.match(/const RS_MEANS_COST_PER_SF = \{([\s\S]*?)\};/);
  const fn = edge.match(/const BUILDING_CATEGORIES = \[([\s\S]*?)\];/);
  assert.ok(app && fn, "category list not found");
  const appKeys = [...app[1].matchAll(/"([^"]+)":/g)].map((m) => m[1]);
  assert.deepEqual(quoted(fn[1]), appKeys);
});

test("both prompts ask for buildingCategory and carry it in the schema", () => {
  assert.ok(page.includes('squareFootage, buildingCategory, projectType, constructionBudget): I review'), "app prompt rule");
  assert.ok(page.includes('\\"buildingCategory\\": null'), "app prompt schema");
  assert.ok(page.includes("Object.keys(RS_MEANS_COST_PER_SF).map("), "app prompt must list the categories from the constant");
  assert.ok(edge.includes("squareFootage, buildingCategory, projectType, constructionBudget): the PM"), "edge prompt rule");
  assert.ok(edge.includes('"buildingCategory": null'), "edge prompt schema");
  assert.ok(edge.includes("${BUILDING_CATEGORY_LIST}"), "edge prompt must list the categories");
});

test("the import preview offers the category and drops unknown values", () => {
  assert.ok(page.includes('add("buildingCategory", "Building category", cat || ""'), "buildRecordFields does not offer buildingCategory");
  assert.ok(page.includes("Object.keys(RS_MEANS_COST_PER_SF).find(t => t.toLowerCase() === wantedCat)"), "category must be matched against the known list");
});
