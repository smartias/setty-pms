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

// ── 6. Specification sections (CSI MasterFormat), both numbering schemes ──
// Real names from SAPX256007.00's 100% CD set (1995 five-digit) plus the
// 2004+ six-digit form. Before this, every one fell through to a General row
// with no number and the whole filename as its title.
const s1 = parse("16010 - General Provisions For Electrical Work.pdf");
eq(s1.kind, "spec", "a five-digit CSI number marks the row as a spec");
eq(s1.sheetNo, "16010", "the section number is the row number");
eq(s1.discipline, "Electrical", "Division 16 is Electrical");
eq(s1.title, "General Provisions For Electrical Work", "the section title is the title");
eq(parse("15400 - Plumbing.pdf").discipline, "Plumbing", "15400s are Plumbing within Division 15");
eq(parse("15300 - Fire Protection.pdf").discipline, "Fire Protection", "15300s are Fire Protection within Division 15");
eq(parse("15500 - HVAC.pdf").discipline, "Mechanical", "the rest of Division 15 is Mechanical");
eq(parse("16721 - Fire Alarm.doc").discipline, "Fire Alarm", "16720s are Fire Alarm");
eq(parse("16740 - Telephone.doc").discipline, "Technology", "16700s are Technology");
const s2 = parse("23 05 00 - Common Work Results for HVAC.pdf");
eq(s2.kind, "spec", "a six-digit CSI number marks the row as a spec");
eq(s2.sheetNo, "23 05 00", "six-digit sections are spaced in pairs");
eq(s2.discipline, "Mechanical", "Division 23 is Mechanical");
eq(parse("230500 - Common Work Results.pdf").sheetNo, "23 05 00", "an unspaced six-digit number is normalised to pairs");
eq(parse("23 05 00.13 - Common Motor Requirements.pdf").sheetNo, "23 05 00.13", "a two-digit suffix is kept");
eq(parse("22 11 16 Domestic Water Piping.pdf").discipline, "Plumbing", "Division 22 is Plumbing");
eq(parse("21 13 13 - Wet-Pipe Sprinkler.pdf").discipline, "Fire Protection", "Division 21 is Fire Protection");
eq(parse("26 05 19 - Conductors.pdf").discipline, "Electrical", "Division 26 is Electrical");
eq(parse("27 10 00 - Structured Cabling.pdf").discipline, "Technology", "Division 27 is Technology");
eq(parse("28 31 00 - Fire Detection and Alarm.pdf").discipline, "Fire Alarm", "Division 28 is Fire Alarm");
eq(parse("01 10 00 - Summary.pdf").discipline, "General", "Division 01 is General");
eq(parse("M-101 Mechanical Plan.pdf").kind, "drawing", "a drawing is still a drawing");
check(parse("2025-04-10_TablerQ_E_Bulletin #1.pdf").kind !== "spec", "a date-led name is not mistaken for a spec section");

// ── 7. Combined discipline set: project number + discipline letter only ────
const combined = parse("SAPX256007.00_E.pdf");
eq(combined.kind, "drawing", "a combined set is a drawing file");
eq(combined.sheetNo, "", "no sheet number is invented out of the project number");
eq(combined.discipline, "Electrical", "the discipline letter after the project number is read");
check(combined.title.toLowerCase().includes("electrical"), "the title names the discipline set");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (parseFilename evaluated directly from transmittal.html)`);
process.exit(failures ? 1 : 0);
