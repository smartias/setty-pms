// Multi-discipline knowledge entries (SettyIntelligence.html v38 + migration
// 20261105120000_knowledge_disciplines.sql). Pins the rules the editors and the
// database rely on. The editors were also driven end to end in headless
// Chromium against the real page with Supabase mocked (16 checks) when written.
//
//   node --test knowledgeDisciplines.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── copies from SettyIntelligence.html ──────────────────────────────────────
function knowledgeDisciplines(p) {
  if (Array.isArray(p.disciplines) && p.disciplines.length) return p.disciplines;
  return p.discipline ? [p.discipline] : [];
}
const DISCIPLINES = ["Mechanical","Electrical","Plumbing","Fire Protection","Structural","Architectural","Civil","Technology/Telecom","Commissioning","General"];
// readDisciplineCheckboxes without the DOM: `checked` is what the boxes return.
function orderDisciplines(checked, current) {
  const extra = current.filter(d => !DISCIPLINES.includes(d));
  const all = [...checked, ...extra];
  const primary = current[0];
  return primary && all.includes(primary) ? [primary, ...all.filter(d => d !== primary)] : all;
}

test("rows from before the column existed fall back to the single discipline", () => {
  assert.deepEqual(knowledgeDisciplines({ discipline: "Electrical" }), ["Electrical"]);
  assert.deepEqual(knowledgeDisciplines({ discipline: "Electrical", disciplines: [] }), ["Electrical"]);
  assert.deepEqual(knowledgeDisciplines({ discipline: null }), []);
  assert.deepEqual(knowledgeDisciplines({ discipline: "Mechanical", disciplines: ["Mechanical", "Plumbing"] }), ["Mechanical", "Plumbing"]);
});

test("ticking an extra trade keeps the existing primary first", () => {
  // Plumbing comes before Fire Protection in the list, Mechanical is the primary.
  assert.deepEqual(orderDisciplines(["Mechanical", "Plumbing", "Fire Protection"], ["Mechanical"]),
    ["Mechanical", "Plumbing", "Fire Protection"]);
  assert.deepEqual(orderDisciplines(["Mechanical", "Plumbing"], ["Plumbing"]), ["Plumbing", "Mechanical"]);
});

test("unticking the primary promotes the next trade; clearing all gives none", () => {
  assert.deepEqual(orderDisciplines(["Plumbing", "Fire Protection"], ["Mechanical"]), ["Plumbing", "Fire Protection"]);
  assert.deepEqual(orderDisciplines([], ["Mechanical"]), []);
});

test("non-standard trades already on an entry are kept, never silently dropped", () => {
  assert.deepEqual(orderDisciplines(["Electrical"], ["Elevators", "Electrical"]), ["Elevators", "Electrical"]);
});

test("shipped page still contains the tested logic and wiring", () => {
  const page = readFileSync(new URL("./SettyIntelligence.html", import.meta.url), "utf8");
  const has = (needle, label) => assert.ok(page.includes(needle), `${label} has DRIFTED from this test's copy`);
  has("if (Array.isArray(p.disciplines) && p.disciplines.length) return p.disciplines;", "knowledgeDisciplines");
  has("return primary && all.includes(primary) ? [primary, ...all.filter(d => d !== primary)] : all;", "primary-first ordering");
  has('if (!("disciplines" in payload) || !/disciplines/.test(String(e.message))) throw e;', "save fallback before the column is live");
  // Every editor uses the shared trade picker and a Status menu.
  for (const [id, label] of [["bp_status", "Best Practices"], ["f_status", "Project Knowledge"], ["sf_status", "Engineering Standards"]])
    has(`statusSelectHTML("${id}"`, `${label} Status menu`);
  // Calls, not the definition (`disciplineFieldsetHTML(current)`).
  assert.equal((page.match(/disciplineFieldsetHTML\((?!current\))/g) || []).length, 3, "trade picker in all three editors");
  // Filters match ANY trade, not just the primary.
  assert.equal((page.match(/!knowledgeDisciplines\([lpr]\)\.includes\(f\.discipline\)/g) || []).length, 3, "practice, lesson and standard filters match any trade");
});

test("migration keeps its safety properties", () => {
  const mig = readFileSync(new URL("./supabase/migrations/20261105120000_knowledge_disciplines.sql", import.meta.url), "utf8");
  for (const t of ["pms_lessons", "pms_best_practices", "pms_agency_preferences", "pms_engineering_standards"])
    assert.ok(mig.includes(`alter table public.${t}`) && mig.includes(`'${t}'`), `${t} gets the column and the trigger`);
  // Backfill runs before the trigger is created, so existing `discipline` values are not rewritten.
  assert.ok(mig.indexOf("set disciplines = public.pms_split_disciplines(discipline)") < mig.indexOf("create trigger pms_knowledge_disciplines"),
    "backfill happens before the trigger exists");
  // A single-column writer replaces only the primary trade.
  assert.ok(mig.includes("|| array_remove(coalesce(old.disciplines, '{}'::text[]), old.discipline);"), "other trades kept on a primary-only rewrite");
  // Trigger name sorts before pms_norm_discipline so it runs first.
  assert.ok("pms_knowledge_disciplines" < "pms_norm_discipline");
});
