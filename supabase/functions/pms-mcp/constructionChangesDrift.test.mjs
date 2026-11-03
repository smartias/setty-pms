// The connector runs its own copy of constructionChanges.js (a deployed edge
// function cannot import a file outside its folder). The copy must be
// byte-identical to the repo-root module the PMS loads, or the connector and
// the Construction Changes tab would disagree on totals and statuses.
//   Fix a failure with: cp constructionChanges.js supabase/functions/pms-mcp/constructionChanges.js
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

test("supabase/functions/pms-mcp/constructionChanges.js is the repo-root constructionChanges.js", () => {
  const root = readFileSync(new URL("../../../constructionChanges.js", import.meta.url), "utf8");
  const copy = readFileSync(new URL("./constructionChanges.js", import.meta.url), "utf8");
  assert.equal(copy, root, "copy drifted: cp constructionChanges.js supabase/functions/pms-mcp/constructionChanges.js");
});
