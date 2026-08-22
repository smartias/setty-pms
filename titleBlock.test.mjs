// Tests for the title-block reader in transmittal.html.
//
//   node titleBlock.test.mjs
//
// The parser is EVALUATED straight out of transmittal.html rather than copied,
// so it cannot drift from the shipped code the way a copy would.
//
// It IS, however, a port of the parser in supabase/functions/pms-mcp/index.ts
// (extract_sheet_index). Two codebases now read the same title block, so the
// last section asserts the two regexes are character-identical. If that fails,
// one side was changed without the other and they will disagree about what a
// drawing says — which is worse than either being wrong alone.

import { readFileSync } from "node:fs";

const HTML = new URL("./transmittal.html", import.meta.url);
const MCP = new URL("./supabase/functions/pms-mcp/index.ts", import.meta.url);
const html = readFileSync(HTML, "utf8");
const mcp = readFileSync(MCP, "utf8");

const START = "// ─── TITLE-BLOCK READER";
const END = "// ─── FILENAME PARSER";
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0 || b <= a) {
  console.error("FAIL: could not slice the title-block reader out of transmittal.html");
  process.exit(1);
}
// mapDiscipline lives further down the file; the parser only needs its mapping.
const src = "function mapDiscipline(c){ return ({M:'Mechanical',E:'Electrical',P:'Plumbing',FP:'Fire Protection',T:'Technology'})[c] || c || 'General'; }\n"
  + html.slice(a, b)
  + "\nexport { parseTitleBlock, tbRevision, isoFromUsDate, TITLE_BLOCK_PATTERNS };";
const mod = await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));
const { parseTitleBlock, tbRevision, isoFromUsDate, TITLE_BLOCK_PATTERNS } = mod;

let failures = 0, total = 0;
const check = (c, m) => { total++; if (!c) { failures++; console.error("FAIL: " + m); } };
const eq = (g, w, m) => check(g === w, `${m} — got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`);

// ── Real page text, verbatim from Tabler sheets ────────────────────────────
const TAIL = "500 Circle Road Stony Brook, New York 11790 ";
const E221 = TAIL + "E221 GROUND FLOOR PLAN - COMMONS - ELECTRICAL POWER 10/29/2024 SMA SM 1018037.01 " +
  "TABLER QUAD NEW RESIDENCE HALL CONSTRUCTION DOCUMENTS PD 22 68 Revisions Rev Description Date " +
  "B ADDENDUM #B 02/05/2025 RFI-59 01/14/2026 13 BULLETIN 013 04/17/2026";
const FP601 = TAIL + "FP601 FIRE PROTECTION SCHEDULES 11/01/19 CHS KB 1018037.01 " +
  "TABLER QUAD NEW RESIDENCE HALL CONSTRUCTION DOCUMENTS EB 18 19 Revisions Rev Description Date";

const e = parseTitleBlock(E221);
check(!!e, "a 2026 sheet parses");
eq(e.sheetNo, "E221", "sheet number");
eq(e.title, "GROUND FLOOR PLAN - COMMONS - ELECTRICAL POWER", "sheet title");
eq(e.discipline, "Electrical", "discipline is mapped from the sheet-number prefix");
eq(e.sheetDate, "10/29/2024", "base issue date");
eq(e.revision, "13", "revision is the LAST row of the block");
eq(e.revisionDate, "04/17/2026", "revision date");

const f = parseTitleBlock(FP601);
check(!!f, "a 2019 sheet parses");
eq(f.sheetNo, "FP601", "2019 sheet number");
eq(f.discipline, "Fire Protection", "two-letter discipline maps");
eq(f.revision, "0", "an EMPTY revision block is a base issue at revision 0");
eq(f.revisionDate, null, "...with no revision date");

// The whole point: a file whose NAME says nothing still yields real sheets.
// These are the CUNY Brooklyn BMS filenames, which parse to nothing.
check(parseTitleBlock("2026-01-27 01-BOYLAN HALL 100% CD.pdf") === null,
  "a bare filename is not mistaken for a title block");

// ── Second layout: sheet number LAST (CHCR Grove, think! architecture) ─────
// Verbatim from 2024-01-16_Plumbing_CHCR Grove.pdf page 1. The whole reason
// this pattern exists: the sheet number trails the project number, it carries
// spaces around its hyphen, and the initials are Revit's unfilled placeholders.
const CHCR = 'ORIGINAL DRAWING SIZE IS 24"x 36"; SCALE ENTITIES ACCORDINGLY IF REDUCED/ENLARGED SHEET NO. OF ' +
  '16-01-2024 19:00:26 1/8" = 1\' - 0" C:\\Users\\j.vishal\\Documents\\226014.00_R19_Plumbing.rvt ' +
  "GENERAL NOTES, SYMBOLS & ABBREVIATIONS 02/01/21 Author Checker 21104 P - 001 P 01 10 " +
  "PLUMBING DRAWING LIST SHEET DRAWING TITLE 1 P-001 GENERAL NOTES, SYMBOLS & ABBREVIATIONS " +
  "2 P-100 LEVEL 1 FLOOR UNDERSLAB - PLUMBING NO. REVISIONS DATE";

const c = parseTitleBlock(CHCR);
check(!!c, "a CHCR Grove sheet parses at all (it did not before this pattern)");
eq(c.sheetNo, "P-001", 'the spaced "P - 001" is normalised to P-001');
eq(c.title, "GENERAL NOTES, SYMBOLS & ABBREVIATIONS", "CHCR sheet title");
eq(c.discipline, "Plumbing", "discipline still comes from the sheet-number prefix");
eq(c.sheetDate, "02/01/21", "CHCR sheet date");
// An empty NO. REVISIONS DATE block is a base issue, exactly like Tabler's.
eq(c.revision, "0", "CHCR empty revision block reads as revision 0");
eq(c.revisionDate, null, "...with no revision date");

// The two layouts must not poach each other's sheets, or one architect's
// drawings would silently parse with another's field order.
check(parseTitleBlock(E221).sheetNo === "E221", "the CHCR pattern does not steal a Tabler sheet");
eq(TITLE_BLOCK_PATTERNS.length, 3, "three layouts are registered");
check(!TITLE_BLOCK_PATTERNS[1].re.test(E221), "sheet-number-last does not match a sheet-number-first block");
check(!TITLE_BLOCK_PATTERNS[0].re.test(CHCR), "sheet-number-first does not match a sheet-number-last block");

// ── Third layout: DOB-NOW filing stamp (Setty in-house, e.g. Q126 Reso A) ──
// Verbatim extracted text from a Q126 IS126 PAA Filing book page: sheet number
// first, the DOB-set position, the title, then the fixed "DOB NOW Job#" tail. The
// "1 PD101.00 SCALE:" / "2 PD101.00" tokens are detail callouts that must NOT be
// mistaken for the title-block sheet number — only the one followed by "NN of MM".
const DOBNOW = `EMOVALS PLAN - PLUMBING 1/4" = 1'-0" 1 PD101.00 SCALE: ROOM 201 REMOVALS PLAN - PLUMBING 1/4" = 1'-0" 2 PD101.00 02 of 05 PLUMBING DEMOLITION FLOOR PLANS 19 of DOB NOW Job# Q0120856-S2 1`;
const d = parseTitleBlock(DOBNOW);
check(!!d, "a DOB-NOW filing sheet parses (it did not before pattern 3)");
eq(d.sheetNo, "PD101.00", "DOB-NOW sheet number keeps its .NN decimal suffix");
eq(d.title, "PLUMBING DEMOLITION FLOOR PLANS", "DOB-NOW title, not the detail-callout noise");
eq(d.revision, "0", "a DOB-NOW sheet with no revision block is revision 0");
// A second DOB-NOW variant: no "of" junk between title and the tail.
const DOBNOW2 = `2 P101.00 03 of 07 PLUMBING FLOOR PLANS DOB NOW Job# Q0120856-S2 20 of 26 Block 553 Lot 1`;
eq(parseTitleBlock(DOBNOW2).sheetNo, "P101.00", "DOB-NOW variant with no page-count junk parses");
eq(parseTitleBlock(DOBNOW2).title, "PLUMBING FLOOR PLANS", "...with the right title");
// Isolation: the three layouts must not poach each other.
check(parseTitleBlock(E221).sheetNo === "E221", "DOB-NOW pattern does not steal a Tabler sheet");
check(parseTitleBlock(CHCR).sheetNo === "P-001", "DOB-NOW pattern does not steal a CHCR sheet");
check(!TITLE_BLOCK_PATTERNS[2].re.test(E221), "the DOB-NOW regex does not match a sheet-first block");
check(!TITLE_BLOCK_PATTERNS[2].re.test(CHCR), "the DOB-NOW regex does not match a sheet-last block");
check(!TITLE_BLOCK_PATTERNS[0].re.test(DOBNOW), "sheet-first does not match a DOB-NOW block");
check(!TITLE_BLOCK_PATTERNS[1].re.test(DOBNOW), "sheet-last does not match a DOB-NOW block");

// CHCR writes revision dates as 2023.08.11, not 08/11/2023.
eq(tbRevision("NO. REVISIONS DATE 1 ADDENDUM 1 2024.03.05").revision, "1",
  "a dotted-date revision row is read");
eq(tbRevision("NO. REVISIONS DATE 1 ADDENDUM 1 2024.03.05").date, "2024.03.05",
  "...with its dotted date");

// ── Date conversion ────────────────────────────────────────────────────────
eq(isoFromUsDate("10/29/2024"), "2024-10-29", "4-digit year");
eq(isoFromUsDate("11/01/19"), "2019-11-01", "2-digit year expands");
eq(isoFromUsDate("1/5/2026"), "2026-01-05", "single-digit month and day pad");
eq(isoFromUsDate(""), "", "empty input yields empty, not a bogus date");
eq(isoFromUsDate("not a date"), "", "garbage yields empty");

// ── Revision block edge cases ──────────────────────────────────────────────
eq(tbRevision("no block here").revision, "0", "a sheet with no revision block is revision 0");
eq(tbRevision("Revisions Rev Description Date 13 BULLETIN 013 04/17/2026 13").revision, "13",
  "trailing junk after the last date does not become the revision");
// A row with no description at all, which defeats row-wise parsing.
eq(tbRevision("Revisions Rev Description Date A ADD 01/22/2025 RFI-144 03/25/2026").revision, "RFI-144",
  "a description-less row still yields its label");

// ── Drift check against the connector ──────────────────────────────────────
// Each literal sits on its own line in both files. Match to end of line: a
// dotall capture runs straight past it into the next declaration.
const grab = (src2, name) => {
  const m = new RegExp("const " + name + " =\\s*(/[^\\n]*/);").exec(src2);
  return m ? m[1].trim() : "";
};
for (const name of ["TITLE_BLOCK_SHEET_FIRST", "TITLE_BLOCK_SHEET_LAST", "TITLE_BLOCK_DOB_NOW"]) {
  const htmlRe = grab(html, name), mcpRe = grab(mcp, name);
  check(htmlRe !== "", `found ${name} in transmittal.html`);
  check(mcpRe !== "", `found ${name} in the connector`);
  check(htmlRe === mcpRe,
    `${name} has DRIFTED between transmittal.html and pms-mcp.\n  app: ${htmlRe}\n  mcp: ${mcpRe}`);
}
// The header list and date formats have to match too, or one side would read a
// revision the other cannot see.
for (const needle of ['"NO. REVISIONS DATE"', "\\d{4}\\.\\d{2}\\.\\d{2}"]) {
  check(html.includes(needle) && mcp.includes(needle),
    `both sides know about ${needle}`);
}
// The revision rule is the subtle one. Both sides must pick the LAST matching
// header (templates print a submissions table above the revisions table) and
// then anchor on the last date within it.
check(html.includes("const REVISION_HEADERS =") && mcp.includes("const REVISION_HEADERS ="),
  "both sides read revision headers from a list");
check(html.includes("if (at > i) { i = at; header = h; }") &&
      mcp.includes("if (at > i) { i = at; header = h; }"),
  "both sides take the LAST matching revision header, not the first");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (parser evaluated from transmittal.html, cross-checked against pms-mcp)`);
process.exit(failures ? 1 : 0);
