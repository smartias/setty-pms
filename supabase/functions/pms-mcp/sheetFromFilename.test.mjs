// Tests for sheetFromFilename.ts — a sheet number read from the file name and
// confirmed by the page text, for title blocks no pattern reads (2026-11-13).
//
//   node supabase/functions/pms-mcp/sheetFromFilename.test.mjs
//
// The fixtures are VERBATIM excerpts of page text returned by read_document on
// 2026-11-13 from Q126 (SAPQ236917.01), set "2025-04-10 Updated Drawings
// Removing POT". They keep the run-together order AutoCAD plots text in,
// because that order is exactly why the title-block patterns miss them.
//
// The module is pure, so this imports the real Edge source (Node strips the
// types). The wiring in index.ts is pinned by the drift checks at the bottom.

import { readFileSync } from "node:fs";
import { sheetFromFilename, filenameSheetNo, FILENAME_LAYOUT, FILENAME_LAYOUT_OLD } from "./sheetFromFilename.ts";

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };
const eq = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);

const TAIL = " Block 553 Lot 1 MEP/FP DESIGN ENGINEERING • PROJECT MANAGEMENT ENERGY MANAGEMENT SERVICES Drawing No.: Drawing Title: Address: Key Plan: BID SUBMISSION 9/24/2024 2 POT UPDATE 4/11/2025";
const E101 = "GFI EXISTING SMART BOARD D D CS EPB 3'-10 1 16 \" 46.8035 1 2 5 5 5 5 5 5 1 1 2 2 4 3 3 3 E101.00 ELECTRICAL CLASSROOM PLANS" + TAIL +
  " # SHEET KEY NOTES 1. ALL RECEPTACLES IN TRIFACIAL TABLE TO BE CIRCUITED TO PANEL RP-201 - 4 AND RP-201-25 SCALE: NEW FLOOR PLAN - ELECTRICAL 1/4\" = 1' - 0\" 1 E101.00 SCALE: NEW RCP PLAN - ELECTRICAL 1/4\" = 1'-0\" 2 E101.00 SCALE: EXISTING PANEL SCHEDULE N.T.S 4 E101.00 12 of 19 -";
const ED101 = "EXISTING ELECTRICAL PANEL RP-201 TO REMAIN EXISTING ELECTRICAL PANEL SPD-2 ED101.00 ELECTRICAL DEMOLITION FLOOR PLANS" + TAIL +
  " SCALE: ROOM 301 REMOVALS PLAN - ELECTRICAL 1/4\" = 1'-0\" 1 ED-101.00 SCALE: ROOM 201 REMOVALS PLAN - ELECTRICAL 1/4\" = 1'-0\" 2 ED-101.00 11 of 19 -";
const AD101 = "EXISTING VCT FLOORING TO BE REMOVED IN THE ENTIRE CLASSROOM. U.V REMOVE EXISTING DOOR REMOVE EXISTING DOOR AD101.00 DEMOLITION PLANS SCALE: ROOM 301 CEILING REMOVALS PLAN 1/4\" = 1'-0\" 1 AD101.00 SCALE: ROOM 301 REMOVALS PLAN 1/4\" = 1'-0\" 2 AD101.00 03 # SHEET KEY NOTES" + TAIL + " 03 of 08";
const A400 = "BID SUBMISSION 9/24/2024 2 POT UPDATE 4/11/2025 A400.00 FINISH AND DOOR SCHEDULES AND DETAILS 08 of 25 FINISH SCHEDULE - ROOMS 301 Room Number 301 201 SCIENCE LAB SCALE: DOOR TYPE - FVK ELEVATION NOT TO SCALE 4 A400.00";
const E001 = "ELECTRICAL SYMBOL LIST SUMMARY OF WORK 1. DEMOLITION OF EXISTING LIGHTING AND LIGHTING CONTROLS, EXISTING POWER TO BE PRESERVED. P E001.00 ELECTRICAL NOTES, SYMBOLS, AND ABBREVIATIONS" + TAIL + " 10 of 19 -";
// The drawing-list sheet names EVERY sheet in the set; only its own file name
// says which one it is.
const T002 = "T002.00 DRAWING LIST AND GENERAL NOTES 02 BUILDING DEPARTMENT NOTES GENERAL NOTES DRAWING NAME DRAWING LIST - ARCHITECTURAL T001.00 COVER SHEET 1 E001.00 ELECTRICAL NOTES, SYMBOLS AND ABBREVIATIONS T002.00 DRAWING LIST AND GENERAL NOTES 2 A101.00 ADA REFERENCE DWG AD101.00 DEMOLITION PLANS 3 A102.00 NEW WORK PLANS 5" + TAIL;

// ── 1. filenameSheetNo: the whole stem must be a sheet number ───────────────
eq(filenameSheetNo("E101.00.pdf")?.sheetNo, "E101.00", "sheet number with a filing suffix");
eq(filenameSheetNo("ed101.00.PDF")?.sheetNo, "ED101.00", "case and extension case do not matter");
eq(filenameSheetNo("P701.01.pdf")?.sheetNo, "P701.01", "a later filing suffix is kept");
eq(filenameSheetNo("M-507.pdf")?.sheetNo, "M507", "a hyphenated name without a suffix");
eq(filenameSheetNo("FP301A.pdf")?.sheetNo, "FP301A", "a letter-suffixed number");
eq(filenameSheetNo("E101.00.pdf")?.discipline, "E", "discipline is the prefix");
eq(filenameSheetNo("E211 - GROUND FLOOR PLAN.pdf"), null, "a name with more than the number is not trusted");
eq(filenameSheetNo("2026-05-12_IS126 - D021837.D021933 Arch Update.pdf"), null, "a combined book");
eq(filenameSheetNo("S01010.pdf"), null, "a spec section file (S + five digits) is not a sheet");
eq(filenameSheetNo("AI1 Form_Setty.pdf"), null, "a form");
eq(filenameSheetNo("spec-cover.pdf"), null, "words");
eq(filenameSheetNo("STTQ-01.pdf"), null, "a four-letter building series");
eq(filenameSheetNo(""), null, "empty");
eq(filenameSheetNo(null), null, "null");

// ── 2. The live Q126 sheets no title-block pattern reads ────────────────────
eq(sheetFromFilename("E101.00.pdf", E101, 1), { sheetNo: "E101.00", discipline: "E", sheetTitle: "ELECTRICAL CLASSROOM PLANS" }, "E101.00: title ends at the block/lot stamp");
eq(sheetFromFilename("ED101.00.pdf", ED101, 1), { sheetNo: "ED101.00", discipline: "ED", sheetTitle: "ELECTRICAL DEMOLITION FLOOR PLANS" }, "ED101.00");
eq(sheetFromFilename("AD101.00.pdf", AD101, 1), { sheetNo: "AD101.00", discipline: "AD", sheetTitle: null }, "AD101.00: a title followed only by SCALE: is not bounded by the title block, so none is recorded");
eq(sheetFromFilename("A400.00.pdf", A400, 1), { sheetNo: "A400.00", discipline: "A", sheetTitle: "FINISH AND DOOR SCHEDULES AND DETAILS" }, "A400.00: title ends at the set position");
eq(sheetFromFilename("E001.00.pdf", E001, 1), { sheetNo: "E001.00", discipline: "E", sheetTitle: "ELECTRICAL NOTES, SYMBOLS, AND ABBREVIATIONS" }, "E001.00: punctuation in the title");
eq(sheetFromFilename("T002.00.pdf", T002, 1)?.sheetNo, "T002.00", "the drawing-list sheet is T002.00, not a sheet it lists");
check(sheetFromFilename("T002.00.pdf", T002, 1)?.sheetTitle !== "NEW WORK PLANS 5", "and never takes a listed sheet's title next to the block/lot stamp");

// ── 2b. Found live on 2026-11-13, after the first deploy ───────────────────
// P501.00 was titled "FLOOR FLOOR": riser-diagram labels after a detail bubble,
// ended by the NEXT detail's "SCALE:". Verbatim page text.
const P501 = "2\" V 2\" V 2\" V SCALE: NEW PARTIAL SANITARY RISER DIAGRAM NOT TO SCALE 4 P501.00 FLOOR FLOOR SCALE: NEW PARTIAL WATER RISER DIAGRAM NOT TO SCALE 3 P501.00 (E) 2-1/2\" CW (E) 2\" HW SCALE: PARTIAL SANITARY RISER DIAGRAM NOT TO SCALE 1 P501.00 SCALE: PARTIAL WATER RISER DIAGRAM NOT TO SCALE 2 P501.00 THIRD FLOOR (D)SINK EXISTING RISER 3\" FD P501.00 PLUMBING RISER DIAGRAM AND SCHEDULE 04 of 05 PLUMBING FIXTURE SCHEDULE TYPE REMARKS" + TAIL;
eq(sheetFromFilename("P501.00.pdf", P501, 1), { sheetNo: "P501.00", discipline: "P", sheetTitle: "PLUMBING RISER DIAGRAM AND SCHEDULE" },
  "P501.00: the title is the run bounded by the set position, not the labels before a SCALE:");
check(sheetFromFilename("P501.00.pdf", P501.replace("P501.00 PLUMBING RISER DIAGRAM AND SCHEDULE 04 of 05", "PLUMBING FIXTURE"), 1)?.sheetTitle === null,
  "and without that run the title is blank, never FLOOR FLOOR");
// P701.01.pdf prints P701.00 on every detail bubble and in its title block:
// the .01 is the filing, not a different sheet.
const P701 = "SCALE: PIPE PENETRATION IN INTERIOR WALL / FLOOR / CEILING DETAIL NOT TO SCALE 6 P701.00 SCALE: ADJUSTABLE SWIVEL PIPE SUPPORT DETAIL NOT TO SCALE 4 P701.00 HANGER ROD BY THE DEPARTMENT OF ENVIRONMENTAL PROTECTION, DEP. P701.00 05 of 05 FITTING SIZE ID STD FITTING CENTRELINE ACID NEUTRALISATION TANK NT-15 12\" PLUMBING DETAILS" + TAIL;
eq(sheetFromFilename("P701.01.pdf", P701, 1), { sheetNo: "P701.01", discipline: "P", sheetTitle: null },
  "P701.01: confirmed by the same sheet under another filing suffix; the file's own suffix is recorded");
eq(sheetFromFilename("P701.01.pdf", P701.replaceAll("P701.00", "P702.00"), 1), null, "a different sheet number is still not a confirmation");
eq(sheetFromFilename("P701.pdf", P701, 1)?.sheetNo, "P701", "an unsuffixed name is confirmed by the suffixed sheet, as before");
eq(sheetFromFilename("P701.01.pdf", P701.replaceAll("P701.00", "P701"), 1), null, "a suffixed name needs a suffixed number on the sheet");

// ── 3. Both halves are required ─────────────────────────────────────────────
eq(sheetFromFilename("E101.00.pdf", ED101, 1), null, "the name says E101.00 but the page is ED101.00: nothing, not a wrong number");
eq(sheetFromFilename("E101.00.pdf", E101.replaceAll("E101.00", "FE101.00"), 1), null, "the number inside a longer token is not a match");
eq(sheetFromFilename("E101.00.pdf", E101.replaceAll("E101.00", "E101.001"), 1), null, "nor with more digits after it");
eq(sheetFromFilename("E101.00.pdf", E101, 2), null, "a multi-page file is never named for one sheet");
eq(sheetFromFilename("E101.00.pdf", E101, 0), null, "an unknown page count is not one page");
eq(sheetFromFilename("E101 - POWER.pdf", E101, 1), null, "a descriptive file name is not trusted");
eq(sheetFromFilename("E101.00.pdf", "", 1), null, "no text layer, no confirmation");
eq(sheetFromFilename("E101.00.pdf", "E101.00", 1), null, "a near-empty page is not a drawing");
eq(sheetFromFilename("ED101.00.pdf", ED101.replace("ED101.00 ELECTRICAL", "XX ELECTRICAL"), 1)?.sheetNo, "ED101.00",
  "the hyphenated form on the sheet (ED-101.00) confirms the file name too");

// ── 4. Title: only when the page states one ─────────────────────────────────
eq(sheetFromFilename("E101.00.pdf", E101.replace("E101.00 ELECTRICAL CLASSROOM PLANS", "ELECTRICAL CLASSROOM PLANS"), 1),
  { sheetNo: "E101.00", discipline: "E", sheetTitle: null }, "detail bubbles and the set position give a number but no title");
eq(sheetFromFilename("M507.pdf", "x".repeat(60) + " REFER TO M507 FOR DETAILS SCALE: NONE", 1)?.sheetTitle, null, "prose after the number is not a title");

eq(sheetFromFilename("T002.00.pdf", "x".repeat(60) + " T002.00 DRAWING LIST 2 A101.00 ADA REFERENCE DWG Block 553 Lot 1", 1),
  { sheetNo: "T002.00", discipline: "T", sheetTitle: null }, "a run that names another sheet is a list row, not a title");
eq(sheetFromFilename("T002.00.pdf", T002, 1)?.sheetTitle, null, "the real T002.00 text states no bounded title, so none is recorded");

// ── 5. Drift checks against the shipped wiring ──────────────────────────────
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED`);
has('import { sheetFromFilename, filenameSheetNo, FILENAME_LAYOUT, FILENAME_LAYOUT_OLD } from "./sheetFromFilename.ts";', "the module is imported");
has("const tb = parseTitleBlock(pageText);\n  if (tb) return tb;\n  const fn = sheetFromFilename(fileName, pageText, totalPages);",
  "a parsed title block wins; the file name is only the fallback");
has("titleBlockLayout: FILENAME_LAYOUT,", "fallback rows say how, and under which rule set, they were read");
check(FILENAME_LAYOUT.startsWith("filename-confirmed") && !FILENAME_LAYOUT_OLD.includes(FILENAME_LAYOUT),
  "the current layout label is not also listed as an old one (rows would be re-read forever)");
check(FILENAME_LAYOUT_OLD.includes("filename-confirmed"), "rows read under the first rule set are marked for re-reading");
has('const FILENAME_STALE = "or=(sheet_no.is.null," +', "the backfill re-reads unnumbered rows and rows from an older rule set");
has("const tb = titleBlockFor(text, f.name, total);", "extract_sheet_index uses the fallback");
has("const tb = text.length >= 50 ? titleBlockFor(text, f.name, total) : null;", "the drawing indexer uses the fallback");
has("const sheetNumbersBackfilled = await backfillFilenameSheets(numPrefix, known);", "search_drawings backfills pages indexed before the fallback");
has('"&page=eq.1&" + FILENAME_STALE + "&item_id=in.("', "the backfill only reads stale pages");
has('"&page=eq.1&" + FILENAME_STALE,', "and only writes stale pages, so a title-block row is never overwritten");
has("if (askedKey) matches = rowsAll.filter((r) => canonicalSheet({ sheetNo: r.sheet_no })?.key === askedKey);",
  "view_drawing finds E101.00 when asked for E-101");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);
