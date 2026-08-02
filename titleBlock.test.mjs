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
  + "\nexport { parseTitleBlock, tbRevision, isoFromUsDate, TITLE_BLOCK_RE };";
const mod = await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));
const { parseTitleBlock, tbRevision, isoFromUsDate, TITLE_BLOCK_RE } = mod;

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
// The literal sits on its own line in both files. Match to end of line: a
// dotall capture runs straight past it into the next declaration.
const grab = (src2) => {
  const m = /const TITLE_BLOCK_RE =\s*(\/[^\n]*\/);/.exec(src2);
  return m ? m[1].trim() : "";
};
const htmlRe = grab(html), mcpRe = grab(mcp);
check(htmlRe !== "", "found TITLE_BLOCK_RE in transmittal.html");
check(mcpRe !== "", "found TITLE_BLOCK_RE in the connector");
check(htmlRe === mcpRe,
  `TITLE_BLOCK_RE has DRIFTED between transmittal.html and pms-mcp.\n  app: ${htmlRe}\n  mcp: ${mcpRe}`);
// The revision rule is the subtle one; both sides must anchor on the last date.
check(html.includes('lastIndexOf("Revisions Rev Description Date")') &&
      mcp.includes('lastIndexOf("Revisions Rev Description Date")'),
  "both sides still anchor the revision block the same way");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (parser evaluated from transmittal.html, cross-checked against pms-mcp)`);
process.exit(failures ? 1 : 0);
