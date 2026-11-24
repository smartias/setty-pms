// Assignee suggestion for RFIs and submittals (caAssign.js), and that the PMS
// and the Tracker load it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suggestAssignees, suggestionLabel } from "./caAssign.js";

const team = [
  { id: "pm", name: "Pat Manager", role: "Project Manager", disciplines: ["Mechanical", "Electrical", "Plumbing"] },
  { id: "dpm", name: "Dee Deputy", role: "Deputy Project Manager", disciplines: ["Electrical"] },
  { id: "e1", name: "Eli", role: "Engineer", disciplines: ["Electrical"] },
  { id: "m1", name: "Mo", role: "Sr. Mechanical Engineer" },
  { id: "p1", name: "Pia", role: "Engineer", discipline: "Plumbing" },
  { id: "p2", name: "Paz", role: "Plumbing Engineer", disciplines: ["Plumbing", "Fire Protection"] },
];

test("the engineer for the discipline is suggested, not the PM who lists every discipline", () => {
  assert.deepEqual(suggestAssignees(team, "Electrical"), { ids: ["e1"], names: ["Eli"], basis: "discipline", matches: 1 });
});

test("a role that names the discipline counts, and so does the older single discipline field", () => {
  assert.deepEqual(suggestAssignees(team, "Mechanical").ids, ["m1"]);
  assert.deepEqual(suggestAssignees(team, "Plumbing").ids, ["p1", "p2"]);
  assert.deepEqual(suggestAssignees(team, "fire protection").ids, ["p2"]);
});

test("no match, no discipline, or Multi-Discipline falls back to the PM", () => {
  assert.deepEqual(suggestAssignees(team, "Technology"), { ids: ["pm"], names: ["Pat Manager"], basis: "pm-no-match", matches: 0 });
  assert.equal(suggestAssignees(team, "").basis, "pm");
  assert.equal(suggestAssignees(team, "Multi-Discipline").basis, "pm");
  assert.equal(suggestAssignees(team, "Other").basis, "pm");
});

test("the PM is the named one when the project records a name, else the Project Manager role", () => {
  assert.deepEqual(suggestAssignees(team, "", "dee deputy").ids, ["dpm"]);
  assert.deepEqual(suggestAssignees(team, "", "Nobody Here").ids, ["pm"]);
});

test("three or more matches are left for the person to pick", () => {
  const big = [...team, { id: "e2", role: "Electrical Engineer" }, { id: "e3", role: "Engineer", disciplines: ["Electrical"] }];
  assert.deepEqual(suggestAssignees(big, "Electrical"), { ids: [], names: [], basis: "many", matches: 3 });
});

test("an empty team or no PM suggests nobody", () => {
  assert.equal(suggestAssignees([], "Electrical").basis, "none");
  assert.equal(suggestAssignees(undefined, "Electrical").basis, "none");
  assert.deepEqual(suggestAssignees(team.filter((m) => m.id !== "pm"), "Technology").ids, []);
});

test("labels say where the suggestion came from", () => {
  assert.equal(suggestionLabel(suggestAssignees(team, "Electrical"), "Electrical"), "Suggested for Electrical: Eli");
  assert.equal(suggestionLabel(suggestAssignees(team, "Technology"), "Technology"), "No Technology engineer on the team list. Suggested: Pat Manager (PM)");
  assert.equal(suggestionLabel(suggestAssignees([], "Electrical"), "Electrical"), "");
});

test("the PMS and the Tracker load caAssign.js and use it", () => {
  for (const f of ["SettyPMS.html", "RFISubmittalSync_Preview.html"]) {
    const html = readFileSync(new URL("./" + f, import.meta.url), "utf8");
    assert.match(html, /import \* as CaAssign from "\.\/caAssign\.js"/, f + " imports caAssign.js");
    assert.match(html, /CaAssign\.suggestAssignees\(/, f + " asks for a suggestion");
  }
});
