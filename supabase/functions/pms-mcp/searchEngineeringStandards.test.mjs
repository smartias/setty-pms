// Tests for search_engineering_standards' filtering in index.ts.
//   node supabase/functions/pms-mcp/searchEngineeringStandards.test.mjs
// The function is COPIED below (index.ts boots a server at import); a drift
// check at the bottom fails if index.ts changes it.
import { readFileSync } from "node:fs";

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

function filterEngineeringStandards(rows, f) {
  const has = (v, needle) => String(v ?? "").toLowerCase().includes(needle);
  const served = f.includeArchived ? ["active", "superseded"] : ["active"];
  let out = rows.filter((r) => served.includes(r.status));
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
  { standard_id: "3", discipline: "Mechanical", system: null, standard_text: "Old rule.", basis: null, source_reference: null, status: "superseded" },
  { standard_id: "4", discipline: null, system: null, standard_text: "General note", basis: null, source_reference: null, status: null },
  { standard_id: "5", discipline: "Mechanical", system: "Ductwork", standard_text: "Unreviewed mined rule.", basis: null, source_reference: null, status: "suggested" },
];

check(filterEngineeringStandards(ROWS, {}).length === 2, "only active served by default (superseded, suggested, null hidden)");
check(filterEngineeringStandards(ROWS, { includeArchived: true }).length === 3, "includeArchived adds superseded but never suggested");
check(filterEngineeringStandards(ROWS, { discipline: "mech" }).length === 1, "discipline substring, archived excluded");
check(filterEngineeringStandards(ROWS, { system: "EMERGENCY" })[0]?.standard_id === "2", "system case-insensitive");
check(filterEngineeringStandards(ROWS, { query: "nec 700" })[0]?.standard_id === "2", "query matches source_reference");
check(filterEngineeringStandards(ROWS, { query: "plant efficiency" })[0]?.standard_id === "1", "query matches basis");
check(filterEngineeringStandards(ROWS, { query: "zzz" }).length === 0, "no match");

const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
check(src.includes('mcp.tool("search_engineering_standards"'), "tool registered in index.ts");
check(src.includes('const served = f.includeArchived ? ["active", "superseded"] : ["active"];') && src.includes("let out = rows.filter((r: any) => served.includes(r.status));"), "drift: status rule");
check(src.includes("[r.standard_text, r.discipline, r.system, r.basis, r.source_reference]"), "drift: query fields");

if (failures) { console.error(`${failures}/${total} failed`); process.exit(1); }
console.log(`ok ${total}`);
