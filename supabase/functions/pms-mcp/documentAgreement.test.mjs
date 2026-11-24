// Tests for documentAgreement.js (check_document_agreement, qa-632). The
// cases marked RFI replay the disagreements the RFI log recorded, with the
// statements as the documents made them.
//
//   node --test supabase/functions/pms-mcp/documentAgreement.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { compareStatements, compareCircuits, checkAgreement, readQuantity, readMaterial, readCircuits } from "./documentAgreement.js";

test("quantities read into one unit", () => {
  assert.deepEqual(readQuantity('+42"AFF'), { value: 42, unit: "in" });
  assert.deepEqual(readQuantity("4'-0\" A.F.F."), { value: 48, unit: "in" });
  assert.deepEqual(readQuantity("48 in."), { value: 48, unit: "in" });
  assert.deepEqual(readQuantity('1-1/2"'), { value: 1.5, unit: "in" });
  assert.deepEqual(readQuantity("110cd"), { value: 110, unit: "cd" });
  assert.deepEqual(readQuantity("18 ga"), { value: 18, unit: "ga" });
  assert.deepEqual(readQuantity("22 kAIC"), { value: 22, unit: "kA" });
  assert.equal(readQuantity("stainless steel"), null);
  assert.equal(readQuantity("12"), null, "a bare number has no unit, so it is compared as text");
});

test("materials read to one name, with grade and construction", () => {
  assert.equal(readMaterial("Type 316 SS").material, "stainless steel");
  assert.equal(readMaterial("Type 316 SS").grade, "316");
  assert.equal(readMaterial("GALV. STL.").material, "galvanized steel");
  assert.equal(readMaterial("G90 galvanized").grade, "G90");
  assert.equal(readMaterial("alum. jacket").material, "aluminum");
  assert.deepEqual(readMaterial("prefabricated double-wall, aluminum jacket").qualifiers, ["double wall"]);
  assert.equal(readMaterial("as indicated").material, null);
});

test("RFI Tabler BID-341: detail shows an aluminum jacket, the spec calls for stainless", () => {
  const r = compareStatements([
    { subject: "Outdoor duct", attribute: "jacket material", source: "Detail 5/M701", value: "prefabricated double wall, aluminum jacket" },
    { subject: "outdoor duct", attribute: "Jacket Material", source: "Spec 233113 2.1", value: "stainless steel for duct exposed to weather" },
  ]);
  assert.equal(r.conflicts.length, 1, "subject and attribute match whatever the case");
  assert.match(r.conflicts[0].message, /Detail 5\/M701: aluminum; Spec 233113 2\.1: stainless steel\./);
  assert.match(r.conflicts[0].message, /Detail 5\/M701 calls for double wall; Spec 233113 2\.1 does not mention it\./);
});

test("RFI Tabler BID-189: a note limits strobes to 110 cd and 177 cd devices are drawn", () => {
  const r = compareStatements([
    { subject: "Strobes in typical units", attribute: "candela", source: "E503 sheet note 5", value: "110cd", limit: "max" },
    { subject: "Strobes in typical units", attribute: "candela", source: "E503 riser", value: "177cd" },
    { subject: "Strobes in typical units", attribute: "candela", source: "E402 plan", value: "15cd" },
  ]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].kind, "limit");
  assert.equal(r.conflicts[0].message, "E503 sheet note 5 sets a maximum of 110cd; E503 riser shows 177cd.", "15 cd is under the limit, and the two devices are not compared with each other");
});

test("RFI Tabler BID-340 and BID-271: two thicknesses for one insulation; a coating one spec part lists and the other omits", () => {
  const r = compareStatements([
    { subject: "Mineral wool insulation", attribute: "thickness", source: "M002 detail 3", value: '5"' },
    { subject: "Mineral wool insulation", attribute: "thickness", source: "M002 note", value: "2 inch", limit: "min" },
    { subject: "Mineral wool insulation at shaft", attribute: "thickness", source: "M002 detail 3", value: '5 in' },
    { subject: "Mineral wool insulation at shaft", attribute: "thickness", source: "M002 written note", value: "2 inch" },
    { subject: "Antimicrobial duct coating", attribute: "where applied", source: "Spec 233113 part 2.4 E", value: "antimicrobial coating" },
    { subject: "Antimicrobial duct coating", attribute: "where applied", source: "Spec 233113 part 3", silent: true },
  ]);
  assert.equal(r.agreed, 1, "5 in. is above a 2 in. minimum");
  assert.equal(r.conflicts.length, 2);
  assert.match(r.conflicts[0].message, /M002 detail 3: 5 in; M002 written note: 2 inch\./);
  assert.equal(r.conflicts[1].kind, "silent");
  assert.match(r.conflicts[1].message, /Spec 233113 part 2\.4 E states it; Spec 233113 part 3 does not\./);
});

test("what agrees, and what cannot be compared, is not a conflict", () => {
  const r = compareStatements([
    { subject: "Receptacles", attribute: "mounting height", source: "E-001 note", value: "18 in. AFF" },
    { subject: "Receptacles", attribute: "mounting height", source: "E-701 detail", value: "1'-6\"" },
    { subject: "Supply duct", attribute: "material", source: "Spec", value: "galvanized steel, G90" },
    { subject: "Supply duct", attribute: "material", source: "M-001 note", value: "GALV. STEEL" },
    { subject: "Exhaust duct", attribute: "material", source: "Spec", value: "steel" },
    { subject: "Exhaust duct", attribute: "material", source: "Schedule", value: "galvanized steel" },
    { subject: "Grilles", attribute: "finish", source: "H-003", value: "white" },
    { subject: "Pump", attribute: "size", source: "A", value: "2 in" },
    { subject: "Pump", attribute: "size", source: "B", value: "5 gpm" },
  ]);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.agreed, 3, "48 vs 4 ft, G90 vs unstated grade, and steel vs galvanized steel all agree");
  assert.deepEqual(r.notCompared.map((g) => g.subject), ["Grilles", "Pump"]);
  const grades = compareStatements([{ subject: "d", source: "a", value: "304 SS" }, { subject: "d", source: "b", value: "316 stainless" }]);
  assert.match(grades.conflicts[0].message, /a: 304; b: 316\./);
  const flex = compareStatements([{ subject: "FCU filter box", source: "M-701 detail 20", value: "hard-mounted" }, { subject: "FCU filter box", source: "M-201 plan", value: "flexible connection" }]);
  assert.match(flex.conflicts[0].message, /flexible connection; M-701 detail 20: hard connection\./);
});

test("circuit lists", () => {
  assert.deepEqual(readCircuits("15,17"), ["15", "17"]);
  assert.deepEqual(readCircuits("Ckt #55, 57 & 59"), ["55", "57", "59"]);
  assert.deepEqual(readCircuits("1 thru 4"), ["1", "2", "3", "4"]);
  assert.deepEqual(readCircuits("2-4"), ["2", "4"], "a hyphen is a multi-pole pair, not a range");
  assert.deepEqual(readCircuits(12), ["12"]);
  assert.deepEqual(readCircuits("l3"), ["L3"]);
});

test("RFI Boyland 142: plan circuits against the panel schedule", () => {
  const r = compareCircuits([{
    panel: "P1", plansComplete: true,
    plan: [
      { circuit: "51,53", load: "Workstations Open Office 105B", sheet: "E-201" },
      { circuit: "2", load: "Corridor 100 receptacles", sheet: "E-201" },
      { circuit: "7", load: "Lobby 101", sheet: "E-201" },
      { circuit: "60", load: "Copy 110", sheet: "E-201" },
      { circuit: "9", load: "Photo Studio 307 receptacles", sheet: "E-203", count: 3 },
      { circuit: "11", load: "unit heater", sheet: "E-201" },
    ],
    schedule: [
      { circuit: "51", load: "REC - CONFERENCE 104" }, { circuit: "53", load: "REC - CONFERENCE 104" },
      { circuit: "55", load: "WORKSTATIONS OPEN OFFICE 105B" },
      { circuit: "2", load: "RECEPTACLES CORRIDOR 100", breaker: "20A" },
      { circuit: "7", load: "SPARE" },
      { circuit: "9", load: "REC PHOTO STUDIO 307", count: 4 },
      { circuit: "11", load: "EF-3" },
      { circuit: "13", load: "SPACE" },
    ],
  }, { panel: "P9", plan: [{ circuit: "1" }], schedule: [] }]);
  const kinds = r.flags.map((f) => f.circuit + ":" + f.kind);
  assert.deepEqual(kinds, ["51:different-room", "53:different-room", "7:scheduled-as-spare", "60:not-on-schedule", "9:different-count", "11:different-load", "55:not-on-plan"]);
  assert.match(r.flags[0].message, /P1-51 on E-201 \(Workstations Open Office 105B\): the panel schedule gives circuit 51 to "REC - CONFERENCE 104"\./);
  assert.match(r.flags[4].message, /3 drawn on the plan, 4 on the panel schedule\./);
  assert.equal(r.notCompared[0].panel, "P9");
  const partial = compareCircuits([{ panel: "P1", plan: [{ circuit: "2", load: "Corridor 100" }], schedule: [{ circuit: "2", load: "CORRIDOR 100" }, { circuit: "4", load: "LOBBY" }] }]);
  assert.equal(partial.flags.length, 0, "without plansComplete, a scheduled circuit not on the plans read is not a finding");
});

test("one call returns both, and the tool and checklist item are in step", () => {
  const r = checkAgreement({ statements: [{ subject: "x", source: "a", value: "PVC" }, { subject: "x", source: "b", value: "copper" }], circuits: [{ panel: "L1", plan: [{ circuit: "3" }], schedule: [{ circuit: "1", load: "LTG" }] }] });
  assert.equal(r.flagged, 2);
  assert.equal(checkAgreement({}).flagged, 0);
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('mcp.tool("check_document_agreement"') && src.includes('from "./documentAgreement.js"'));
  const sql = readFileSync(new URL("../../migrations/20261124260000_qa_document_agreement_check.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("where item_id = 'qa-632'") && sql.includes("check_document_agreement") && sql.includes("automation = 'auto'"));
});
