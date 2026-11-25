// Tests for controlsCoverage.js (check_controls_coverage, qa-633). Rows are
// shaped as pms_tag_controls_kinds returns them; the families are the ones
// the Tabler set returned on 2026-11-24.
//
//   node --test supabase/functions/pms-mcp/controlsCoverage.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { controlsCoverage, runs, PASSIVE, BMS_CONDITIONAL_PG } from "./controlsCoverage.js";

const row = (prefix, num, sched, controls, plans, extra) => ({
  tag_prefix: prefix, tag_num: num, sched_sheets: sched || null, controls_sheets: controls || null, plan_sheets: plans || null,
  sheet_count: 3, total_sheets: 195, controls_sheet_list: ["M801", "M802"], controls_words: ["FCU", "TYP", "BMS", "VFD"], ...(extra || {}),
});
const many = (prefix, from, to, sched, controls, plans) => Array.from({ length: to - from + 1 }, (_, i) => row(prefix, from + i, sched, controls, plans));
const tabler = [
  ...many("EUH", 1, 1, ["M601"], ["M801"], ["M201"]), ...many("EUH", 2, 3, ["M601"], null, ["M202"]),
  ...many("FCU", 1, 11, ["M601"], null, ["M201"]),
  ...many("RHC", 1, 8, ["M602"], null, ["M203"]),
  ...many("HWP", 1, 4, ["M601"], ["M802"], ["M101"]),
  ...many("RG", 1, 5, ["M601"], null, ["M201"]),
  ...many("GBSF", 25, 26, ["M602"], null, null),
  ...many("LCP", 1, 2, ["E612"], null, ["E201"]),
  row("STTQ", 1, ["M601"], ["M801"], ["M201"], { sheet_count: 192 }),
];

test("Tabler: families the controls sheets never mention, by type only, and partly", () => {
  const r = controlsCoverage(tabler);
  assert.deepEqual(r.notMentioned.map((f) => f.family), ["RHC"]);
  assert.equal(r.notMentioned[0].tags, "RHC-1 to 8");
  assert.match(r.notMentioned[0].message, /^8 RHC unit\(s\) are scheduled on M602 and drawn on plans, and no controls sheet mentions RHC\./);
  assert.deepEqual(r.byTypeOnly.map((f) => f.family), ["FCU"], "FCU is printed on a controls sheet with no number");
  assert.deepEqual(r.partlyShown.map((f) => [f.family, f.onControls, f.notOnControls]), [["EUH", "EUH-1", "EUH-2, 3"]]);
  assert.match(r.partlyShown[0].message, /EUH-1 is on M801; EUH-2, 3 are not\./);
  assert.deepEqual(r.allTagsOnControls, ["HWP"]);
  assert.deepEqual([r.flagged, r.familiesChecked], [1, 4]);
  assert.deepEqual(r.controlsSheets, ["M801", "M802"]);
});

test("what nothing controls, what is not mechanical, and what is not equipment are left out", () => {
  const all = JSON.stringify(controlsCoverage(tabler));
  for (const x of ['"RG"', "GBSF", "LCP", "STTQ"]) assert.ok(!all.includes(x), x);
  assert.ok(PASSIVE.has("RG") && PASSIVE.has("BFP") && !PASSIVE.has("P") && !PASSIVE.has("EUH"), "pumps tagged P are controlled");
});

test("the filters, tag runs, and no controls sheets at all", () => {
  assert.deepEqual(controlsCoverage(tabler, { families: ["rhc", "FCU-1"] }).familiesChecked, 2);
  assert.deepEqual(controlsCoverage(tabler, { ignore: ["RHC"] }).notMentioned, []);
  assert.equal(runs([5, 1, 2, 3, 9, 10]), "1 to 3, 5, 9, 10");
  const none = controlsCoverage(many("UH", 1, 3, ["M-601"], null, ["M-201"]).map((r) => ({ ...r, controls_sheet_list: null, controls_words: null })));
  assert.deepEqual([none.controlsSheets.length, none.notMentioned[0].family, none.notMentioned[0].scheduleSheets[0]], [0, "UH", "M-601"]);
  assert.equal(controlsCoverage([]).flagged, 0);
});

test("the tool, the database function and the checklist item are in step", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('mcp.tool("check_controls_coverage"') && src.includes('sbRpc("pms_tag_controls_kinds"') && src.includes("p_pattern: BMS_CONDITIONAL_PG"));
  const sql = readFileSync(new URL("../../migrations/20261125150000_qa_controls_coverage.sql", import.meta.url), "utf8");
  for (const col of ["tag_prefix text", "tag_num int", "sched_sheets text[]", "controls_sheets text[]", "plan_sheets text[]", "sheet_count bigint", "total_sheets bigint", "controls_sheet_list text[]", "controls_words text[]"]) assert.ok(sql.includes(col), col);
  assert.ok(sql.includes("grant execute on function public.pms_tag_controls_kinds(text, text, text, text[]) to service_role") && sql.includes("from anon"));
  assert.ok(sql.includes("where item_id = 'qa-633'") && sql.includes("check_controls_coverage"));
  assert.ok(!/\((?!\?:)/.test(BMS_CONDITIONAL_PG) && !BMS_CONDITIONAL_PG.includes("\\b"), "Postgres pattern: non-capturing groups and \\y");
});
