// Tests for parseFilename() in transmittal.html — how a sheet PDF's filename
// becomes a register row (sheet number, title, revision, discipline).
//
//   node parseFilename.test.mjs
//
// Unlike the pms-mcp tests, this does NOT copy the function: it slices the real
// source out of transmittal.html and evaluates it, so there is nothing to drift.
//
// Why this file exists: the register's sheet rows are what will answer "which
// revision of which sheet is current?". Before this fix, series-led sheet names
// recorded the building SERIES as the discipline, so STTQ-01-E and STTQ-01-M
// both became sheetNo "STTQ-01" / discipline "STTQ" — two different sheets with
// one identity. Both of those names are real, from Bulletin #13 on SAPX196006.00.

import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./transmittal.html", import.meta.url), "utf8");
const start = html.indexOf("function parseFilename(");
const end = html.indexOf("function discCode(");
if (start < 0 || end < 0 || end <= start) {
  console.error("FAIL: could not slice parseFilename/mapDiscipline out of transmittal.html");
  process.exit(1);
}
// The slice covers parseFilename + mapDiscipline. uid() lives elsewhere and only
// stamps a row id, so a stub is enough.
const src = 'function uid() { return "test-id"; }\n' + html.slice(start, end) + "\nexport { parseFilename, mapDiscipline };";
const mod = await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));
const parse = (fn) => mod.parseFilename(fn, "2026-04-17T12:00:00.000Z");

let failures = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failures++; console.error("FAIL: " + msg); } };
const eq = (got, want, msg) => check(got === want, `${msg} — got "${got}", want "${want}"`);

// ── 1. The defect: series-led names, both real ──────────────────────────────
const e13 = parse("STTQ-01-E_Bulletin #13.pdf");
eq(e13.sheetNo, "STTQ-01-E", "STTQ-01-E keeps the discipline letter in the sheet number");
eq(e13.discipline, "Electrical", "STTQ-01-E is Electrical, not the series 'STTQ'");
eq(e13.title, "Bulletin #13", "STTQ-01-E title drops the sheet number");

const m13 = parse("STTQ-01-M_Bulletin #13.pdf");
eq(m13.sheetNo, "STTQ-01-M", "STTQ-01-M keeps the discipline letter in the sheet number");
eq(m13.discipline, "Mechanical", "STTQ-01-M is Mechanical");

// The whole point: these two must not share an identity.
check(e13.sheetNo !== m13.sheetNo, "the E and M sheets of Bulletin #13 now have DIFFERENT sheet numbers");
check(
  `${e13.sheetNo}|${e13.discipline}` !== `${m13.sheetNo}|${m13.discipline}`,
  "the (sheetNo, discipline) supersession key no longer collides across the E and M sheets",
);

// ── 2. Other real series-led names from this project's Outgoing folders ─────
const t01 = parse("STTA-01-T.pdf");
eq(t01.sheetNo, "STTA-01-T", "STTA-01-T parses with no title text");
eq(t01.discipline, "Technology", "T maps to Technology");
eq(t01.title, "", "a bare sheet number yields an empty title, not a junk one");

const withRev = parse("STTQ-01-M Riser Diagram Rev2.pdf");
eq(withRev.sheetNo, "STTQ-01-M", "series-led name with a title and revision");
eq(withRev.revision, "2", "the revision is still extracted from the tail");
eq(withRev.title, "Riser Diagram", "the revision is stripped out of the title");

// ── 3. No regression on discipline-led names (patterns 1-4) ────────────────
// Pattern 5 sits AFTER these and requires a 3+ letter series, so it cannot
// claim any of them. These assertions are the proof.
for (const [fn, sheetNo, disc, rev] of [
  ["M-501_Riser Diagram_Rev2.pdf", "M-501", "Mechanical", "2"],
  ["FP-301 Sprinkler Plan.pdf", "FP-301", "Fire Protection", "0"],
  ["P101 Plumbing Plan.pdf", "P-101", "Plumbing", "0"],
  ["E-201.pdf", "E-201", "Electrical", "0"],
  ["M-501.pdf", "M-501", "Mechanical", "0"],
  ["SAPX246006-M-501-Title-Rev2.pdf", "M-501", "Mechanical", "2"],
]) {
  const r = parse(fn);
  eq(r.sheetNo, sheetNo, `${fn} sheet number unchanged`);
  eq(r.discipline, disc, `${fn} discipline unchanged`);
  eq(r.revision, rev, `${fn} revision unchanged`);
}

// A two-letter series must NOT be read as series-number-discipline: "FP-301-A"
// is fire protection sheet 301, not sheet FP-301 in discipline A.
const fp = parse("FP-301-A Sprinkler Plan.pdf");
eq(fp.discipline, "Fire Protection", "FP-301-A stays Fire Protection (pattern 5 must not claim it)");
check(!fp.sheetNo.endsWith("-A"), "FP-301-A does not gain a bogus discipline suffix");

// ── 4. Known limitation, asserted so it is visible rather than assumed ─────
// Date-led names carry no parseable sheet number. This is the OTHER real
// fixture on SAPX196006.00 and it is unchanged by this fix.
const dated = parse("2025-04-10_TablerQ_E_Bulletin #1.pdf");
eq(dated.sheetNo, "", "date-led names still yield no sheet number (unchanged, out of scope)");
check(dated.title.length > 0, "...but the whole name is kept as the title, so nothing is lost");

// ── 5. Discipline map round-trips ──────────────────────────────────────────
eq(mod.mapDiscipline("FA"), "Fire Alarm", "FA maps to Fire Alarm");
eq(mod.mapDiscipline("T"), "Technology", "T maps to Technology");
eq(mod.mapDiscipline("STTQ"), "STTQ", "an unknown code still passes through rather than being lost");
eq(mod.mapDiscipline(""), "General", "an empty code defaults to General");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (parseFilename evaluated directly from transmittal.html)`);
process.exit(failures ? 1 : 0);
