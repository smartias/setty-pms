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

function summarizeDisciplines(sheets) {
  const byDiscipline = {};
  for (const s of sheets) {
    const d = s.discipline || "?";
    const e = byDiscipline[d] || (byDiscipline[d] = { sheets: 0, setTotal: null, totalsSeen: [] });
    e.sheets++;
    if (s.setTotal && !e.totalsSeen.includes(s.setTotal)) e.totalsSeen.push(s.setTotal);
  }
  for (const d of Object.keys(byDiscipline)) {
    const e = byDiscipline[d];
    if (e.totalsSeen.length > 1) e.conflictingTotals = [...e.totalsSeen].sort((a, b) => a - b);
    e.setTotal = e.totalsSeen.length ? Math.max(...e.totalsSeen) : null;
    e.isPartial = e.setTotal ? e.sheets < e.setTotal : null;
    delete e.totalsSeen;
  }
  const partialDisciplines = Object.keys(byDiscipline).filter((d) => byDiscipline[d].isPartial === true);
  const rated = Object.values(byDiscipline).filter((e) => e.setTotal !== null);
  return { byDiscipline, partialDisciplines, isPartialIssue: rated.length ? partialDisciplines.length > 0 : null };
}

const MAX_DOC_BYTES = 20 * 1024 * 1024;
const SHEET_MAX_BYTES = 64 * 1024 * 1024;

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

// ── 5. Partial-issue detection, PER DISCIPLINE ─────────────────────────────
// Four sheets that each say "of 68" is a bulletin, not a full set. This is what
// stops a partial being mistaken for the current full set.
const totals = [...new Set(book.map((s) => s.setTotal))];
eq(totals.length, 1, "every ELECTRICAL sheet in the package agrees on the set size");
check(book.length < totals[0], "4 sheets out of 68 is detectably a PARTIAL issue");

// The regression this replaced: set totals are stated PER DISCIPLINE (Tabler is
// E=68, M=54, T=22), so the old whole-result test — one distinct total across
// every sheet — was false the moment a package spanned two disciplines, and
// Bulletin #13's 8 sheets across E and M were reported as a COMPLETE set.
const bulletin13 = [
  ...book,                                                      // 4 E sheets, "of 68"
  { discipline: "E", setTotal: 68 }, { discipline: "E", setTotal: 68 },
  { discipline: "M", setTotal: 54 }, { discipline: "M", setTotal: 54 },
];
const b13 = summarizeDisciplines(bulletin13);
eq([...new Set(bulletin13.map((s) => s.setTotal))].length, 2,
  "a two-discipline package yields TWO distinct totals — what defeated the old test");
eq(b13.isPartialIssue, true, "8 sheets across E and M is a PARTIAL issue, not a full set");
eq(b13.byDiscipline.E.sheets, 6, "E sheet count");
eq(b13.byDiscipline.E.setTotal, 68, "E carries its own set total");
eq(b13.byDiscipline.M.setTotal, 54, "M carries a DIFFERENT set total");
eq(b13.partialDisciplines.join(","), "E,M", "both disciplines are named as short");

// A genuinely complete single-discipline set is still reported complete.
const fullT = Array.from({ length: 22 }, () => ({ discipline: "T", setTotal: 22 }));
eq(summarizeDisciplines(fullT).isPartialIssue, false, "22 of 22 T sheets is NOT partial");
// Mixed: T complete, E short. Any short discipline makes the ISSUE partial.
const mixed = summarizeDisciplines([...fullT, { discipline: "E", setTotal: 68 }]);
eq(mixed.isPartialIssue, true, "one complete discipline does not excuse a short one");
eq(mixed.partialDisciplines.join(","), "E", "only the short discipline is named");
eq(mixed.byDiscipline.T.isPartial, false, "...and the complete one is marked complete");

// No stated total is UNKNOWN, not complete. Reporting false here would assert a
// full set from sheets whose title blocks never said how many there are.
eq(summarizeDisciplines([{ discipline: "E", setTotal: null }]).isPartialIssue, null,
  "no stated set total reads as null, never false");
eq(summarizeDisciplines([{ discipline: "E", setTotal: null }]).byDiscipline.E.isPartial, null,
  "...per discipline too");

// Disagreeing totals within one discipline: take the largest so a partial is
// never rounded up into "complete".
const conflict = summarizeDisciplines([
  { discipline: "E", setTotal: 60 }, { discipline: "E", setTotal: 68 }, { discipline: "E", setTotal: 68 },
]);
eq(conflict.byDiscipline.E.setTotal, 68, "conflicting totals resolve to the largest");
eq(conflict.byDiscipline.E.isPartial, true, "3 sheets against the largest total is partial");
eq(conflict.byDiscipline.E.conflictingTotals.join(","), "60,68", "the conflict is surfaced, not hidden");

// ── 5b. Oversized combined books ───────────────────────────────────────────
// Baseline sets ship one combined PDF per discipline. Tabler's combined
// electrical book is 42MB, past the 20MB generic document cap, so it used to be
// dropped as one quiet `unparsed` row. Sheet extraction never returns the file
// body, so it gets its own larger cap — and oversized files are taken LAST, so a
// book that fails cannot cost us the individual sheets that would have parsed.
const MB = 1024 * 1024;
const isBig = (f) => Number(f.size) > MAX_DOC_BYTES;
const files = [
  { name: "COMBINED-E.pdf", size: 42 * MB, folderPath: "Outgoing/Set" },
  { name: "E221.pdf", size: 2 * MB, folderPath: "Outgoing/Set" },
  { name: "COMBINED-M.pdf", size: 30 * MB, folderPath: "Outgoing/Set" },
  { name: "E602.pdf", size: 1 * MB, folderPath: "Outgoing/Set" },
];
const orderOf = (arr) => [...arr].sort((a, b) =>
  Number(isBig(a)) - Number(isBig(b)) ||
  String(a.folderPath).localeCompare(String(b.folderPath)) ||
  String(a.name).localeCompare(String(b.name)));
const ordered = orderOf(files);
eq(ordered.map((f) => f.name).join(","), "E221.pdf,E602.pdf,COMBINED-E.pdf,COMBINED-M.pdf",
  "individual sheets are opened BEFORE any oversized book");
check(ordered.slice(0, 2).every((f) => !isBig(f)), "no oversized file precedes a normal one");
check(42 * MB > MAX_DOC_BYTES, "the 42MB Tabler electrical book is over the generic document cap");
check(42 * MB < SHEET_MAX_BYTES, "...but within the sheet-extraction cap, so it is now OPENED");
check(70 * MB > SHEET_MAX_BYTES, "a 70MB file is still refused rather than risking the worker");
eq(ordered.filter(isBig).map((f) => f.name).join(","), "COMBINED-E.pdf,COMBINED-M.pdf",
  "oversized files are ordered deterministically among themselves");

// ── 5c. Paging must be TOTAL and STABLE, or offset silently loses files ────
// offset pages through this order ACROSS CALLS. If the order can vary between
// calls, page 2 skips files page 1 never read and re-reads others, and the
// caller gets a plausible wrong answer with no signal. Graph does not promise a
// children order, so the sort has to impose one.
const shuffled = [files[3], files[0], files[2], files[1]];
eq(orderOf(shuffled).map((f) => f.name).join(","), ordered.map((f) => f.name).join(","),
  "a differently-ordered crawl result yields the SAME order");
const byPath = orderOf([
  { name: "M101.pdf", size: 1 * MB, folderPath: "Outgoing/Set/M" },
  { name: "E101.pdf", size: 1 * MB, folderPath: "Outgoing/Set/E" },
  { name: "E102.pdf", size: 1 * MB, folderPath: "Outgoing/Set/E" },
]);
eq(byPath.map((f) => f.name).join(","), "E101.pdf,E102.pdf,M101.pdf", "ties break on folderPath then name");

// The paging arithmetic, copied from the handler.
function page(total, offset, fileCap, midFileAt) {
  const start = Math.min(Math.max(offset ?? 0, 0), total);
  let filesConsumed = 0, stoppedMidFile = false;
  for (let i = start; i < total; i++) {
    if (filesConsumed >= fileCap) break;
    filesConsumed++;
    if (midFileAt === i) { stoppedMidFile = true; break; }
  }
  const consumed = filesConsumed - (stoppedMidFile ? 1 : 0);
  return { start, consumed, nextOffset: start + consumed < total ? start + consumed : null };
}
eq(page(68, 0, 8).nextOffset, 8, "a 68-file folder reports where to resume");
eq(page(68, 8, 8).nextOffset, 16, "the second page resumes where the first stopped");
eq(page(68, 64, 8).nextOffset, null, "the last page reports nextOffset null, so 'until null' terminates");
eq(page(68, 999, 8).start, 68, "an offset past the end clamps rather than throwing");
eq(page(68, -5, 8).start, 0, "a negative offset clamps to 0");
// Walking the whole folder must visit every file exactly once.
let seenFiles = 0, off = 0, rounds = 0;
while (off !== null && rounds < 50) { const r = page(68, off, 8); seenFiles += r.consumed; off = r.nextOffset; rounds++; }
eq(seenFiles, 68, "paging start to finish visits all 68 files exactly once");
eq(rounds, 9, "...in 9 rounds of 8");
// A file cut short by the PAGE budget must be re-read, not skipped: its unread
// pages hold sheets, and skipping them loses those sheets with no signal.
eq(page(20, 0, 8, 3).nextOffset, 3, "a file stopped mid-way is the NEXT offset, not the one after it");
eq(page(20, 0, 8, 3).consumed, 3, "...so it is not counted as consumed");

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
has("e.isPartial = e.setTotal ? e.sheets < e.setTotal : null;", "per-discipline partial test");
has("isPartialIssue: rated.length ? partialDisciplines.length > 0 : null,", "unknown-is-not-complete rule");
has("const SHEET_MAX_BYTES = 64 * 1024 * 1024;", "sheet-extraction size cap");
has("Number(isBig(a)) - Number(isBig(b)) ||", "oversized-last ordering");
has("String(a.folderPath).localeCompare(String(b.folderPath)) ||", "the stable path tie-break offset paging depends on");
has("const consumed = () => filesConsumed - (stoppedMidFile ? 1 : 0);", "the mid-file resume rule");
has("nextOffset: start + consumed() < ordered.length ? start + consumed() : null,", "nextOffset arithmetic");
// The whole point of the path-scoped crawl: an exact subfolder must NOT depend
// on the capped whole-project walk. If this call disappears, the SAPX196006.00
// "count: 0 / no files found" failure is back.
has("const sub = await subtreeFiles(numPrefix, subfolder);", "extract_sheet_index resolves the path directly");
has("async function subtreeFiles(", "path-scoped crawl exists");
has("async function listChildren(", "list_project_documents pagination helper exists");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (5 real sheets across 2019 and 2026, 10 drift checks)`);
process.exit(failures ? 1 : 0);
