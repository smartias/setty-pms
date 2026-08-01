// Tests for extract_sheet_index's title-block parsing in index.ts.
//
//   node supabase/functions/pms-mcp/sheetIndex.test.mjs
//
// The parsers are COPIED below (index.ts boots a server at import). Drift checks
// at the bottom.
//
// The fixtures are VERBATIM excerpts of real page text returned by read_document
// on 2026-08-01, from Tabler Quad (SAPX196006.00): the 2026 Bulletin #13 booked
// package and a 2019 Final CD individual sheet. They are kept as-is, including
// the run-together spacing that PDF text extraction produces, because that
// spacing is exactly what the regexes have to survive.

// ── copies from index.ts ────────────────────────────────────────────────────
const TITLE_BLOCK_RE =
  /\b([A-Z]{1,3}\d{2,4}[A-Z]?)\s+([A-Z][A-Z0-9 \-,&/'".()]{3,80}?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([A-Z]{2,4})\s+([A-Z]{2,4})\s+(\d[\d.]*)\b/;
const PHASE_RE =
  /\b(CONSTRUCTION DOCUMENTS|CONTRACT DOCUMENTS|DESIGN DEVELOPMENT|SCHEMATIC DESIGN|BID DOCUMENTS|BID SET|PERMIT SET|PROGRAMMING|VALIDATION)\s+\S+\s+(\d{1,3})\s+(\d{1,3})\b/;

function parseRevisionBlock(pageText) {
  const i = pageText.lastIndexOf("Revisions Rev Description Date");
  if (i < 0) return { revision: "0", description: "", date: null };
  const tail = pageText.slice(i + "Revisions Rev Description Date".length);
  const dates = [...tail.matchAll(/\d{1,2}\/\d{1,2}\/\d{4}/g)];
  if (!dates.length) return { revision: "0", description: "", date: null };
  const last = dates[dates.length - 1];
  const prevEnd = dates.length > 1 ? dates[dates.length - 2].index + dates[dates.length - 2][0].length : 0;
  const between = tail.slice(prevEnd, last.index).trim().split(/\s+/).filter(Boolean);
  return { revision: between.length ? between[0] : "0", description: between.slice(1).join(" "), date: last[0] };
}
function parseTitleBlock(pageText) {
  const m = TITLE_BLOCK_RE.exec(pageText);
  if (!m) return null;
  const sheetNo = m[1];
  const ph = PHASE_RE.exec(pageText);
  const rev = parseRevisionBlock(pageText);
  return {
    sheetNo,
    discipline: (/^([A-Z]{1,3})/.exec(sheetNo) || [, ""])[1],
    sheetTitle: m[2].replace(/\s+/g, " ").trim(),
    sheetDate: m[3], drawnBy: m[4], checkedBy: m[5], projectNo: m[6],
    phase: ph ? ph[1] : null,
    pageOfSet: ph ? Number(ph[2]) : null,
    setTotal: ph ? Number(ph[3]) : null,
    revision: rev.revision,
    revisionDescription: rev.description || null,
    revisionDate: rev.date,
  };
}
const NON_SHEET_FOLDER = /\b(cad files?|revit models?|specs?|specifications?|native|dwg|working)\b/i;

// ── real page tails, verbatim ───────────────────────────────────────────────
const TAIL = "500 Circle Road Stony Brook, New York 11790 ";
// 2026 Bulletin #13, page 1 — a sheet with prior revisions, one row of which
// ("RFI-59 01/14/2026") carries no description at all.
const E221 = TAIL + "E221 GROUND FLOOR PLAN - COMMONS - ELECTRICAL POWER 10/29/2024 SMA SM 1018037.01 " +
  "TABLER QUAD NEW RESIDENCE HALL CONSTRUCTION DOCUMENTS PD 22 68 1/8\" = 1'-0\" GROUND FLOOR PLAN - COMMONS - " +
  "ELECTRICAL POWER 1 Revisions Rev Description Date B ADDENDUM #B 02/05/2025 RFI-59 01/14/2026 13 BULLETIN 013 04/17/2026";
// page 2 — single revision row, and trailing junk after the last date.
const E602 = TAIL + "E602 ELECTRICAL EQUIPMENT SCHEDULES 10/29/2024 SMA SM 1018037.01 " +
  "TABLER QUAD NEW RESIDENCE HALL CONSTRUCTION DOCUMENTS PD 46 68 1 Revisions Rev Description Date 13 BULLETIN 013 04/17/2026 13";
const E603 = TAIL + "E603 ELECTRICAL PANEL SCHEDULES 10/29/2024 SMA SM 1018037.01 " +
  "TABLER QUAD NEW RESIDENCE HALL CONSTRUCTION DOCUMENTS PD 47 68 1 Revisions Rev Description Date 13 BULLETIN 013 04/17/2026 13 13";
// page 4 — different history from page 1, same file. Trailing "A A A 13".
const E610 = TAIL + "E610 ELECTRICAL PANEL SCHEDULES 10/29/2024 SMA SM 1018037.01 " +
  "TABLER QUAD NEW RESIDENCE HALL CONSTRUCTION DOCUMENTS PD 54 68 Revisions Rev Description Date " +
  "A ADDENDUM #A 01/22/2025 RFI-144 03/25/2026 13 BULLETIN 013 04/17/2026 A A A 13";
// 2019 base issue: 2-digit date, different initials, EMPTY revision block.
const FP601 = "Drawing of NTS 11/01/2019 N:\\SAP\\2019\\SAPX196006.00\\80-SAPX196006.00_REVIT\\STTQ-01-P.rvt " +
  "11/22/2019 1:50:12 PM " + TAIL + "FP601 FIRE PROTECTION SCHEDULES 11/01/19 CHS KB 1018037.01 " +
  "TABLER QUAD NEW RESIDENCE HALL CONSTRUCTION DOCUMENTS EB 18 19 BACKFLOW PREVENTER SCHEDULE ID SERVICE " +
  "LOCATION DESCRIPTION Revisions Rev Description Date";

let failures = 0, total = 0;
const check = (c, m) => { total++; if (!c) { failures++; console.error("FAIL: " + m); } };
const eq = (g, w, m) => check(g === w, `${m} — got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`);

// ── 1. One booked PDF yields four DIFFERENT sheets ─────────────────────────
const book = [E221, E602, E603, E610].map(parseTitleBlock);
check(book.every(Boolean), "every page of the booked package parses");
eq(book.map((s) => s.sheetNo).join(","), "E221,E602,E603,E610", "four distinct sheet numbers from one file");
eq(new Set(book.map((s) => s.sheetNo)).size, 4, "no sheet number is repeated");
// The filename says STTQ-01-E. None of these sheets is called that.
check(!book.some((s) => s.sheetNo.startsWith("STTQ")), "no sheet inherits the Revit model name from the filename");

// ── 2. Field-level accuracy on the first sheet ─────────────────────────────
const s1 = book[0];
eq(s1.sheetTitle, "GROUND FLOOR PLAN - COMMONS - ELECTRICAL POWER", "title");
eq(s1.discipline, "E", "discipline from the sheet number prefix");
eq(s1.sheetDate, "10/29/2024", "sheet date");
eq(s1.drawnBy, "SMA", "drawn by");
eq(s1.checkedBy, "SM", "checked by");
eq(s1.projectNo, "1018037.01", "project number");
eq(s1.phase, "CONSTRUCTION DOCUMENTS", "phase");
eq(s1.pageOfSet, 22, "page within the set");
eq(s1.setTotal, 68, "set total");

// ── 3. Revision = the LAST row of the sheet's own block ────────────────────
// E221's block has three rows and the middle one has no description; anchoring
// on the last DATE rather than parsing rows is what survives that.
eq(s1.revision, "13", "E221 current revision");
eq(s1.revisionDescription, "BULLETIN 013", "E221 revision description");
eq(s1.revisionDate, "04/17/2026", "E221 revision date");
eq(book[1].revision, "13", "E602 revision, single-row block with trailing junk");
eq(book[3].revision, "13", "E610 revision, different history, trailing 'A A A 13'");
eq(book[3].revisionDescription, "BULLETIN 013", "E610 description not polluted by trailing junk");
// Same file, same bulletin, but genuinely different sheet histories.
check(book[0].pageOfSet !== book[3].pageOfSet, "sheets in one file occupy different positions in the set");

// ── 4. The 2019 era ────────────────────────────────────────────────────────
const old = parseTitleBlock(FP601);
check(!!old, "a 2019 sheet parses at all");
eq(old.sheetNo, "FP601", "2019 sheet number");
eq(old.discipline, "FP", "two-letter discipline");
eq(old.sheetTitle, "FIRE PROTECTION SCHEDULES", "2019 title");
eq(old.sheetDate, "11/01/19", "2-digit year survives");
eq(old.drawnBy, "CHS", "2019 drawn by");
eq(old.setTotal, 19, "2019 set total");
// An empty revision block is a BASE ISSUE, not a parse failure.
eq(old.revision, "0", "empty revision block reads as revision 0");
eq(old.revisionDate, null, "...with no revision date");
// The model path in this sheet says STTQ-01-P for a FIRE PROTECTION sheet.
// Proof that neither the filename nor the model name can be trusted.
check(FP601.includes("STTQ-01-P.rvt") && old.discipline === "FP",
  "the Revit model name contradicts the real discipline, and the title block wins");

// ── 5. Partial-issue detection ─────────────────────────────────────────────
// Four sheets that each say "of 68" is a bulletin, not a full set. This is what
// stops a partial being mistaken for the current full set.
const totals = [...new Set(book.map((s) => s.setTotal))];
eq(totals.length, 1, "every sheet in the package agrees on the set size");
check(book.length < totals[0], "4 sheets out of 68 is detectably a PARTIAL issue");

// ── 6. Composite assembly: latest sheetDate per sheet number wins ──────────
const baseline = [
  { sheetNo: "E221", sheetDate: "10/29/2024", revision: "0", set: "2024-10-24 Revised 100% CD" },
  { sheetNo: "E602", sheetDate: "10/29/2024", revision: "0", set: "2024-10-24 Revised 100% CD" },
  { sheetNo: "E701", sheetDate: "10/29/2024", revision: "0", set: "2024-10-24 Revised 100% CD" },
];
const partial = [{ sheetNo: "E221", sheetDate: "04/17/2026", revision: "13", set: "2026-04-17 Bulletin #13" }];
const ord = (d) => { const [m, dd, y] = d.split("/"); return `${y.length === 2 ? "20" + y : y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}`; };
const composite = new Map();
for (const r of [...baseline, ...partial]) {
  const prev = composite.get(r.sheetNo);
  if (!prev || ord(r.sheetDate) > ord(prev.sheetDate)) composite.set(r.sheetNo, r);
}
eq(composite.size, 3, "the composite has one row per sheet, not one per issue");
eq(composite.get("E221").revision, "13", "a revised sheet takes its latest revision");
eq(composite.get("E221").set, "2026-04-17 Bulletin #13", "...and cites the set it came from");
eq(composite.get("E602").revision, "0", "an untouched sheet stays at its baseline revision");
eq(composite.get("E701").set, "2024-10-24 Revised 100% CD", "...and still cites the baseline");
eq(ord("11/01/19"), "2019-11-01", "2-digit years order correctly against 4-digit ones");

// ── 7. Non-sheet folders are excluded ──────────────────────────────────────
for (const p of ["PDFS/CAD FILES", "REVIT MODELS", "2019-11-22_Final CD Submission/SPECS", "PDFS/Native"]) {
  check(NON_SHEET_FOLDER.test(p), `"${p}" is excluded from sheet extraction`);
}
for (const p of ["PDFS/STTQ-01-FP_INDIVIDUAL PDF", "Outgoing/2026-04-17_Bulletin #13", "PDFS/Combined PDF"]) {
  check(!NON_SHEET_FOLDER.test(p), `"${p}" is NOT excluded`);
}

// ── 8. Drift checks ────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (n, l) => check(shipped.includes(n), `${l} has DRIFTED from this test's copy`);
has('const i = pageText.lastIndexOf("Revisions Rev Description Date");', "revision-block anchor");
has('if (!dates.length) return { revision: "0", description: "", date: null };', "base-issue fallback");
has('mcp.tool("extract_sheet_index"', "extract_sheet_index is registered");
has("const key = tb.sheetNo + \"|\" + tb.revision;", "combined-vs-individual dedupe key");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (5 real sheets across 2019 and 2026, 4 drift checks)`);
process.exit(failures ? 1 : 0);
