// Sheet numbers for the pages of a COMBINED drawing book, from the book's own
// drawing list (2026-11-24).
//
// parseTitleBlock (index.ts) reads a title block by a pattern written for one
// architect's template, and three projects' templates are all it knows. Every
// other combined book indexed with no sheet number on any page: about 10,800
// of 11,800 indexed drawing pages, so view_drawing and read_drawing_schedule
// could not open those sheets by number and search_drawings could not group
// its hits by sheet.
//
// The drawing list on the cover does generalise (see parseDrawingList), and it
// states the whole book: every sheet's number and title, in order. A page is
// recorded as a sheet of that list only when TWO things agree, because a sheet
// number alone is also how one sheet refers to another ("SEE M-201"):
//
//   number + title   the page carries the sheet's number and its title; or
//   number + order   the page carries the number, no other page can be that
//                    sheet, and the page sits where the list says it should
//                    (the pages so numbered run in list order).
//
// Checked against the 178 pages whose title blocks DO parse: the number alone
// picked the wrong sheet on 3 of the 81 pages it was the only candidate for,
// which is what the second condition is for. A page that fails both stays
// unnumbered. A wrong sheet number is worse than none.
//
// Pure; see sheetFromDrawingList.test.mjs.

// The number changes when the RULES change, so files read under an older rule
// are read again (pms_drawing_index_files.sheets_rule). .2: part suffixes.
// .3: sheets numbered by floor and decimal ("M0.1", "MD1.0").
export const DRAWING_LIST_LAYOUT = "drawing-list.3";

export type ListEntry = { sheetNo: string; sheetTitle: string };
export type PageCandidates = { page: number; cands: number[]; titled: number[] };
export type SheetAssignment = { page: number; index: number; basis: "title" | "order" };

const MIN_LIST = 3;
const MIN_TITLE_CHARS = 6;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The number as a sheet prints it: prefix and digits may be split by a hyphen
// or a space, and it must stand alone ("E101" is not found in "FE101",
// "E1010", "E101A", "E101.00" or "E101-A").
export function sheetTokenRe(sheetNo: string): RegExp | null {
  const m = /^([A-Z]{1,4})-?(\d{1,4})(\.\d{1,2})?([A-Z]?)(?:-([A-Z0-9]{1,2}))?$/.exec(String(sheetNo || "").toUpperCase().trim());
  if (!m) return null;
  // A part suffix ("E101-A"): required when the list row has one, and its
  // absence required when it has none, so "E101" is not found in "E101-A".
  const part = m[5] ? `-?${esc(m[5])}` : "";
  // The letter after the number in either case: a list row "E2.3a" is the
  // sheet whose title block prints "E2.3A", and the other way round.
  const letter = m[4] ? `[${m[4]}${m[4].toLowerCase()}]` : "";
  return new RegExp(`(?<![A-Za-z0-9.])${esc(m[1])}[-\\s]?${esc(m[2])}${esc(m[3] || "")}${letter}${part}` +
    `(?![A-Za-z0-9]|\\.\\d|-[A-Z0-9]{1,2}(?![A-Za-z0-9]))`);
}

const normTitle = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

// Which list entries a page's text could be: `cands` carry the number,
// `titled` carry the number and the title.
export function pageCandidates(page: number, text: string, list: ListEntry[]): PageCandidates {
  const raw = String(text || "");
  const flat = " " + normTitle(raw) + " ";
  const cands: number[] = [], titled: number[] = [];
  list.forEach((e, i) => {
    const re = sheetTokenRe(e.sheetNo);
    if (!re || !re.test(raw)) return;
    cands.push(i);
    const t = normTitle(e.sheetTitle);
    if (t.length >= MIN_TITLE_CHARS && flat.includes(" " + t + " ")) titled.push(i);
  });
  return { page, cands, titled };
}

// Indices of a longest strictly increasing run of `vals` (patience sorting).
function longestIncreasing(vals: number[]): Set<number> {
  const tails: number[] = [], prev: number[] = new Array(vals.length).fill(-1);
  for (let i = 0; i < vals.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[tails[mid]] < vals[i]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) keep.add(k);
  return keep;
}

export function resolveSheetAssignments(pages: PageCandidates[], listLength: number): SheetAssignment[] {
  if (listLength < MIN_LIST || pages.length < 2) return [];
  const byPage = new Map<number, SheetAssignment>();
  const taken = new Set<number>();

  // 1. number + title. A title that fits two pages (a sheet printed twice, or
  //    a title as plain as "DETAILS") settles neither.
  const titleClaims = new Map<number, number[]>();
  for (const p of pages) {
    if (p.titled.length !== 1) continue;
    const i = p.titled[0];
    titleClaims.set(i, [...(titleClaims.get(i) ?? []), p.page]);
  }
  for (const [i, claimants] of titleClaims) {
    if (claimants.length !== 1) continue;
    byPage.set(claimants[0], { page: claimants[0], index: i, basis: "title" });
    taken.add(i);
  }

  // 2. number alone, by elimination: a page left with one candidate that no
  //    other open page shares. Repeats, since each one settled frees others.
  const tentative = new Map<number, number>();
  for (let round = 0; round < 6; round++) {
    const open = pages.filter((p) => !byPage.has(p.page) && !tentative.has(p.page))
      .map((p) => ({ page: p.page, left: p.cands.filter((i) => !taken.has(i)) }));
    const claims = new Map<number, number>();
    for (const o of open) for (const i of o.left) claims.set(i, (claims.get(i) ?? 0) + 1);
    const settled = open.filter((o) => o.left.length === 1 && claims.get(o.left[0]) === 1);
    if (!settled.length) break;
    for (const o of settled) { tentative.set(o.page, o.left[0]); taken.add(o.left[0]); }
  }

  // 3. ...kept only where the book's order agrees. Title-confirmed pages are
  //    part of the run, so a stray reference between two of them falls out.
  const seq = [...byPage.values(), ...[...tentative].map(([page, index]) => ({ page, index, basis: "order" as const }))]
    .sort((a, b) => a.page - b.page);
  const run = longestIncreasing(seq.map((s) => s.index));
  const inOrder = run.size >= MIN_LIST && run.size >= Math.ceil(seq.length * 0.6);
  return seq.filter((s, k) => s.basis === "title" || (inOrder && run.has(k)));
}

// The whole step for one file: its pages' text and the rows of its drawing
// list. `listPages` are the pages the list was read from; they are never
// numbered here (the cover carries every sheet's number and title).
export function assignSheetsFromList(
  pages: Array<{ page: number; text: string }>, list: ListEntry[], listPages: Iterable<number>,
): Array<{ page: number; sheetNo: string; sheetTitle: string; basis: "title" | "order" }> {
  // One row per sheet: a list printed twice (cover and discipline cover) must
  // not make every sheet its own rival.
  const seen = new Set<string>();
  const rows = (Array.isArray(list) ? list : []).filter((e) => {
    const k = String(e?.sheetNo || "").toUpperCase().replace(/[-\s]/g, "");
    if (!k || seen.has(k) || !sheetTokenRe(e.sheetNo)) return false;
    seen.add(k);
    return true;
  });
  const skip = new Set(listPages);
  const cands = pages.filter((p) => !skip.has(p.page)).map((p) => pageCandidates(p.page, p.text, rows));
  return resolveSheetAssignments(cands, rows.length).map((a) => ({
    page: a.page, sheetNo: rows[a.index].sheetNo, sheetTitle: rows[a.index].sheetTitle, basis: a.basis,
  }));
}
