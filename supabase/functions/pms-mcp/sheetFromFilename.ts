// A sheet number read from the FILE NAME, confirmed by the page text
// (2026-11-13).
//
// parseTitleBlock (index.ts) reads a title block by the ORDER of its fields in
// the page text. AutoCAD-plotted sheets emit text in draw order, not reading
// order, so that order changes from sheet to sheet inside one set. On Q126
// (SAPQ236917.01) the DOB-NOW pattern reads the plumbing sheets
//
//   P101.00 03 of 05 PLUMBING FLOOR PLANS DOB NOW Job# Q0120856-S2
//
// and none of the electrical or architectural ones
//
//   E101.00 ELECTRICAL CLASSROOM PLANS Block 553 Lot 1 … 4 E101.00 12 of 19 -
//   AD101.00 DEMOLITION PLANS SCALE: ROOM 301 CEILING REMOVALS PLAN …
//
// so 19 of the 21 individually-issued sheets indexed with no sheet number and
// view_drawing could not open them by number.
//
// A single-sheet PDF named for its sheet ("E101.00.pdf") is the firm's own
// convention for issued sets. When that number ALSO appears in the page text,
// two independent sources agree and the number is safe to record. Both halves
// are required, and each guards a real failure:
//
//   - whole-stem only: "E101 - POWER PLAN.pdf" may be anything, and a combined
//     book is never named for one sheet;
//   - one page only: a multi-page file holds several sheets, and the name can
//     describe at most one of them;
//   - text confirmation: a misnamed or re-used file ("E101.00.pdf" holding a
//     different sheet) yields nothing rather than a wrong number. A wrong sheet
//     number is worse than none.
//
// Combined books stay unparsed on these templates. No text pattern is safe for
// them: one anchored on "Block NNN Lot N" labels the Q126 drawing-list sheet
// (T002.00) as A102.00, because the list row "A102.00 NEW WORK PLANS 5" sits
// directly before the block/lot stamp. Pure; see sheetFromFilename.test.mjs.

// The whole stem must BE a sheet number: discipline prefix, number, optional
// DOB-NOW filing suffix. Same shape as SHEET_NO_RE in currentSet.ts.
const STEM_RE = /^([A-Z]{1,3})[-_ ]?(\d{2,4}[A-Z]?)(\.\d{1,2})?$/;

// What may end a title in the page text. Titles are ALL CAPS on these sheets;
// the first of these after one is where the title block moves on.
const TITLE_END = "(?:Block\\s+\\d|SCALE\\s*:|\\d{1,3}\\s+of\\s+\\d|DOB\\s+NOW|$)";

export type FilenameSheet = { sheetNo: string; discipline: string; sheetTitle: string | null };

// The sheet number a file name states, or null when the name is anything else.
export function filenameSheetNo(fileName: string | null | undefined): { sheetNo: string; discipline: string; prefix: string; number: string; suffix: string } | null {
  const stem = String(fileName || "").replace(/\.pdf$/i, "").toUpperCase().trim();
  const m = STEM_RE.exec(stem);
  if (!m) return null;
  const suffix = m[3] || "";
  return { sheetNo: m[1] + m[2] + suffix, discipline: m[1], prefix: m[1], number: m[2], suffix };
}

export function sheetFromFilename(
  fileName: string | null | undefined, pageText: string | null | undefined, totalPages: number,
): FilenameSheet | null {
  if (Number(totalPages) !== 1) return null;
  const fn = filenameSheetNo(fileName);
  if (!fn) return null;
  const text = String(pageText || "");
  if (text.length < 50) return null;
  // The number as the sheet prints it: the prefix and digits may be split by a
  // hyphen or a space ("ED-101.00"), and it must stand alone, so "E101.00"
  // is not found inside "FE101.00" or "E101.001".
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = `(?<![A-Za-z0-9.])${esc(fn.prefix)}[-\\s]?${esc(fn.number)}${esc(fn.suffix)}(?![0-9])`;
  if (!new RegExp(token).test(text)) return null;
  // The title is the ALL-CAPS run straight after the number, up to a known
  // title-block boundary. Detail bubbles ("1 E101.00 SCALE: …") and the set
  // position ("E101.00 12 of 19") start with a boundary and yield no title.
  let sheetTitle: string | null = null;
  const titled = new RegExp(`${token}\\s+([A-Z][A-Z0-9 \\-,&/'".()]{3,80}?)\\s+${TITLE_END}`, "g");
  for (const m of text.matchAll(titled)) {
    const t = m[1].replace(/\s+/g, " ").trim();
    // A title has words in it; a stray label or count does not.
    // Nor does it name another sheet: that is a drawing-list row running on.
    if (/[A-Z]{3,}/.test(t) && !/^(SCALE|FOR|AND|TO|PER|SEE|REFER)\b/.test(t) && !/\b[A-Z]{1,3}-?\d{2,4}\b/.test(t)) { sheetTitle = t; break; }
  }
  return { sheetNo: fn.sheetNo, discipline: fn.discipline, sheetTitle };
}
