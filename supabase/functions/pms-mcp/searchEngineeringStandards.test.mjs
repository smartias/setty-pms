// Tests for search_engineering_standards' filtering in index.ts.
//   node supabase/functions/pms-mcp/searchEngineeringStandards.test.mjs
// The function is COPIED below (index.ts boots a server at import); a drift
// check at the bottom fails if index.ts changes it.
import { readFileSync } from "node:fs";

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

function filterEngineeringStandards(rows, f) {
  const has = (v, needle) => String(v ?? "").toLowerCase().includes(needle);
  // 'suggested' is a review queue, never served (same rule as search_knowledge).
  let out = rows.filter((r) => r.status !== "suggested");
  if (!f.includeArchived) out = out.filter((r) => r.status !== "archived");
  if (f.discipline) { const d = f.discipline.toLowerCase().trim(); out = out.filter((r) => has(r.discipline, d)); }
  if (f.system) { const s = f.system.toLowerCase().trim(); out = out.filter((r) => has(r.system, s)); }
  if (f.query) {
    const q = f.query.toLowerCase().trim();
    out = out.filter((r) =>
      [r.standard_text, r.discipline, r.system, r.basis, r.source_reference]
        .some((v) => has(v, q)));
  }
  return out;
}

const ROWS = [
  { standard_id: "1", discipline: "Mechanical", system: "Chilled water", standard_text: "Design CHW delta-T of 14F minimum.", basis: "Plant efficiency", source_reference: "ASHRAE 90.1", status: "active" },
  { standard_id: "2", discipline: "Electrical", system: "Emergency power", standard_text: "Size generators for 80% continuous load.", basis: null, source_reference: "NEC 700", status: "active" },
  { standard_id: "3", discipline: "Mechanical", system: null, standard_text: "Old rule.", basis: null, source_reference: null, status: "archived" },
  { standard_id: "5", discipline: "Mechanical", system: "Ductwork", standard_text: "Queued.", basis: null, source_reference: null, status: "suggested" },
  { standard_id: "4", discipline: null, system: null, standard_text: "General note", basis: null, source_reference: null, status: null },
];

check(filterEngineeringStandards(ROWS, {}).length === 3, "archived and suggested hidden by default, null status kept");
check(filterEngineeringStandards(ROWS, { includeArchived: true }).length === 4, "includeArchived adds archived but never suggested");
check(!filterEngineeringStandards(ROWS, { includeArchived: true, query: "queued" }).length, "suggested row not served even when matched");
check(filterEngineeringStandards(ROWS, { discipline: "mech" }).length === 1, "discipline substring, archived excluded");
check(filterEngineeringStandards(ROWS, { system: "EMERGENCY" })[0]?.standard_id === "2", "system case-insensitive");
check(filterEngineeringStandards(ROWS, { query: "nec 700" })[0]?.standard_id === "2", "query matches source_reference");
check(filterEngineeringStandards(ROWS, { query: "plant efficiency" })[0]?.standard_id === "1", "query matches basis");
check(filterEngineeringStandards(ROWS, { query: "zzz" }).length === 0, "no match");

const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
check(src.includes('mcp.tool("search_engineering_standards"'), "tool registered in index.ts");
check(src.includes('let out = rows.filter((r: any) => r.status !== "suggested");'), "drift: suggested rule");
check(src.includes('if (!f.includeArchived) out = out.filter((r: any) => r.status !== "archived");'), "drift: archived rule");
check(src.includes("[r.standard_text, r.discipline, r.system, r.basis, r.source_reference]"), "drift: query fields");

if (failures) { console.error(`${failures}/${total} failed`); process.exit(1); }
console.log(`ok ${total}`);
