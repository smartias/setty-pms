// Tests for the 2026-09-24 fix in index.ts: a SharePoint folder named by hand
// (or a field-photo session logged before the PMS made it consistent) often
// drops the default ".00" phase suffix that a project's canonical number
// carries ("SAPX266021 - St. Nicholas..." vs. PMS's "SAPX266021.00"). A plain
// startsWith()/includes() then never matches, so list_project_documents and
// search_field_photos both reported real folders/sessions as missing — live
// repro was SAPX266021.00 (a genuine PMS project): its SharePoint folder and
// 5 field-photo sessions all carry the number without ".00".
//
//   node supabase/functions/pms-mcp/projectNumberSuffix.test.mjs
//
// The functions are COPIED below, same reason as the other pms-mcp tests:
// index.ts boots a server at import. Drift checks at the bottom.

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };
const eq = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);

// ── copies from index.ts ────────────────────────────────────────────────────
function numberPrefixMatches(value, numPrefix) {
  const name = String(value || "").toLowerCase();
  const num = String(numPrefix || "").toLowerCase().trim();
  if (!num) return false;
  if (name.startsWith(num)) return true;
  if (!num.endsWith(".00")) return false;
  const base = num.slice(0, -3);
  if (!base || !name.startsWith(base)) return false;
  return !/^[.\d]/.test(name.slice(base.length));
}

function filterSessionsByProject(rows, project) {
  const has = (v, needle) => String(v ?? "").toLowerCase().includes(needle);
  const pq = project.toLowerCase().trim();
  return rows.filter((r) =>
    has(r.project_number, pq) || has(r.project_name, pq) || numberPrefixMatches(r.project_number, pq));
}

// ── 1. numberPrefixMatches: the SharePoint folder-by-number scan, and the
//       search_field_photos project_number filter, share this matcher ──────
check(numberPrefixMatches("SAPX266021 - St. Nicholas of Tolentine Feasibility Study", "SAPX266021.00"),
  "a folder missing the default .00 phase suffix still matches the PMS number");
check(numberPrefixMatches("sapx266021.00 - tolentine", "SAPX266021.00"),
  "an exact prefix still matches (unchanged behavior)");
check(!numberPrefixMatches("SAPX266021.01 - Tolentine Ph2", "SAPX266021.00"),
  "a REAL phase suffix (.01) is never conflated with the default .00");
check(!numberPrefixMatches("SAPX2660210 - Some Other Job", "SAPX266021.00"),
  "a longer, different project number is not matched by the base substring");
check(!numberPrefixMatches("SAPX266099 - Unrelated", "SAPX266021.00"),
  "an unrelated folder never matches");
check(!numberPrefixMatches("", "SAPX266021.00") && !numberPrefixMatches("anything", ""),
  "empty value or empty prefix is safe and never matches");
check(numberPrefixMatches("SAPX256015.01 Tabler Ph2", "sapx256015.01"),
  "a folder whose OWN suffix is not .00 still matches on an exact prefix");
check(numberPrefixMatches("SAPX266021", "SAPX266021.00"),
  "a bare stored value with no suffix at all (the field-photo session case) matches exactly at the base");

// ── 2. search_field_photos: project filter tolerates the same mismatch ─────
const SESSIONS = [
  { project_number: "SAPX266021", project_name: "St. Nicholas of Tolentine Feasibility Study" },
  { project_number: "SAPX266021.01", project_name: "St. Nicholas of Tolentine Ph2" },
  { project_number: "SAPX196006.00", project_name: "SUNY Stony Brook Tabler Quad Red Hall" },
];
eq(filterSessionsByProject(SESSIONS, "SAPX266021.00").map((r) => r.project_number), ["SAPX266021"],
  "querying the fully-qualified number finds a session logged without the default .00 suffix");
eq(filterSessionsByProject(SESSIONS, "SAPX196006.00").map((r) => r.project_number), ["SAPX196006.00"],
  "an exact match is unaffected");
eq(filterSessionsByProject(SESSIONS, "sapx266021.01").map((r) => r.project_number), ["SAPX266021.01"],
  "a query for a REAL phase suffix does not also pull in the .00-less session");
eq(filterSessionsByProject(SESSIONS, "tolentine").map((r) => r.project_number).sort(),
  ["SAPX266021", "SAPX266021.01"], "free-text project-name search is unaffected");

// ── 3. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has("function numberPrefixMatches(value: string, numPrefix: string): boolean {",
  "numberPrefixMatches is defined");
has("if (it.folder && numberPrefixMatches(it.name, numPrefix)) {",
  "findProjectFolderInDrive uses the tolerant matcher");
has("if (it.folder && numberPrefixMatches(it.name, num)) return it;",
  "projectFolder uses the tolerant matcher");
has("has(r.project_number, pq) || has(r.project_name, pq) || numberPrefixMatches(r.project_number, pq));",
  "search_field_photos filter falls back to the tolerant matcher");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);
