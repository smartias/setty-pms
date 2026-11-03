// The connector runs its own copy of closeout.js (a deployed edge function
// cannot import a file outside its folder). The copy must be byte-identical
// to the repo-root module the PMS loads, or the connector and the Closeout
// tab would disagree on progress and who holds each item.
//   Fix a failure with: cp closeout.js supabase/functions/pms-mcp/closeout.js
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

test("supabase/functions/pms-mcp/closeout.js is the repo-root closeout.js", () => {
  const root = readFileSync(new URL("../../../closeout.js", import.meta.url), "utf8");
  const copy = readFileSync(new URL("./closeout.js", import.meta.url), "utf8");
  assert.equal(copy, root, "copy drifted: cp closeout.js supabase/functions/pms-mcp/closeout.js");
});
