// Tests for sheetFromDrawingList.ts: numbering the pages of a combined drawing
// book from the book's own drawing list.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  sheetTokenRe, pageCandidates, resolveSheetAssignments, assignSheetsFromList, DRAWING_LIST_LAYOUT,
} from "./sheetFromDrawingList.ts";

const LIST = [
  { sheetNo: "M-001", sheetTitle: "MECHANICAL GENERAL NOTES" },
  { sheetNo: "M-101", sheetTitle: "FIRST FLOOR HVAC PLAN" },
  { sheetNo: "M-102", sheetTitle: "SECOND FLOOR HVAC PLAN" },
  { sheetNo: "M-501", sheetTitle: "MECHANICAL DETAILS" },
  { sheetNo: "M-601", sheetTitle: "MECHANICAL SCHEDULES" },
];
const COVER = "MECHANICAL DRAWING LIST SHEET DRAWING TITLE 1 M-001 MECHANICAL GENERAL NOTES 2 M-101 FIRST FLOOR HVAC PLAN " +
  "3 M-102 SECOND FLOOR HVAC PLAN 4 M-501 MECHANICAL DETAILS 5 M-601 MECHANICAL SCHEDULES";
const page = (n, text) => ({ page: n, text });

test("the number must stand alone", () => {
  const re = sheetTokenRe("M-101");
  assert.ok(re.test("SEE M-101 FOR"));
  assert.ok(re.test("M101"), "the hyphen is optional");
  assert.ok(re.test("M 101"), "or a space");
  assert.ok(!re.test("AM-101"));
  assert.ok(!re.test("M-1010"));
  assert.ok(!re.test("M-101A"), "a lettered sheet is another sheet");
  assert.ok(!re.test("M-101.01"), "so is one with a filing suffix");
  assert.ok(sheetTokenRe("FA001.00").test("FA001.00 FIRE ALARM NOTES"));
  assert.equal(sheetTokenRe("COVER"), null);
});

test("a page with its number and its title is that sheet", () => {
  const out = assignSheetsFromList([
    page(1, COVER),
    page(2, "GENERAL NOTES 1. ALL WORK ... MECHANICAL GENERAL NOTES M-001"),
    page(3, "FIRST FLOOR HVAC PLAN SCALE: 1/8 SEE M-501 FOR DETAILS M-101"),
    page(4, "SECOND FLOOR HVAC PLAN SCALE: 1/8 SEE M-501 FOR DETAILS M-102"),
    page(5, "MECHANICAL DETAILS NOT TO SCALE M-501"),
  ], LIST, [1]);
  assert.deepEqual(out.map((a) => [a.page, a.sheetNo, a.basis]),
    [[2, "M-001", "title"], [3, "M-101", "title"], [4, "M-102", "title"], [5, "M-501", "title"]]);
  assert.equal(out[1].sheetTitle, "FIRST FLOOR HVAC PLAN");
});

test("the cover is never numbered, though it carries every number and title", () => {
  const out = assignSheetsFromList([page(1, COVER), page(2, "MECHANICAL DETAILS M-501"), page(3, "MECHANICAL SCHEDULES M-601")], LIST, [1]);
  assert.deepEqual(out.map((a) => a.page), [2, 3]);
});

test("a reference to another sheet does not number the page", () => {
  // Page 3 is a riser diagram whose own number is not in the list; it only
  // says "SEE M-601". The schedules page carries the title, so it wins and
  // page 3 stays unnumbered.
  const out = assignSheetsFromList([
    page(1, COVER),
    page(2, "MECHANICAL GENERAL NOTES M-001"),
    page(3, "RISER DIAGRAM SEE M-601 FOR EQUIPMENT"),
    page(4, "MECHANICAL SCHEDULES M-601"),
  ], LIST, [1]);
  assert.deepEqual(out.map((a) => [a.page, a.sheetNo]), [[2, "M-001"], [4, "M-601"]]);
});

test("without a title, the number counts only where the book's order agrees", () => {
  const untitled = (n, no) => page(n, "PLAN SCALE: 1/8 " + no);
  const inOrder = assignSheetsFromList(
    [page(1, COVER), untitled(2, "M-001"), untitled(3, "M-101"), untitled(4, "M-102"), untitled(5, "M-501")], LIST, [1]);
  assert.deepEqual(inOrder.map((a) => [a.sheetNo, a.basis]), [["M-001", "order"], ["M-101", "order"], ["M-102", "order"], ["M-501", "order"]]);
  // The same numbers on pages in no order are references, not title blocks.
  const shuffled = assignSheetsFromList(
    [page(1, COVER), untitled(2, "M-501"), untitled(3, "M-001"), untitled(4, "M-102"), untitled(5, "M-101")], LIST, [1]);
  assert.equal(shuffled.length, 0);
  // One page out of place is dropped; the run around it stands.
  const one = assignSheetsFromList(
    [page(1, COVER), untitled(2, "M-001"), untitled(3, "M-601"), untitled(4, "M-101"), untitled(5, "M-102"), untitled(6, "M-501")], LIST, [1]);
  assert.deepEqual(one.map((a) => a.sheetNo), ["M-001", "M-101", "M-102", "M-501"]);
});

test("a title that fits two pages settles neither", () => {
  const out = assignSheetsFromList([
    page(1, COVER), page(2, "MECHANICAL DETAILS M-501"), page(3, "MECHANICAL DETAILS M-501 CONTINUED"),
  ], LIST, [1]);
  assert.equal(out.length, 0);
});

test("a list printed twice does not make each sheet its own rival", () => {
  const out = assignSheetsFromList(
    [page(1, COVER), page(2, "MECHANICAL DETAILS M-501"), page(3, "MECHANICAL SCHEDULES M-601")], [...LIST, ...LIST], [1]);
  assert.deepEqual(out.map((a) => a.sheetNo), ["M-501", "M-601"]);
});

test("too short a list, or a single page, numbers nothing", () => {
  assert.equal(assignSheetsFromList([page(1, "x"), page(2, "MECHANICAL DETAILS M-501")], LIST.slice(0, 2), [1]).length, 0);
  assert.equal(resolveSheetAssignments([{ page: 2, cands: [0], titled: [0] }], 5).length, 0);
  assert.equal(assignSheetsFromList([], null, []).length, 0);
});

test("pageCandidates reports the numbers and the titled ones", () => {
  const c = pageCandidates(3, "FIRST FLOOR HVAC PLAN SEE M-501 M-101", LIST);
  assert.deepEqual(c, { page: 3, cands: [1, 3], titled: [1] });
});

// The pages whose title blocks parseTitleBlock DOES read (13 files, 3
// projects, 2026-11-24), reduced to what the rule sees: per page, the list
// rows whose number is on it ("t" = with the title) and the row the title
// block says it is ("?" = not parsed). Nothing of the drawings themselves.
const REAL = [
  {"n": 22, "pages": "2:?:1t,2,4 3:?:1,2t 4:?:3t,4 5:?:1,3,4t 6:?:5t,6 7:?:5,6t 8:?:7t 9:?:8t,11,15 10:?:9t,15 11:?:10t,11 12:?:8,10,11t 13:?:12t 14:?:13t 15:?:14t 16:15:9,15t 17:?: 18:?: 19:?:17t 20:?:18t 21:?:19t 22:?:20 23:?:21"},
  {"n": 8, "pages": "2:1:0,1t,5 3:2:0,2t,5 4:3:0,3t,5 5:4:4t 6:5: 7:6: 8:7:"},
  {"n": 54, "pages": "2:1:1t,2,3 3:2:2t 4:3:3t 5:4:4t,14,26,27,28,30,31 6:5:5t,26,27,28,29 7:6:6t,26,27,28,29 8:7:7t,26,27,28,29 9:8:8t 10:9:9t,14,26,27,28,29,30 11:10:10t,26,27,28,29 12:11:11t,26,27,28,29 13:12:12t,26,27,28,29 14:13:13t 15:14:4,9,14t 16:15:15t,25,26,27,28,30,31 17:16:16t,26,27,28,29 18:17:17t,26,27,28,29 19:18:18t,26,27,28,29 20:19:19t 21:20:20t,25,26,27,28,29,30 22:21:21t,26,27,28,29 23:22:22t,26,27,28,29 24:23:23t,26,27,28,29 25:24:24t 26:25:15,20,25t 27:26:26t 28:27:27t 29:28:28t 30:29:29t 31:30:30t 32:31:1,31t 33:32:32t 34:33:33t 35:34:34t 36:35:35t,36 37:36:35,36t 38:37:3,37t,38,46 39:38:37,38t 40:39:39t 41:40:40t,49,50,51,52,53 42:41:41t,50,51 43:42:42t 44:43:43t 45:44:44t 46:45:45t 47:46:46t 48:47:44t,47t 49:48:0,48t 50:49:49t 51:50:50t 52:51:51t 53:52:52t 54:53:53"},
  {"n": 7, "pages": "2:1:1t 3:2:2t 4:3:3t 5:4:4t 6:5:5t,6 7:6:"},
  {"n": 6, "pages": "2:1:1t 3:2:2t 4:3:3t 5:4:4t 6:5:5t"},
  {"n": 19, "pages": "2:1:0,1t 3:2:0,2t 4:3:0,3t 5:?:4t 6:?:5t 7:6:6t 8:7:7t 9:8:8t 10:9:9t 11:10: 12:11: 13:12: 14:13: 15:14: 16:15:15t 17:16:16t 18:17: 19:18:"},
  {"n": 7, "pages": "2:1:1t 3:2:2t 4:3:3t 5:4:4t 6:5:5t,6 7:6:"},
  {"n": 7, "pages": "2:1:1t 3:2:2t 4:3:3t 5:4:4t 6:5:5t 7:6:"},
  {"n": 10, "pages": "2:1:0,1t 3:2:0,2t 4:3:0,3t 5:4:0,4t 6:5:5t 7:6:5 8:7:5 9:8: 10:9:9t"},
  {"n": 10, "pages": "2:1:1t 3:2:2t,3,5 4:3:3t,5 5:4:4t 6:5:5t 7:6:6t,7t 8:7:9 9:8: 10:9:9t"},
  {"n": 26, "pages": "2:?:1 3:1:1t,11,12,13,14,25 4:2:2t,12,13,14 5:3:3t,12,13,14 6:4:4t,12,13,14 7:5:5 8:?:6 9:6:6t,11,12,13,14 10:7:7t,12,13,14 11:8:8t,12,13,14 12:9:9t,12,13,14 13:10:10 14:?:1,6,11t 15:11:1,6,11t 16:12:1,6,12t,25 17:13:1,6,13t 18:14:1,6,14t,25 19:15:15t,16t,18,25 20:16:15t,16t,17t,18 21:17:16t,17t,18,25 22:18:18t 23:19:19t,21,25 24:20:20t,21,25 25:21:21t 26:22:22t 27:23:23t 28:24:24t 29:25:25"},
  {"n": 54, "pages": "2:5:5t,26,27,28,29 3:7:7t,26,27,28,29 4:8:8t 5:10:10t,26,27,28,29 6:12:12t,26,27,28,29 7:13:13t 8:16:16t,26,27,28,29 9:17:17t,26,27,28,29 10:18:18t,26,27,28,29 11:19:19t,40 12:21:21t,26,27,28,29 13:22:22t,26,27,28,29 14:23:23t,26,27,28,29 15:24:24t,40 16:33:33t 17:34:34t 18:40:40t,49,50,51,52,53 19:51:51t"},
  {"n": 19, "pages": "2:1:0,1t 3:2:0,2t 4:3:0,3t 5:?:4t 6:?:5t 7:6:6t 8:7:7t 9:8:8t 10:9:9t 11:10: 12:11: 13:12: 14:13: 15:14: 16:15:15t 17:16:16t 18:17: 19:18:"}
];
test("on real books with known sheet numbers it is never wrong", () => {
  let known = 0, right = 0, wrong = 0;
  for (const f of REAL) {
    const pages = f.pages.split(" ").map((s) => {
      const [pg, truth, cs] = s.split(":");
      const parts = (cs || "").split(",").filter(Boolean);
      return { page: +pg, truth: truth === "?" ? null : +truth, cands: parts.map((x) => parseInt(x)), titled: parts.filter((x) => x.endsWith("t")).map((x) => parseInt(x)) };
    });
    const out = new Map(resolveSheetAssignments(pages, f.n).map((a) => [a.page, a.index]));
    for (const p of pages) {
      if (p.truth === null) continue;
      known++;
      if (!out.has(p.page)) continue;
      if (out.get(p.page) === p.truth) right++; else wrong++;
    }
  }
  assert.equal(wrong, 0, "a wrong sheet number is worse than none");
  assert.equal(known, 177);
  assert.ok(right >= 140, "at least 140 of the 177 known pages are numbered (was 146): " + right);
});

test("the connector runs this rule and only fills empty rows", () => {
  const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.equal(DRAWING_LIST_LAYOUT, "drawing-list.1");
  assert.ok(shipped.includes('"&sheet_no=is.null&select=page"'), "a sheet number read off a title block is never overwritten");
  assert.ok(shipped.includes("title_block_layout: DRAWING_LIST_LAYOUT,"), "rows it fills are stamped, so they can be found and undone");
  assert.ok(shipped.includes('{ sheets_rule: DRAWING_LIST_LAYOUT }'), "a file is marked done under the rule's name");
  const mig = readFileSync(new URL("../../migrations/20261124110000_drawing_index_sheets_rule.sql", import.meta.url), "utf8");
  assert.ok(mig.includes("add column if not exists sheets_rule text"));
});
