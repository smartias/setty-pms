// Tests for tagCoverage.js (check_tag_schedule_coverage, qa-622). The rows are
// shaped as pms_tag_sheet_kinds returns them; the first case is what the
// Tabler set returned on 2026-11-24, cut down.
//
//   node --test supabase/functions/pms-mcp/tagCoverage.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { tagCoverage } from "./tagCoverage.js";

const row = (prefix, num, sched, plans, other, spellings) => ({
  tag_prefix: prefix, tag_num: num, spellings: spellings || [`${prefix}-${num}`],
  sched_sheets: sched || null, plan_sheets: plans || null, other_sheets: other || null,
  total_sheets: 195, schedule_sheet_list: ["E601", "E602", "M601"], plan_sheet_count: 120,
});
const tabler = [
  row("UH", 1, ["M601"], ["M201"]), row("UH", 9, ["M601"]), row("UH", 10, ["M601"], null, ["M501"]), row("UH", 19, null, ["M406"]),
  row("EUH", 1, ["E602"], ["E201"]), row("EUH", 4, ["E602"]), row("EUH", 5, ["E602"]),
  row("RTU", 1, null, ["M219"]), row("RTU", 2, null, ["M214"]),
  row("NEC", 110, null, ["E401"]), row("NEC", 420, null, ["E401", "E402"]),
  row("M", 601, null, ["M215", "M220"]), row("M", 3, null, ["M002"], null, ["M-003"]),
  row("RFI", 59, null, ["E221"]), row("RFI", 144, ["E610"]),
  row("GBSF", 25, ["M602"], null, null, ["GBSF-025"]), row("GBSF", 40, ["M602"], null, null, ["GBSF-040"]),
  { ...row("STTQ", 1, ["E601", "M601"], Array.from({ length: 12 }, (_, i) => "X" + i), Array.from({ length: 12 }, (_, i) => "Y" + i)), sheet_count: 192 },
  row("DOAS", 1, ["E607"], ["M210"], null, ["DOAS-01", "DOAS-1"]),
  row("HH", 1, null, ["ES101"]),
];

test("Tabler: what is drawn and not scheduled, and scheduled and not drawn", () => {
  const r = tagCoverage(tabler);
  assert.deepEqual(r.notScheduled.map((t) => t.tag), ["UH-19"]);
  assert.equal(r.notScheduled[0].message, "UH-19 is on M406 and on no schedule sheet. 3 other UH tag(s) are scheduled.");
  assert.deepEqual(r.notOnPlans.map((t) => t.tag), ["UH-9", "UH-10", "EUH-4", "EUH-5"]);
  assert.match(r.notOnPlans[1].message, /UH-10 is scheduled on M601 and on no plan \(it is on M501\)\./);
  assert.equal(r.flagged, 5);
  assert.deepEqual(r.familiesChecked, ["DOAS", "EUH", "UH"]);
  assert.deepEqual(r.scheduleSheets, ["E601", "E602", "M601"]);
});

test("things shaped like a tag that are not equipment are left out", () => {
  const r = tagCoverage(tabler);
  const everything = JSON.stringify(r);
  for (const noise of ["NEC-", "RFI-", "M-601", "GBSF-", "STTQ-"]) assert.ok(!everything.includes(noise), noise);
  assert.deepEqual(r.familiesNotScheduled.map((f) => f.prefix), ["RTU"], "a family on two plan sheets, never scheduled; HH is on one sheet only, and NEC, M and RFI are not equipment");
  assert.equal(r.familiesNotScheduled[0].message, "2 RTU tag(s) are on 2 plan sheet(s) and none is on a schedule sheet.");
  assert.deepEqual(r.writtenTwoWays, [{ tag: "DOAS-1", spellings: ["DOAS-01", "DOAS-1"] }]);
});

test("a sheet-letter prefix is a tag when it is not written as a sheet number", () => {
  const rows = [row("P", 1, ["P601"], ["P201"]), row("P", 2, null, ["P201"]), row("P", 601, null, ["P201"], null, ["P-601"]), row("M", 6, ["M601"], ["M201"])];
  const r = tagCoverage(rows);
  assert.deepEqual(r.notScheduled.map((t) => t.tag), ["P-2"], "P-601 is a sheet reference; P-2 is a pump or fixture");
  assert.deepEqual(r.familiesChecked, ["M", "P"]);
});

test("the families filter, and nothing to check", () => {
  assert.deepEqual(tagCoverage(tabler, { families: ["euh"] }).notOnPlans.map((t) => t.tag), ["EUH-4", "EUH-5"]);
  const empty = tagCoverage([]);
  assert.deepEqual([empty.flagged, empty.sheetsRead, empty.scheduleSheets.length], [0, 0, 0]);
});

test("the tool, the database function and the checklist item are in step", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('mcp.tool("check_tag_schedule_coverage"') && src.includes('sbRpc("pms_tag_sheet_kinds"') && src.includes("tagCoverage(rows"));
  const sql = readFileSync(new URL("../../migrations/20261125130000_qa_tag_schedule_coverage.sql", import.meta.url), "utf8");
  for (const col of ["tag_prefix text", "tag_num int", "spellings text[]", "sched_sheets text[]", "plan_sheets text[]", "other_sheets text[]", "sheet_count bigint", "total_sheets bigint", "schedule_sheet_list text[]", "plan_sheet_count bigint"]) assert.ok(sql.includes(col), col);
  assert.ok(sql.includes("grant execute on function public.pms_tag_sheet_kinds(text, text, text, text[]) to service_role") && sql.includes("from anon"));
  assert.ok(sql.includes("where item_id = 'qa-622'") && sql.includes("check_tag_schedule_coverage"));
});
