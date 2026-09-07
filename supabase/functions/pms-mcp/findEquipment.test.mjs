// Tests for find_equipment's pure helpers in index.ts (equipment tag registry).
//
//   node supabase/functions/pms-mcp/findEquipment.test.mjs
//
// The helpers are COPIED below (index.ts boots a server at import). Drift
// anchors at the bottom fail if the shipped source stops matching.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── copies from index.ts ────────────────────────────────────────────────────
const EQUIP_SHEETLIKE_RE = /^(A|E|EL|FA|FP|G|H|I|M|P|S|SP|T)-\d{3}$/;
const EQUIP_BOILERPLATE_RATIO = 0.6;
const EQUIP_MIN_SHEETS_FOR_RATIO = 12;

function equipmentNoiseFilter(tags, totalSheets) {
  return tags.filter((t) =>
    !EQUIP_SHEETLIKE_RE.test(String(t.tag)) &&
    !(totalSheets >= EQUIP_MIN_SHEETS_FOR_RATIO && Number(t.sheets) >= totalSheets * EQUIP_BOILERPLATE_RATIO));
}

// Sheet-number lookalikes are dropped; real tags survive. F-6 (a fan, one
// digit) and FCU-102 (four-letter prefix) are NOT sheet-shaped.
{
  const kept = equipmentNoiseFilter([
    { tag: "FCU-11", sheets: 23 },
    { tag: "M-501", sheets: 4 },
    { tag: "E-211", sheets: 3 },
    { tag: "FP-102", sheets: 3 },
    { tag: "F-6", sheets: 15 },
    { tag: "FCU-102", sheets: 5 },
    { tag: "EL-201", sheets: 2 },
  ], 192);
  assert.deepEqual(kept.map((t) => t.tag), ["FCU-11", "F-6", "FCU-102"]);
}

// Title-block boilerplate: a "tag" on most of the set's sheets is the title
// block, not equipment (the live case: STTQ-01 on all 192 Tabler sheets).
// Legit heavily-used tags (38 of 192 sheets) stay.
{
  const kept = equipmentNoiseFilter([
    { tag: "STTQ-01", sheets: 192 },
    { tag: "FCU-3", sheets: 38 },
    { tag: "CAV-1", sheets: 7 },
  ], 192);
  assert.deepEqual(kept.map((t) => t.tag), ["FCU-3", "CAV-1"]);
}

// Small projects skip the ratio gate entirely: with 8 indexed sheets a tag on
// 6 of them is normal, not boilerplate.
{
  const kept = equipmentNoiseFilter([{ tag: "AHU-1", sheets: 6 }], 8);
  assert.deepEqual(kept.map((t) => t.tag), ["AHU-1"]);
}

// The word-bounded CA-record pattern: FCU-11 must match "FCU-11" and
// "FCU 11" but never FCU-110 (the pattern shape used by the tool, built from
// drawingQueryPatterns' output).
{
  const pattern = "FCU[-\\s]?11";
  const re = new RegExp(`\\b(?:${pattern})\\b`, "i");
  assert.ok(re.test("Approved FCU-11 submittal"));
  assert.ok(re.test("fcu 11 coil"));
  assert.equal(re.test("FCU-110 replacement"), false);
}

// ── drift anchors ───────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf8");
for (const anchor of [
  'mcp.tool("find_equipment"',
  "const EQUIP_BOILERPLATE_RATIO = 0.6;",
  "const EQUIP_MIN_SHEETS_FOR_RATIO = 12;",
  "function equipmentNoiseFilter",
  // The enumeration RPC and its total_sheets column (boilerplate baseline).
  'sbRpc("pms_equipment_tags"',
  "rows[0]?.total_sheets",
  // Word-bounded CA matching — FCU-11 never matches FCU-110.
  "new RegExp(`\\\\b(?:${patterns.join(\"|\")})\\\\b`, \"i\")",
] ) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}
const migration = readFileSync(join(here, "../../migrations/20260907000000_equipment_tags.sql"), "utf8");
for (const anchor of ["pms_equipment_tags", "total_sheets", "grant execute on function public.pms_equipment_tags(text, int) to service_role;"]) {
  assert.ok(migration.includes(anchor), `migration lost anchor: ${anchor}`);
}

console.log("findEquipment.test.mjs: all assertions passed");
