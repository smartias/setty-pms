// The connector runs its own copy of caIntake.js (a deployed edge function
// cannot import a file outside its folder). The copy must be byte-identical
// to the repo-root module the RFI / Submittal Tracker loads, or the tracker
// and the scheduled intake would disagree on what is NEW.
//   Fix a failure with: cp caIntake.js supabase/functions/pms-mcp/caIntake.js
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

test("supabase/functions/pms-mcp/caIntake.js is the repo-root caIntake.js", () => {
  const root = readFileSync(new URL("../../../caIntake.js", import.meta.url), "utf8");
  const copy = readFileSync(new URL("./caIntake.js", import.meta.url), "utf8");
  assert.equal(copy, root, "copy drifted: cp caIntake.js supabase/functions/pms-mcp/caIntake.js");
});
