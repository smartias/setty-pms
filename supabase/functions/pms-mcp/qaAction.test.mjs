// The floor under the QA action standard (record_qa_findings,
// revise_qa_finding_action).
//
//   node --test supabase/functions/pms-mcp/qaAction.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionProblem } from "./qaAction.ts";

test("actions that name the sheet and the change pass", () => {
  for (const a of [
    "Mechanical: on M-601, change FCU-1-1 and FCU-1-2 from 220/1/60 and FCU-3-9 from 280/1/60 to 208/1/60 to match E-601.",
    "Electrical: on E-603 Panel MG, change the EUH-1-6 breaker from 20A-2P to 30A-2P with #10 wire, per the E-601 schedule row.",
    "Fire Protection: replace 'Author' and 'Checker' with the drafter's and checker's initials in the title block of every SP sheet.",
    "PM: ask the architect to delete spec 086623 or locate the devices. No Setty change unless they are kept.",
    "PM, Fire Protection: obtain a current hydrant flow test. On SP-001, replace the 'THEORETICAL' 46.3 / 57.1 psi with the test values, date and source.",
    "Electrical, Fire Alarm: remove the 'NOT FOR CONSTRUCTION' stamp from the title block of every E, EN and FA sheet on the next issue.",
    "Plumbing: add the recirculation pump timer and aquastat controls and the narrative to a P sheet.",
    "Mechanical: confirm the heater size with the Qmark data. If 3 kW: revise M-602, E-601 and the four panel schedules. If 1.5 kW: change the FLA to 7.2 A.",
    "Correct to 208/1/60 on M-601.",
  ]) assert.equal(actionProblem(a), null, a);
});

test("actions that say nothing are named for what is missing", () => {
  assert.match(actionProblem(""), /no action given/);
  assert.match(actionProblem(null), /no action given/);
  for (const a of ["Coordinate.", "Verify", "Review and revise as required.", "Electrical: coordinate with the architect.",
    "Reconcile the drawings.", "Please verify and correct accordingly", "Mechanical, Electrical: coordinate with all trades as needed."]) {
    assert.match(actionProblem(a), /says only to/, a);
  }
  for (const a of ["Fix the breaker.", "Mechanical: add dampers."]) assert.match(actionProblem(a), /too short/, a);
  assert.match(actionProblem("Electrical: make the breaker size agree with the unit."), /names no sheet/);
});

test("a long action with no sheet number is let through", () => {
  // Lenient on purpose: a process action can be clear without a sheet.
  assert.equal(actionProblem("PM: ask the owner in writing whether the existing generator stays, and tell Electrical the answer before the one-line is reissued for bid."), null);
});

test("the connector flags vague actions and can rewrite one", () => {
  const here = new URL(".", import.meta.url);
  const src = readFileSync(new URL("index.ts", here), "utf8");
  assert.match(src, /from "\.\/qaAction\.ts"/);
  assert.match(src, /actionNeedsRewrite/);
  assert.match(src, /mcp\.tool\("revise_qa_finding_action"/);
  assert.match(readFileSync(new URL("README.md", here), "utf8"), /revise_qa_finding_action/);
  assert.match(readFileSync(new URL("../../../SettyAdmin.html", here), "utf8"), /revise_qa_finding_action/);
});
