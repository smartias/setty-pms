// Tests for scheduleArithmetic.js: whether the numbers on a schedule row agree
// with each other. Cases are the RFIs the check is for, and good rows that
// must NOT be flagged.
//
//   node --test supabase/functions/pms-mcp/scheduleArithmetic.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { checkRow, checkSchedule, duplicateModels, systemVoltages, ROW_KINDS, DEFAULT_TOLERANCE_PCT } from "./scheduleArithmetic.js";

test("air heating: capacity against airflow and temperature rise", () => {
  // 2,000 cfm raised 50 F is 108 MBH.
  const ok = checkRow({ id: "AHU-1", kind: "airHeating", cfm: 2000, eatF: 55, latF: 105, mbh: 110 });
  assert.equal(ok.status, "ok");
  assert.equal(ok.expected, 108);
  const bad = checkRow({ id: "MAU-1", kind: "airHeating", cfm: 1700, eatF: 10, latF: 55, kw: 42 });
  assert.equal(bad.status, "flag", "42 kW is 143 MBH; 1,700 cfm through 45 F needs 83");
  assert.deepEqual([bad.given, bad.expected, bad.unit], [143.3, 82.6, "MBH"]);
  assert.match(bad.message, /Scheduled 143.3 MBH, but 1.08 x 1700 cfm x 45 F gives 82.6 MBH/);
  assert.equal(checkRow({ id: "UH-1", kind: "airHeating", cfm: 500, deltaTF: 40, btuh: 21600 }).status, "ok", "BTU/h and a stated rise");
  assert.equal(checkRow({ id: "UH-2", kind: "airHeating", cfm: 500, mbh: 20 }).status, "cannot-check", "no temperatures: not guessed");
});

test("cooling and hydronic rows", () => {
  assert.equal(checkRow({ id: "FCU-1", kind: "airSensibleCooling", cfm: 800, eatF: 75, latF: 55, mbh: 17.3 }).status, "ok");
  assert.equal(checkRow({ id: "AHU-2", kind: "airTotalCooling", cfm: 10000, enteringH: 31.5, leavingH: 22.5, tons: 33.75 }).status, "ok", "4.5 x 10,000 x 9 = 405 MBH = 33.75 tons");
  assert.equal(checkRow({ id: "AHU-3", kind: "airTotalCooling", cfm: 10000, enteringH: 31.5, leavingH: 22.5, tons: 20 }).status, "flag");
  // 2.25 gpm through 20 F is 22.5 MBH.
  assert.equal(checkRow({ id: "FTR-1", kind: "hydronic", gpm: 2.25, ewtF: 180, lwtF: 160, mbh: 22.5 }).status, "ok");
  const ftr = checkRow({ id: "FTR-2", kind: "hydronic", gpm: 12, ewtF: 180, lwtF: 160, mbh: 22.5 });
  assert.equal(ftr.status, "flag", "the flow is the riser's, not the radiator's");
  assert.equal(ftr.expected, 120);
  assert.equal(checkRow({ id: "HX-1", kind: "hydronic", gpm: 100, deltaTF: 10, mbh: 460, fluidFactor: 460 }).status, "ok", "glycol factor");
});

test("kW against MBH is held to 5% whatever the tolerance", () => {
  assert.equal(checkRow({ id: "EUH-1", kind: "kwMbh", kw: 5, mbh: 17.1 }).status, "ok");
  assert.equal(checkRow({ id: "EUH-2", kind: "kwMbh", kw: 5, mbh: 18.5 }, 30).status, "flag");
});

test("electrical load, overcurrent and voltage", () => {
  // 42 kW at 480 V three-phase is 50.5 A.
  assert.equal(checkRow({ id: "MAU-1", kind: "electricalLoad", kw: 42, volts: 480, phase: 3, amps: 50.5 }).status, "ok");
  assert.equal(checkRow({ id: "MAU-1", kind: "electricalLoad", kw: 42, volts: 208, phase: 3, amps: 50.5 }).status, "flag", "the amps were worked at another voltage");
  assert.equal(checkRow({ id: "EWH-1", kind: "electricalLoad", kw: 4.5, volts: 240, phase: 1, amps: 18.8 }).status, "ok");
  assert.equal(checkRow({ id: "T-1", kind: "electricalLoad", kva: 15, volts: 208, phase: 3, amps: 41.6 }).status, "ok");
  assert.equal(checkRow({ id: "X", kind: "electricalLoad", kw: 4.5, volts: 240, amps: 18.8 }).status, "cannot-check", "no phase given");

  assert.equal(checkRow({ id: "CU-1", kind: "overcurrent", mca: 32, mocp: 50, breaker: 40 }).status, "ok");
  assert.match(checkRow({ id: "CU-2", kind: "overcurrent", mca: 32, mocp: 50, breaker: 30 }).message, /below the unit's minimum circuit ampacity of 32 A/);
  assert.match(checkRow({ id: "CU-3", kind: "overcurrent", mca: 32, mocp: 50, breaker: 60 }).message, /above the unit's maximum overcurrent protection of 50 A/);
  assert.match(checkRow({ id: "CU-4", kind: "overcurrent", mca: 60, mocp: 50, breaker: 50 }).message, /copied wrong/);

  assert.deepEqual(systemVoltages("480Y/277V"), [480, 277]);
  assert.deepEqual(systemVoltages("208/120"), [208, 120]);
  assert.equal(checkRow({ id: "P-1", kind: "voltage", volts: 460, phase: 3, sourceSystem: "480Y/277", sourcePhase: 3 }).status, "ok", "460 V is a 480 V system");
  assert.equal(checkRow({ id: "FCU-1", kind: "voltage", volts: 115, sourceSystem: "208Y/120" }).status, "ok");
  const lp = checkRow({ id: "LP", kind: "voltage", volts: 208, sourceSystem: "480/277", source: "MSB" });
  assert.equal(lp.status, "flag");
  assert.match(lp.message, /the equipment is 208 V and its source MSB is a 480\/277 system/);
  assert.match(checkRow({ id: "P-2", kind: "voltage", volts: 208, phase: 3, sourceSystem: "120/240", sourcePhase: 1 }).message, /three-phase and its source is single-phase/);
});

test("a count against a capacity", () => {
  const z = checkRow({ id: "Lobby", kind: "capacity", count: 6, capacity: 4, what: "lighting zones", of: "the room controller" });
  assert.equal(z.status, "flag");
  assert.equal(z.message, "6 lighting zones are shown and the room controller takes 4.");
  assert.equal(checkRow({ id: "FB-1", kind: "capacity", count: 3, capacity: 4, what: "devices" }).status, "ok");
});

test("the same model under tags that describe different things", () => {
  const d = duplicateModels([
    { tag: "F-7", model: "Elkay SS81302", description: "Utility sink" },
    { tag: "F-9", model: "ELKAY  SS81302", description: "Pantry sink" },
    { tag: "F-1", model: "Kohler K-1", description: "Lavatory" },
    { tag: "F-2", model: "Kohler K-1", description: "Lavatory" },
    { tag: "F-3", model: "TBD", description: "Sink" }, { tag: "F-4", model: "TBD", description: "Shower" },
  ]);
  assert.equal(d.length, 1, "identical rows and placeholders are not flagged");
  assert.deepEqual(d[0].tags, ["F-7", "F-9"]);
  assert.match(d[0].message, /F-7 and F-9 are scheduled as different things with the same model number Elkay SS81302/);
});

test("a schedule is summarized with its flags first, and nothing is guessed", () => {
  const s = checkSchedule({ rows: [
    { id: "AHU-1", kind: "airHeating", cfm: 2000, eatF: 55, latF: 105, mbh: 110 },
    { id: "MAU-1", kind: "airHeating", cfm: 1700, eatF: 10, latF: 55, kw: 42 },
    { id: "UH-2", kind: "airHeating", cfm: 500, mbh: 20 },
    { id: "Z", kind: "nope" },
  ], models: [{ tag: "F-7", model: "SS81302", description: "Utility sink" }, { tag: "F-9", model: "SS81302", description: "Pantry sink" }] });
  assert.deepEqual([s.checked, s.ok, s.flagged, s.notChecked], [4, 1, 2, 2]);
  assert.deepEqual(s.flags.map((f) => f.id), ["MAU-1", "F-7, F-9"]);
  assert.equal(s.notCheckedRows.length, 2);
  assert.equal(DEFAULT_TOLERANCE_PCT, 15);
  assert.equal(checkRow({ id: "A", kind: "airHeating", cfm: 2000, eatF: 55, latF: 105, mbh: 120 }).status, "ok", "11% is inside the default tolerance");
  assert.equal(checkRow({ id: "A", kind: "airHeating", cfm: 2000, eatF: 55, latF: 105, mbh: 120 }, 5).status, "flag");
});

// Drift anchors: the tool, the checklist item and the skill method exist together.
test("check_schedule_arithmetic, qa-638 and the skill method are in step", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('mcp.tool("check_schedule_arithmetic"') && src.includes("checkSchedule("));
  const sql = readFileSync(new URL("../../migrations/20261124200000_qa_schedule_arithmetic_item.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("('qa-638','deliverable-qa','RFI History',1880,"));
  assert.ok(sql.includes("check_schedule_arithmetic") && sql.includes("on conflict (item_id) do nothing;"));
  assert.ok(/\n 'auto',\n/.test(sql));
  const skill = readFileSync(new URL("../../../.claude/skills/qa-coordination-review/SKILL.md", import.meta.url), "utf8");
  assert.ok(skill.includes("**qa-638 ") && skill.includes("`check_schedule_arithmetic`"));
  for (const k of ROW_KINDS) assert.ok(src.includes('"' + k + '"') || src.includes("ROW_KINDS"), k);
});
