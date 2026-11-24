// Tests for spaceCheck.js: whether what is drawn fits the space it is drawn
// in. Cases are the kinds of RFI the check is for (a ceiling that had to come
// down, a closet too shallow for the equipment and its working space), and
// spaces that fit and must NOT be flagged.
//
//   node --test supabase/functions/pms-mcp/spaceCheck.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { checkSpaceRow, checkSpace, toInches, feetInches, voltsToGroundOf, SPACE_KINDS, DEFAULT_TIGHT_IN } from "./spaceCheck.js";

test("dimensions are read as drawn, and an unreadable one is null", () => {
  const cases = [["9'-6\"", 114], ["9'-6 1/2\"", 114.5], ["114\"", 114], ["9.5'", 114], ["9 ft 6 in", 114], ["1/2\"", 0.5],
    ["6-1/2\"", 6.5], ["8'-0\" AFF", 96], ["114", 114], ["9'", 108], ["1'-0 3/4\"", 12.75], ["9’-6”", 114], ["9'-6''", 114]];
  for (const [s, want] of cases) assert.equal(toInches(s), want, s);
  assert.equal(toInches(20), 20, "a number is inches");
  for (const bad of ["abc", "", "12/0", "see section", null, undefined, -4, NaN, "9'-6\" to 10'-0\""]) assert.equal(toInches(bad), null, String(bad));
  assert.equal(feetInches(114), "9'-6\"");
  assert.equal(feetInches(20.5), "1'-8.5\"");
});

test("plenum: floor to floor less structure less ceiling, against the stack", () => {
  // 12'-0" less 26 in. of structure less a ceiling at 8'-6" leaves 16 in.
  const row = { id: "Corridor 2 at grid C", kind: "plenum", floorToFloor: "12'-0\"", structureDepth: "2'-2\"", ceilingHeight: "8'-6\"",
    stack: [{ what: "supply duct", depth: 14, insulation: 1.5 }, { what: "sprinkler main", depth: 4.5 }, { what: "light fixture", depth: 6 }] };
  const bad = checkSpaceRow(row);
  assert.equal(bad.status, "flag");
  assert.deepEqual([bad.availableIn, bad.neededIn, bad.marginIn], [16, 27.5, -11.5]);
  assert.equal(bad.stack[0].inches, 17, "insulation counts on both sides");
  assert.equal(bad.ceilingToFit, "7'-6.5\"");
  assert.match(bad.message, /^Does not fit: the plenum has 16 in\. \(1'-4"\) and what is drawn needs 27\.5 in\., 11\.5 in\. short\. As drawn it would take a ceiling at 7'-6\.5", not 8'-6"\.$/);
  const ok = checkSpaceRow({ ...row, ceilingHeight: "7'-0\"" });
  assert.equal(ok.status, "ok", "the same stack under a 7 ft ceiling fits");
  assert.equal(ok.marginIn, 6.5);
  assert.ok(!bad.message.includes(".."), "no doubled full stop after 'in.'");
});

test("plenum: the other two ways to state what is available, and a sloped pipe", () => {
  // Underside of beam at 10'-4", ceiling at 9'-0": 16 in. A 1 in. condensate line falling 1/8 in. per ft over 20 ft needs 3.5.
  const t = checkSpaceRow({ id: "Rm 108", kind: "plenum", structureBottomAff: "10'-4\"", ceilingHeight: "9'-0\"",
    stack: [{ what: "fan coil", depth: 12 }, { what: "condensate", depth: 1, slopeInPerFt: 0.125, runFt: 20 }] });
  assert.equal(t.status, "tight", "0.5 in. left is not a fit anyone can build");
  assert.deepEqual([t.availableIn, t.neededIn, t.marginIn], [16, 15.5, 0.5]);
  assert.match(t.stack[1].from, /2\.5 in\. of fall over 20 ft/);
  assert.equal(checkSpaceRow({ id: "A", kind: "plenum", plenum: "2'-0\"", stack: [{ what: "duct", depth: 18 }] }).status, "ok");
  assert.equal(checkSpaceRow({ id: "A", kind: "plenum", plenum: 24, stack: [{ what: "duct", depth: 18 }], allowance: 5 }).status, "tight", "an allowance is added to what is needed");
  assert.equal(checkSpaceRow({ id: "A", kind: "plenum", plenum: 24, stack: [{ what: "duct", depth: 18 }], tightIn: 8 }).status, "tight");
  assert.equal(DEFAULT_TIGHT_IN, 2);
});

test("plenum: nothing is guessed", () => {
  const stack = [{ what: "duct", depth: 12 }];
  assert.match(checkSpaceRow({ id: "A", kind: "plenum", floorToFloor: 144, structureDepth: 24, stack }).message, /does not give the ceiling height/);
  assert.match(checkSpaceRow({ id: "A", kind: "plenum", ceilingHeight: 108, stack }).message, /floor-to-floor height or the underside of structure/);
  assert.match(checkSpaceRow({ id: "A", kind: "plenum", ceilingHeight: 108, floorToFloor: 144, stack }).message, /does not give the structure depth/);
  assert.match(checkSpaceRow({ id: "A", kind: "plenum", plenum: 24 }).message, /nothing was passed to add up/);
  assert.match(checkSpaceRow({ id: "A", kind: "plenum", plenum: 24, stack: [{ what: "VAV box" }] }).message, /the size of VAV box could not be read/);
  assert.match(checkSpaceRow({ id: "A", kind: "plenum", plenum: "see section", stack }).message, /plenum \("see section"\) could not be read/);
  assert.match(checkSpaceRow({ id: "A", kind: "plenum", plenum: 24, stack: [{ what: "storm", depth: 4, slopeInPerFt: 0.25 }] }).message, /needs both its slope/);
  for (const r of [{ id: "A", kind: "plenum", plenum: 24 }, { id: "B", kind: "nope" }, {}]) assert.equal(checkSpaceRow(r).status, "cannot-check");
  // Numbers that leave no plenum are a misread until shown otherwise.
  const none = checkSpaceRow({ id: "A", kind: "plenum", floorToFloor: "10'-0\"", structureDepth: 30, ceilingHeight: "9'-0\"", stack });
  assert.equal(none.status, "flag");
  assert.match(none.message, /leave no plenum at all/);
});

test("fit: a room, shaft or pit against what sits along one dimension", () => {
  // An 18 in. deep transfer switch and 36 in. of working space in a 4 ft closet.
  const ats = checkSpaceRow({ id: "ATS Room", kind: "fit", of: "ATS Room depth", available: "4'-0\"", parts: [{ what: "ATS", size: 18 }, { what: "working space", size: 36 }] });
  assert.equal(ats.status, "flag");
  assert.equal(ats.message, "Does not fit: ATS Room depth has 48 in. (4'-0\") and what is drawn needs 54 in., 6 in. short.");
  const shaft = checkSpaceRow({ id: "Shaft S-2", kind: "fit", of: "Shaft S-2 width", available: 30,
    parts: [{ what: "4 in. CHWS", size: 4.5, insulation: 1.5 }, { what: "4 in. CHWR", size: 4.5, insulation: 1.5 }, { what: "clearance between and at walls", size: 6 }] });
  assert.equal(shaft.status, "ok");
  assert.deepEqual([shaft.neededIn, shaft.marginIn], [21, 9]);
  assert.equal(checkSpaceRow({ id: "Pit", kind: "fit", parts: [{ what: "interceptor", size: 60 }] }).status, "cannot-check");
  assert.equal(checkSpaceRow({ id: "Pit", kind: "fit", available: 72 }).status, "cannot-check");
});

test("working space: NEC 110.26(A) depth by voltage to ground and condition", () => {
  assert.equal(voltsToGroundOf("480Y/277"), 277);
  assert.equal(voltsToGroundOf("208/120V"), 120);
  assert.equal(voltsToGroundOf("240"), 240);
  assert.equal(voltsToGroundOf("see riser"), null);
  // 120 V to ground: 3 ft whatever faces it.
  assert.equal(checkSpaceRow({ id: "LP-1", kind: "workingSpace", system: "208Y/120", depth: "3'-0\"" }).status, "ok");
  assert.equal(checkSpaceRow({ id: "LP-1", kind: "workingSpace", system: "208Y/120", depth: 30 }).status, "flag");
  // 277 V to ground: 3 ft, 3'-6" or 4 ft.
  const hp = { id: "HP-1", kind: "workingSpace", system: "480Y/277", depth: "3'-6\"" };
  assert.equal(checkSpaceRow({ ...hp, condition: 1 }).status, "ok");
  assert.equal(checkSpaceRow({ ...hp, condition: 2 }).status, "ok");
  const c3 = checkSpaceRow({ ...hp, condition: 3 });
  assert.equal(c3.status, "flag");
  assert.match(c3.message, /clear depth is 42 in\. and 151 to 600 V to ground, condition 3, needs 48 in\. \(4'-0"\)/);
  const open = checkSpaceRow(hp);
  assert.equal(open.status, "cannot-check", "between the condition 1 and condition 3 depths, the condition decides");
  assert.match(open.message, /depends on the condition/);
  assert.equal(checkSpaceRow({ ...hp, depth: 34 }).status, "flag", "below condition 1 fails under any condition");
  assert.equal(checkSpaceRow({ ...hp, depth: 48 }).status, "ok", "the condition 3 depth passes under any condition");
  assert.equal(checkSpaceRow({ id: "SWBD", kind: "workingSpace", voltsToGround: 277, depth: 48, condition: 3 }).status, "ok");
  assert.match(checkSpaceRow({ id: "MV", kind: "workingSpace", voltsToGround: 7200, depth: 60 }).message, /above 1000 V/);
  assert.match(checkSpaceRow({ id: "X", kind: "workingSpace", depth: 36 }).message, /no voltage to ground/);
});

test("working space: width, headroom, and a row with nothing to check", () => {
  const w = checkSpaceRow({ id: "MSB", kind: "workingSpace", width: 30, equipmentWidth: 36 });
  assert.equal(w.status, "flag");
  assert.match(w.message, /clear width is 30 in\. and needs 36 in\./);
  assert.equal(checkSpaceRow({ id: "P", kind: "workingSpace", width: 30, equipmentWidth: 20 }).status, "ok");
  assert.match(checkSpaceRow({ id: "P", kind: "workingSpace", headroom: "6'-0\"" }).message, /headroom is 72 in\. and needs 78 in\./);
  assert.equal(checkSpaceRow({ id: "P", kind: "workingSpace", headroom: "7'-0\"", equipmentHeight: 90 }).status, "flag");
  assert.equal(checkSpaceRow({ id: "P", kind: "workingSpace", system: "208/120" }).status, "cannot-check");
  // A failing width is still a flag when the depth is open.
  const both = checkSpaceRow({ id: "P", kind: "workingSpace", system: "480Y/277", depth: 42, width: 24 });
  assert.equal(both.status, "flag");
  assert.match(both.message, /Also: the depth of 42 in\. depends on the condition/);
});

test("a set of locations is summarized with what does not fit first", () => {
  const s = checkSpace({ rows: [
    { id: "Corridor", kind: "plenum", plenum: 16, stack: [{ what: "duct", depth: 20 }] },
    { id: "Rm 108", kind: "plenum", plenum: 16, stack: [{ what: "duct", depth: 15 }] },
    { id: "Lobby", kind: "plenum", plenum: 36, stack: [{ what: "duct", depth: 15 }] },
    { id: "Closet", kind: "fit", available: 48 },
    { id: "LP", kind: "workingSpace", system: "208Y/120", depth: 36 },
  ] });
  assert.deepEqual([s.checked, s.ok, s.tight, s.flagged, s.notChecked], [5, 2, 1, 1, 1]);
  assert.deepEqual(s.flags.map((f) => f.id), ["Corridor"]);
  assert.deepEqual(s.tightRows.map((f) => f.id), ["Rm 108"]);
  assert.equal(checkSpace({}).checked, 0);
  assert.equal(checkSpace({ rows: [{ id: "A", kind: "plenum", plenum: 16, stack: [{ what: "duct", depth: 12 }] }], tightIn: 6 }).tight, 1);
});

test("plenum: a beam below the deck, and a pass that is to the deck only", () => {
  // Tabler Unit Type 4 bathroom: plank at 9'-10", ceiling at 8'-0", a 10 in. return duct and a 1 in. pipe.
  const row = { id: "Unit Type 4 bathroom", kind: "plenum", structureBottomAff: "9'-10\"", ceilingHeight: "8'-0\"", stack: [{ what: "33x10 RA", depth: 10 }, { what: "1 in. CHW", depth: 1 }] };
  const deck = checkSpaceRow(row);
  assert.equal(deck.status, "ok");
  assert.equal(deck.toDeckOnly, true, "no beam depth: the pass is to the deck only");
  assert.match(deck.message, /Measured to the underside of the deck or slab only/);
  const beam = checkSpaceRow({ ...row, beamDepth: 16 });
  assert.equal(beam.status, "flag", "a 16 in. beam leaves 6 in. for 11");
  assert.deepEqual([beam.availableIn, beam.neededIn], [6, 11]);
  assert.match(beam.availableFrom, /less a 16 in\. beam below it/);
  assert.ok(!beam.toDeckOnly);
  const none = checkSpaceRow({ ...row, noBeam: true });
  assert.ok(!none.toDeckOnly && !/deck or slab only/.test(none.message), "the framing plan shows no beam here");
  assert.ok(!checkSpaceRow({ ...row, beamDepth: 0 }).toDeckOnly);
  assert.ok(!checkSpaceRow({ id: "A", kind: "plenum", plenum: 24, stack: [{ what: "duct", depth: 12 }] }).toDeckOnly, "a dimensioned plenum is already clear of structure");
  const ftf = checkSpaceRow({ id: "A", kind: "plenum", floorToFloor: 128, structureDepth: 10, ceilingHeight: 96, beamDepth: "1'-0\"", stack: [{ what: "duct", depth: 9 }] });
  assert.deepEqual([ftf.availableIn, ftf.status], [10, "tight"]);
  // A flag needs no caveat: it fails even to the deck.
  const short = checkSpaceRow({ ...row, ceilingHeight: "9'-4\"" });
  assert.equal(short.status, "flag");
  assert.ok(!/deck or slab only/.test(short.message));
  const s = checkSpace({ rows: [row, { ...row, noBeam: true }, short] });
  assert.equal(s.toDeckOnly, 1, "counted so the coverage can say how many passes are to the deck only");
  assert.equal(s.okRows[0].toDeckOnly, true);
});

test("fit: a corridor's width against what runs side by side in it", () => {
  // A 6 ft corridor: a 37 in. cassette fan coil, an 18 in. tray with 6 in. each side, a 12 in. duct and 4 in. mains.
  const c = checkSpaceRow({ id: "Link corridor at FCU-12", kind: "fit", of: "corridor clear width", available: "6'-0\"",
    parts: [{ what: "FCU-12 cassette", size: 37 }, { what: "18x3 tray", size: 18 }, { what: "tray clearance, both sides", size: 12 }, { what: "12x10 RA", size: 12 }] });
  assert.equal(c.status, "flag");
  assert.deepEqual([c.availableIn, c.neededIn, c.marginIn], [72, 79, -7]);
  assert.match(c.message, /corridor clear width has 72 in\./);
});

// Drift anchors: the tool, the checklist hints and the skill method exist together.
test("check_space_fit, the checklist hints and the skill method are in step", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('mcp.tool("check_space_fit"') && src.includes("checkSpace("));
  assert.ok(src.includes("SPACE_KINDS"));
  const sql = readFileSync(new URL("../../migrations/20261125100000_qa_space_fit_hints.sql", import.meta.url), "utf8");
  for (const id of ["qa-614", "qa-070"]) assert.ok(sql.includes(`where item_id = '${id}'`), id);
  assert.equal(sql.split("check_space_fit").length - 1 >= 4, true);
  assert.equal(sql.split("not like '%check_space_fit%'").length - 1, 2, "running it twice adds the hint once");
  assert.ok(!sql.includes("\r"), "migrations are LF");
  const skill = readFileSync(new URL("../../../.claude/skills/qa-coordination-review/SKILL.md", import.meta.url), "utf8");
  assert.ok(skill.includes("`check_space_fit`"));
  for (const k of SPACE_KINDS) assert.ok(skill.includes("`" + k + "`"), `skill does not name the ${k} kind`);
  for (const k of ["beamDepth", "noBeam"]) assert.ok(src.includes(k) && skill.includes("`" + k + "`"), k);
  assert.ok(/corridor[^.]*width/i.test(skill), "the skill asks for the corridor width sum");
  const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
  assert.ok(readme.includes("`check_space_fit`") && readme.includes("spaceCheck.js"));
});
