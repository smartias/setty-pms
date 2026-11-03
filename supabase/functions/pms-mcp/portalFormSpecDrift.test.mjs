// The connector runs its own copy of portalFormSpec.js (a deployed edge
// function cannot import a file outside its folder). The copy must be
// byte-identical to the repo-root module the PMS loads, or the sweep and the
// page would disagree on what a portal form is and where its answers sit.
//   Fix a failure with: cp portalFormSpec.js supabase/functions/pms-mcp/portalFormSpec.js
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

test("supabase/functions/pms-mcp/portalFormSpec.js is the repo-root portalFormSpec.js", () => {
  const root = readFileSync(new URL("../../../portalFormSpec.js", import.meta.url), "utf8");
  const copy = readFileSync(new URL("./portalFormSpec.js", import.meta.url), "utf8");
  assert.equal(copy, root, "copy drifted: cp portalFormSpec.js supabase/functions/pms-mcp/portalFormSpec.js");
  assert.ok(!/^\s*import\s/m.test(copy), "portalFormSpec.js must stay import-free so Deno can load it alone");
});
