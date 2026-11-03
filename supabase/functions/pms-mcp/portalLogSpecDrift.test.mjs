// The connector runs its own copy of portalLogSpec.js (a deployed edge
// function cannot import a file outside its folder). The copy must be
// byte-identical to the repo-root module, or the log the contractor sees and
// the one the page would build would disagree.
//   Fix a failure with: cp portalLogSpec.js supabase/functions/pms-mcp/portalLogSpec.js
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

test("supabase/functions/pms-mcp/portalLogSpec.js is the repo-root portalLogSpec.js", () => {
  const root = readFileSync(new URL("../../../portalLogSpec.js", import.meta.url), "utf8");
  const copy = readFileSync(new URL("./portalLogSpec.js", import.meta.url), "utf8");
  assert.equal(copy, root, "copy drifted: cp portalLogSpec.js supabase/functions/pms-mcp/portalLogSpec.js");
  assert.ok(!/^\s*import\s/m.test(copy), "portalLogSpec.js must stay import-free so Deno can load it alone");
});
