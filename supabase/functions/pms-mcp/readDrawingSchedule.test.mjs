// Tests for read_drawing_schedule's pure helpers in index.ts (schedule
// extraction — Drawing Intelligence phase 5 slice).
//
//   node supabase/functions/pms-mcp/readDrawingSchedule.test.mjs
//
// The helpers are COPIED below (index.ts boots a server at import). Drift
// anchors at the bottom fail if the shipped source stops matching.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── copies from index.ts ────────────────────────────────────────────────────
const SCHEDULE_TITLE_RE = /\bSCHEDULES?\b/i;
const SCHED_LINE_TOL = 3;
const SCHED_COL_TOL = 6;
const SCHED_GAP_LINES = 3;
const SCHED_MAX_ROWS = 250;

function clusterSheetLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - it.y) <= SCHED_LINE_TOL) line.cells.push(it);
    else lines.push({ y: it.y, cells: [it] });
  }
  for (const l of lines) l.cells.sort((a, b) => a.x - b.x);
  return lines;
}

function extractSheetTables(items, matchFilter) {
  const lines = clusterSheetLines(items);
  const titleIdx = [];
  lines.forEach((l, i) => {
    const text = l.cells.map((c) => c.str).join(" ");
    if (SCHEDULE_TITLE_RE.test(text) && text.length <= 120) titleIdx.push(i);
  });
  const tables = [];
  for (let t = 0; t < titleIdx.length; t++) {
    const start = titleIdx[t];
    const end = titleIdx[t + 1] ?? lines.length;
    const titleLine = lines[start];
    const title = titleLine.cells.map((c) => c.str).join(" ").trim();
    if (matchFilter && !title.toLowerCase().includes(matchFilter.toLowerCase())) continue;
    const titleX = titleLine.cells[0].x;
    let headerCells = null, hIdx = -1;
    for (let i = start + 1; i < end && i - start <= 6; i++) {
      const cand = lines[i].cells.filter((c) => c.x >= titleX - 60);
      if (cand.length >= 3) { headerCells = cand; hIdx = i; break; }
    }
    if (!headerCells) continue;
    const xMin = headerCells[0].x - 20;
    const xMax = headerCells[headerCells.length - 1].x + 400;
    const blockLines = [];
    let gap = 0;
    for (let i = hIdx; i < end; i++) {
      const cells = lines[i].cells.filter((c) => c.x >= xMin && c.x <= xMax);
      if (cells.length >= 2) { blockLines.push(cells); gap = 0; }
      else if (blockLines.length && ++gap >= SCHED_GAP_LINES) break;
    }
    if (blockLines.length < 2) continue;
    const clusters = [];
    blockLines.forEach((cells, li) => {
      for (const c of cells) {
        const hit = clusters.find((cl) => Math.abs(cl.sum / cl.n - c.x) <= SCHED_COL_TOL);
        if (hit) { hit.sum += c.x; hit.n++; hit.lines.add(li); }
        else clusters.push({ sum: c.x, n: 1, lines: new Set([li]) });
      }
    });
    const minLines = Math.max(2, Math.ceil(blockLines.length * 0.3));
    const bounds = clusters.filter((cl) => cl.lines.size >= minLines).map((cl) => cl.sum / cl.n).sort((a, b) => a - b);
    if (bounds.length < 2) continue;
    const rows = blockLines.map((cells) => {
      const row = new Array(bounds.length).fill("");
      for (const c of cells) {
        let k = 0;
        while (k + 1 < bounds.length && bounds[k + 1] <= c.x + SCHED_COL_TOL) k++;
        row[k] = row[k] ? row[k] + " " + c.str : c.str;
      }
      return row;
    });
    tables.push({
      title, columns: bounds.length,
      rows: rows.slice(0, SCHED_MAX_ROWS),
      truncatedRows: Math.max(0, rows.length - SCHED_MAX_ROWS),
    });
  }
  return tables;
}

// ── synthetic sheet builder ─────────────────────────────────────────────────
// A CAD-style fan schedule: title at (100, 700), header row, three data rows,
// columns at x = 100 / 180 / 260 / 340, rows 14pt apart.
const cell = (str, x, y) => ({ str, x, y });
function fanSchedule(x0 = 100, y0 = 700) {
  const cols = [x0, x0 + 80, x0 + 160, x0 + 240];
  const rows = [
    ["TAG", "CFM", "HP", "REMARKS"],
    ["EF-1", "1200", "1/2", "ROOF"],
    ["EF-2", "800", "1/3", "INLINE"],
    ["EF-3", "2500", "1", "PENTHOUSE"],
  ];
  const items = [cell("FAN SCHEDULE", x0, y0)];
  rows.forEach((r, ri) => r.forEach((s, ci) => items.push(cell(s, cols[ci], y0 - 20 - ri * 14))));
  return items;
}

// Basic extraction: title found, 4 columns, header + 3 data rows.
{
  const tables = extractSheetTables(fanSchedule());
  assert.equal(tables.length, 1);
  assert.equal(tables[0].title, "FAN SCHEDULE");
  assert.equal(tables[0].columns, 4);
  assert.equal(tables[0].rows.length, 4);
  assert.deepEqual(tables[0].rows[0], ["TAG", "CFM", "HP", "REMARKS"]);
  assert.deepEqual(tables[0].rows[2], ["EF-2", "800", "1/3", "INLINE"]);
}

// y-jitter within tolerance still reads as one row; jitter beyond it splits.
{
  const items = fanSchedule().map((it) => ({ ...it, y: it.y + (it.x % 3) }));
  const tables = extractSheetTables(items);
  assert.equal(tables[0].rows.length, 4);
}

// A text run the PDF split mid-cell ("PENT" + "HOUSE" at an unaligned x)
// folds into the column to its left instead of minting a phantom column.
{
  const items = fanSchedule().filter((it) => it.str !== "PENTHOUSE");
  items.push(cell("PENT", 340, 700 - 20 - 3 * 14), cell("HOUSE", 362, 700 - 20 - 3 * 14));
  const tables = extractSheetTables(items);
  assert.equal(tables[0].columns, 4);
  assert.equal(tables[0].rows[3][3], "PENT HOUSE");
}

// Plan text far to the side of the schedule does not leak into the rows.
{
  const items = fanSchedule();
  items.push(cell("PROVIDE FLEXIBLE CONNECTION", 1400, 700 - 34));
  const tables = extractSheetTables(items);
  assert.deepEqual(tables[0].rows[1], ["EF-1", "1200", "1/2", "ROOF"]);
}

// Two schedules on one sheet come back separately, and match filters by title.
{
  const items = [...fanSchedule(100, 700), ...fanSchedule(100, 500).map((it) =>
    it.str === "FAN SCHEDULE" ? { ...it, str: "PUMP SCHEDULE" } : it)];
  const both = extractSheetTables(items);
  assert.deepEqual(both.map((t) => t.title), ["FAN SCHEDULE", "PUMP SCHEDULE"]);
  const one = extractSheetTables(items, "pump");
  assert.equal(one.length, 1);
  assert.equal(one[0].title, "PUMP SCHEDULE");
}

// An empty cell stays empty — values do not shift left across the row.
{
  const items = fanSchedule().filter((it) => !(it.str === "800"));
  const tables = extractSheetTables(items);
  assert.deepEqual(tables[0].rows[2], ["EF-2", "", "1/3", "INLINE"]);
}

// A title with no table under it (a note mentioning "SCHEDULE") yields nothing.
{
  const items = [cell("SEE SCHEDULE ON M-601", 100, 700), cell("NOTE 2", 100, 680)];
  assert.equal(extractSheetTables(items).length, 0);
}

// ── drift anchors ───────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf8");
for (const anchor of [
  'mcp.tool("read_drawing_schedule"',
  "const SCHED_LINE_TOL = 3;",
  "const SCHED_COL_TOL = 6;",
  "const SCHED_GAP_LINES = 3;",
  "const SCHED_MAX_ROWS = 250;",
  "function clusterSheetLines",
  "function extractSheetTables",
  // Shared resolver serves both drawing tools.
  "async function resolveIndexedSheet",
  // Null bytes stripped before anything downstream (same 22P05 lesson as the
  // indexer).
  'replace(/\\u0000/g, " ").trim()',
] ) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}
// view_drawing rides the same resolver — both call sites exist.
assert.equal(src.split("resolveIndexedSheet(projectNumber, sheet, revision, set)").length - 1, 2);

console.log("readDrawingSchedule.test.mjs: all assertions passed");
