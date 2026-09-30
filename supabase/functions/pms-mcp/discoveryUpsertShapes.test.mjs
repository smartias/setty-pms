// 2026-09-19: the drive-discovery scanner's pms_project_candidates upsert
// mixed rows from two shapes into one PostgREST bulk-upsert POST — "close as
// created" rows carry status/last_seen but not the pms_match_*/year/siblings
// columns a fresh/re-seen candidate carries, and name_from_folder is only on
// SOME of those. PostgREST builds one INSERT's column list from the whole
// POST body, so it needs every object in a batch to share the same key set;
// mixing shapes got the batch rejected outright once a large scan (reported
// against a 10TB+ W: drive scan) produced both in the same 200-row chunk.
//
// The fix groups rows by exact key set before chunking, so a POST body never
// mixes shapes — it changes nothing about what gets written, only how rows
// are split across requests. See index.ts, the loop right after the
// discovery handler's `rows.push(row)` sites.
//
//   node supabase/functions/pms-mcp/discoveryUpsertShapes.test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

// ── copied from index.ts (pure logic; index.ts boots a server at import) ────
function groupByShape(rows) {
  const shapeGroups = new Map();
  for (const row of rows) {
    const shape = Object.keys(row).sort().join(",");
    if (!shapeGroups.has(shape)) shapeGroups.set(shape, []);
    shapeGroups.get(shape).push(row);
  }
  return [...shapeGroups.values()];
}

// ── 1. Grouping never mixes shapes, never drops or reorders content ────────
const closedRow = { project_number: "SAPX256010.00", team: "NY", share_label: "W", drive_path: "W:/SAPX256010.00", folder_name: "SAPX256010.00", status: "created", last_seen: "2026-09-18T00:00:00Z" };
const freshRowNoName = { project_number: "SAPX256011.00", team: "NY", share_label: "W", drive_path: "W:/SAPX256011.00", folder_name: "SAPX256011.00", year: "2026", last_seen: "2026-09-18T00:00:00Z", pms_match_number: null, pms_match_name: null, pms_match_id: null, pms_match_kind: null, siblings: null };
const freshRowWithName = { ...freshRowNoName, project_number: "SAPX256012.00", name_from_folder: "Tabler" };

const groups = groupByShape([closedRow, freshRowNoName, freshRowWithName, closedRow]);
check(groups.length === 3, "three distinct shapes produce three groups, not one mixed batch");
check(groups.every((g) => {
  const keys = Object.keys(g[0]).sort().join(",");
  return g.every((r) => Object.keys(r).sort().join(",") === keys);
}), "every row within a group shares the exact same key set");
const flat = groups.flat();
check(flat.length === 4, "no row is dropped or duplicated by grouping");
check(flat.filter((r) => r === closedRow).length === 2, "grouping preserves every occurrence, including a repeated row");

// ── 2. A single-shape batch (the common case) still yields exactly one group ─
const allFresh = [freshRowNoName, { ...freshRowNoName, project_number: "SAPX256013.00" }];
check(groupByShape(allFresh).length === 1, "a batch that's already homogeneous isn't needlessly split");

// ── 3. Grouping must not silently null-fill `status` (that would revert a
//    human-dismissed candidate back to "new" on the next re-scan) ──────────
check(!("status" in freshRowNoName), "a fresh/re-seen candidate row never carries an explicit status — grouping must not add one");

// ── 4. Drift checks against the shipped source ──────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const shipped = readFileSync(join(here, "index.ts"), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has("const shapeGroups = new Map<string, Record<string, unknown>[]>();", "the shape-grouping map exists");
has('const shape = Object.keys(row).sort().join(",");', "rows are grouped by their exact key set");
has("for (const group of shapeGroups.values()) {\n    for (let i = 0; i < group.length; i += 200) await sbUpsert(", "each shape group is chunked and upserted separately, never mixed");
check(!/for \(let i = 0; i < rows\.length; i \+= 200\) await sbUpsert\(/.test(shipped),
  "the old ungrouped chunking loop (straight over `rows`) must not come back");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);
