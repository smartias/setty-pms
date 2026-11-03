// The connector runs its own copy of primeCa.js (a deployed edge function
// cannot import a file outside its folder). The copy must be byte-identical
// to the repo-root module the PMS loads, or the portal intake and the RFI /
// submittal tabs would number items differently.
//   Fix a failure with: cp primeCa.js supabase/functions/pms-mcp/primeCa.js
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

test("supabase/functions/pms-mcp/primeCa.js is the repo-root primeCa.js", () => {
  const root = readFileSync(new URL("../../../primeCa.js", import.meta.url), "utf8");
  const copy = readFileSync(new URL("./primeCa.js", import.meta.url), "utf8");
  assert.equal(copy, root, "copy drifted: cp primeCa.js supabase/functions/pms-mcp/primeCa.js");
});
