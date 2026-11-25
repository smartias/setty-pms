// Tests for read_drawing_schedule's schedule extraction (scheduleExtract.ts).
//
//   node supabase/functions/pms-mcp/readDrawingSchedule.test.mjs
//
// The module is pure, so it is imported directly.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractSheetTables, clusterSheetLines, orientSheetItems, PANEL_TITLE_RE } from "./scheduleExtract.ts";


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


// ── Real-sheet behaviour (Tabler 100% CD set, 2026-11-16) ───────────────────
// pdf.js text runs: a string, a transform [a,b,c,d,e,f] and a width.
const run = (str, e, f, width, rot = 0) => ({ str, width, transform: rot === 90 ? [0, 10, -10, 0, e, f] : [10, 0, 0, 10, e, f] });
const W = (s) => s.length * 5;

// A landscape sheet stored as a portrait page with /Rotate 90: every run's
// transform is turned a quarter turn. Upright, the fan schedule reads as rows.
{
  const cols = [100, 160, 240, 420, 470];
  const rows = [
    ["TAG", "LOCATION", "SERVICE", "CFM", "HP"],
    ["EF-1", "ROOF", "LAUNDRY-EAST WING", "2000", "0.59"],
    ["EF-2", "ROOF", "LAUNDRY-WEST WING", "2000", "0.59"],
    ["EF-3", "MER", "RECYCLE", "200", "0.25"],
  ];
  // Upright position (x, y) is stored at e = -y, f = x on the rotated page.
  const at = (s, x, y) => run(s, -y, x, W(s), 90);
  const raw = [at("FAN SCHEDULE", 250, 700)];
  rows.forEach((r, ri) => r.forEach((s, ci) => raw.push(at(s, cols[ci], 680 - ri * 14))));
  raw.push(run("SHEET STAMP", 900, 300, 60, 0)); // a run in another direction is dropped
  raw.push({ str: "\u0000", transform: [0, 10, -10, 0, 0, 0], width: 5 });
  const items = orientSheetItems(raw);
  assert.equal(items.some((i) => i.str === "SHEET STAMP"), false);
  assert.equal(items.length, 21);
  const tables = extractSheetTables(items);
  assert.equal(tables.length, 1);
  // The title is centred, so the tag column sits well to its left and must still be read.
  assert.deepEqual(tables[0].rows[0], ["TAG", "LOCATION", "SERVICE", "CFM", "HP"]);
  assert.deepEqual(tables[0].rows[3], ["EF-3", "MER", "RECYCLE", "200", "0.25"]);
}

// An upright page is left as it is.
{
  const items = orientSheetItems([run("A", 10, 20, 5), run("B", 30, 20, 5)]);
  assert.deepEqual(items.map((i) => [i.str, i.x, i.y]), [["A", 10, 20], ["B", 30, 20]]);
  assert.deepEqual(orientSheetItems([]), []);
}

// Two panel schedules side by side, titled "Branch Panel: X". Each comes back
// on its own with its ratings as details and its circuits as rows; the
// right-aligned kVA figures, whose starts wander, still land in one column.
{
  const panel = (name, x0, kva) => {
    const r = [run("Branch Panel: " + name, x0 + 40, 760, 120)];
    r.push(run("Supply From:", x0 + 60, 740, 55), run("DP2A", x0 + 120, 740, 20), run("Mains Rating:", x0 + 300, 740, 60), run("400 A", x0 + 365, 740, 25));
    const head = [["CKT", 0], ["Circuit Description", 40], ["Trip", 200], ["Poles", 240], ["A[KVA]", 290]];
    head.forEach(([s, dx]) => r.push(run(s, x0 + dx, 700, W(s))));
    kva.forEach(([ckt, desc, v], i) => {
      const y = 686 - i * 14;
      r.push(run(String(ckt), x0 + 6, y, 5), run(desc, x0 + 40, y, W(desc)), run("20 A", x0 + 200, y, 20), run("1", x0 + 250, y, 5));
      r.push(run(v, x0 + 320 - W(v), y, W(v))); // right-aligned
    });
    return r;
  };
  const raw = [
    ...panel("RP1A", 0, [[1, "LTG STOR. 1-112", "0.44"], [3, "LTG CORRIDOR 1-100", "12.50"], [5, "REC ROOM 1-104", "1.2"], [7, "EXTERIOR LTS", "0.03"]]),
    ...panel("RP1B", 900, [[1, "LTG STAIR", "0.20"], [3, "LTG STAIR 2-399", "0.61"], [5, "REC CORRIDOR", "10.00"], [7, "SPARE", "0"]]),
  ];
  const tables = extractSheetTables(orientSheetItems(raw));
  assert.deepEqual(tables.map((t) => t.title), ["Branch Panel: RP1A", "Branch Panel: RP1B"]);
  assert.deepEqual(tables[0].details, ["Supply From: DP2A Mains Rating: 400 A"]);
  assert.deepEqual(tables[0].rows[0], ["CKT", "Circuit Description", "Trip", "Poles", "A[KVA]"]);
  assert.deepEqual(tables[0].rows[2], ["3", "LTG CORRIDOR 1-100", "20 A", "1", "12.50"]);
  assert.deepEqual(tables[1].rows[3], ["5", "REC CORRIDOR", "20 A", "1", "10.00"]);
  // Nothing from RP1B leaks into RP1A.
  assert.ok(!JSON.stringify(tables[0].rows).includes("LTG STAIR"));
  assert.equal(extractSheetTables(orientSheetItems(raw), "rp1b").length, 1);
}

// Panel titles need the colon: a totals line or a note naming a panel is not one.
{
  for (const s of ["Branch Panel: RP1A", "PANELBOARD: PXXXX", "Distribution Panel: DP2A", "Switchboard: MSB"]) assert.ok(PANEL_TITLE_RE.test(s), s);
  for (const s of ["PANEL TOTALS", "PANEL DP2B", "Panel Totals", "SEE PANEL SCHEDULE"]) assert.ok(!PANEL_TITLE_RE.test(s), s);
}

// Notes printed under a schedule are returned as notes, not as rows, and do
// not blur the columns above them.
{
  const cols = [100, 170, 260, 330];
  const rows = [["TAG", "GPM", "HEAD", "HP"], ["P-1", "205", "60", "7.5"], ["P-2", "205", "60", "7.5"], ["P-3", "83", "45", "3"]];
  const raw = [run("PUMP SCHEDULE", 180, 700, 80)];
  rows.forEach((r, ri) => r.forEach((s, ci) => raw.push(run(s, cols[ci], 680 - ri * 14, W(s)))));
  raw.push(run("1.", 100, 624, 8), run("PROVIDE VFD FOR EACH PUMP AND COORDINATE WITH ELECTRICAL.", 115, 624, 250));
  raw.push(run("2.", 100, 610, 8), run("SEE FLOW DIAGRAM FOR CONTROL.", 115, 610, 140));
  const [t] = extractSheetTables(orientSheetItems(raw));
  assert.equal(t.rows.length, 4);
  assert.deepEqual(t.rows[3], ["P-3", "83", "45", "3"]);
  assert.deepEqual(t.notes, ["1. PROVIDE VFD FOR EACH PUMP AND COORDINATE WITH ELECTRICAL.", "2. SEE FLOW DIAGRAM FOR CONTROL."]);
}

// Two equipment schedules side by side at the same height stay separate.
{
  const sched = (title, x0, tag) => {
    const r = [run(title, x0 + 60, 700, W(title))];
    [["TAG", "CFM", "HP"], [tag + "-1", "1200", "1"], [tag + "-2", "800", "2"], [tag + "-3", "400", "3"]]
      .forEach((row, ri) => row.forEach((s, ci) => r.push(run(s, x0 + ci * 70, 680 - ri * 14, W(s)))));
    return r;
  };
  const tables = extractSheetTables(orientSheetItems([...sched("FAN SCHEDULE", 100, "EF"), ...sched("PUMP SCHEDULE", 500, "P")]));
  assert.deepEqual(tables.map((t) => t.title), ["FAN SCHEDULE", "PUMP SCHEDULE"]);
  assert.deepEqual(tables[0].rows[1], ["EF-1", "1200", "1"]);
  assert.deepEqual(tables[1].rows[3], ["P-3", "400", "3"]);
}

// Two schedules packed tightly: the gutter between them is narrower than the
// gap after the right-hand table's short tags, so its tag column sits nearer
// the left-hand table. The "UNIT TAG" heading puts it back where it belongs.
{
  const raw = [run("FAN SCHEDULE", 140, 700, 60), run("PUMP SCHEDULE", 400, 700, 65)];
  [["TAG", "CFM", "REMARKS"], ["EF-1", "1200", "SEE NOTE 1 AND NOTE 2"], ["EF-2", "800", "SEE NOTE 1 AND NOTE 2"], ["EF-3", "400", "SEE NOTE 1 AND NOTE 2"]]
    .forEach((row, ri) => row.forEach((s, ci) => raw.push(run(s, [100, 135, 165][ci], 680 - ri * 14, W(s)))));
  // Pump tags start 12pt after the fan REMARKS text ends, then 45pt of clear paper.
  [["UNIT TAG", "SERVICE", "GPM", "HP"], ["P-1", "CHILLED WATER LOOP", "300", "10"], ["P-2", "CHILLED WATER LOOP", "300", "10"], ["P-3", "HOT WATER LOOP", "205", "5"]]
    .forEach((row, ri) => row.forEach((s, ci) => raw.push(run(s, [282, 365, 470, 500][ci], 680 - ri * 14, W(s)))));
  const tables = extractSheetTables(orientSheetItems(raw));
  const pump = tables.find((t) => t.title === "PUMP SCHEDULE");
  assert.deepEqual(pump.rows[0], ["UNIT TAG", "SERVICE", "GPM", "HP"]);
  assert.deepEqual(pump.rows[2], ["P-2", "CHILLED WATER LOOP", "300", "10"]);
  // The fan table keeps its own three columns (it also shows the pump tags that
  // sit against its last column; a known limit when two tables nearly touch).
  assert.deepEqual(tables.find((t) => t.title === "FAN SCHEDULE").rows[1].slice(0, 3), ["EF-1", "1200", "SEE NOTE 1 AND NOTE 2"]);
}

// Panels printed side by side rarely share row heights, and their titles are
// rarely level. Found on Tabler E603-E612: the rows of the panel beside one
// made empty lines between this panel's rows, so it ended after one circuit;
// and two titles 45 pt apart were taken for one panel and spliced together.
// Each panel also ends at its circuits: the "Load Classification" block under
// it has other columns and comes back as loadSummary, one string per line.
{
  const panel = (name, x0, y0, ckts, footer = false) => {
    const r = [run("Branch Panel: " + name, x0 + 40, y0, 120)];
    const head = [["CKT", 0], ["Circuit Description", 40], ["Trip", 200], ["Poles", 240]];
    head.forEach(([s, dx]) => r.push(run(s, x0 + dx, y0 - 40, W(s))));
    ckts.forEach((desc, i) => {
      const y = y0 - 54 - i * 14;
      r.push(run(String(2 * i + 1), x0 + 6, y, 5), run(desc, x0 + 40, y, W(desc)), run("20 A", x0 + 200, y, 20), run("1", x0 + 250, y, 5));
    });
    if (footer) {
      const y = y0 - 54 - ckts.length * 14 - 10;
      r.push(run("Load Classification", x0, y, 95), run("Connected Load", x0 + 120, y, 75), run("Demand Factor", x0 + 230, y, 70));
      r.push(run("Lighting", x0, y - 14, 40), run("3.2 kVA", x0 + 120, y - 14, 35), run("125.00%", x0 + 230, y - 14, 40));
      r.push(run("Receptacle", x0, y - 28, 50), run("6.1 kVA", x0 + 120, y - 28, 35), run("100.00%", x0 + 230, y - 28, 40));
    }
    return r;
  };
  const left = ["LTG 1-100", "LTG 1-102", "REC 1-104", "REC 1-106", "SPARE"];
  const right = ["EM LTG STAIR", "EM LTG CORR", "EXIT SIGNS", "SPARE"];
  // Right-hand title 45 pt lower, so its rows fall 3 pt + 3 pitches off the left grid.
  const raw = [...panel("EM1B", 0, 760, left, true), ...panel("EL1B", 900, 715, right, true)];
  const tables = extractSheetTables(orientSheetItems(raw));
  assert.deepEqual(tables.map((t) => t.title), ["Branch Panel: EM1B", "Branch Panel: EL1B"]);
  const [a, b] = tables;
  assert.deepEqual(a.rows[0], ["CKT", "Circuit Description", "Trip", "Poles"]);
  assert.equal(a.rows.length, 1 + left.length, "every circuit of EM1B, not just the first");
  assert.equal(b.rows.length, 1 + right.length, "every circuit of EL1B");
  assert.deepEqual(a.rows[5], ["9", "SPARE", "20 A", "1"]);
  assert.deepEqual(b.rows[3], ["5", "EXIT SIGNS", "20 A", "1"]);
  // Neither panel's columns or rows take in the other's.
  assert.equal(a.rows[0].length, 4);
  assert.ok(!JSON.stringify(a).includes("EXIT SIGNS"));
  assert.ok(!JSON.stringify(b).includes("REC 1-104"));
  // The load table is not circuits; it is kept as printed.
  assert.ok(!JSON.stringify(a.rows).includes("Load Classification"));
  assert.equal(a.loadSummary[0].replace(/\s+/g, " "), "Load Classification Connected Load Demand Factor");
  assert.ok(a.loadSummary.some((l) => l.includes("Receptacle") && l.includes("6.1 kVA")));
  assert.ok(!a.loadSummary.some((l) => l.includes("EM LTG")));
}

// A schedule whose rows are interleaved with blank lines (another table's
// rows beside it) still reads to its last row; a real gap ends it.
{
  const raw = [run("PUMP SCHEDULE", 100, 700, 80)];
  [["TAG", "GPM", "HP"], ["P-1", "205", "7.5"], ["P-2", "83", "3"], ["P-3", "40", "1"]].forEach((r, ri) => r.forEach((s, ci) => raw.push(run(s, [100, 180, 260][ci], 680 - ri * 14, W(s)))));
  // Something beside it on every half-row, outside its columns.
  for (let i = 0; i < 4; i++) raw.push(run("X" + i, 600, 673 - i * 14, 10));
  // Unrelated text far below.
  raw.push(run("GENERAL NOTE", 100, 500, 60));
  const pump = extractSheetTables(orientSheetItems(raw)).find((t) => t.title === "PUMP SCHEDULE");
  assert.equal(pump.rows.length, 4);
  assert.ok(!JSON.stringify(pump).includes("GENERAL NOTE"));
}

// A panel prints one phase heading over two loads: the left-hand circuit's
// and the right-hand circuit's. Its "Total Load" lines run across both, and
// used to bridge the clear paper between them, so the two loads came back
// in one cell ("63.39 55.08"; Tabler DP2A, DP2B, DP1B). Each load now has its
// own column, and the heading names both. A stray run after one description
// (Tabler EL4A's "1") does not open a column of its own.
{
  const x0 = 0, y0 = 760;
  const raw = [run("Distribution Panel: DP9", x0 - 114, y0, 183)];
  const head = [["CKT", -150], ["Circuit Description", -60, 85], ["Trip", 97], ["Poles", 129], ["A[KVA]", 179], ["B[KVA]", 251], ["Poles", 381], ["Trip", 421], ["Circuit Description", 514, 85]];
  head.forEach(([s, x, w]) => raw.push(run(s, x, y0 - 40, w ?? W(s) + 4)));
  const ckts = [["RP1A", "63.39", "55.08", "RP3A"], ["RP2A", "59.13", "58.47", "RP4A"], ["SPARE", "0.00", "14.41", "EV CHARGER"], ["SPD", "--", "0.10", "SPARE"], ["ELEV 1", "11.05", "0.08", "LTG ELEV. 2 2-198"]];
  ckts.forEach(([l, a, b, r], i) => {
    const y = y0 - 54 - i * 14, phase = i % 2 === 0 ? 166 : 238;
    raw.push(run(String(2 * i + 1), -149, y, 5), run(l, -126, y, W(l)), run("400 A", 93, y, 25), run("3", 139, y, 5));
    raw.push(run(a, phase, y, 24), run(b, phase + 36, y, 24));
    raw.push(run("3", 391, y, 5), run("400 A", 418, y, 25), run(r, 450, y, W(r)), run(String(2 * i + 2), 620, y, 5));
  });
  raw.push(run("1", 450 + W("LTG ELEV. 2 2-198") + 6, y0 - 54 - 4 * 14, 5)); // stray run after one description
  const yt = y0 - 54 - ckts.length * 14;
  raw.push(run("Total Load:", 80, yt, 55), run("250.59 kVA", 171, yt, 49), run("264.15 kVA", 243, yt, 49));
  raw.push(run("Total Amps:", 80, yt - 13, 55), run("2139 A", 180, yt - 13, 31), run("2252 A", 252, yt - 13, 31));
  const [p] = extractSheetTables(orientSheetItems(raw));
  assert.equal(p.title, "Distribution Panel: DP9");
  assert.deepEqual(p.rows[0], ["CKT", "Circuit Description", "Trip", "Poles", "A[KVA]", "A[KVA]", "B[KVA]", "B[KVA]", "Poles", "Trip", "Circuit Description", ""]);
  assert.deepEqual(p.rows[1], ["1", "RP1A", "400 A", "3", "63.39", "55.08", "", "", "3", "400 A", "RP3A", "2"]);
  assert.deepEqual(p.rows[2], ["3", "RP2A", "400 A", "3", "", "", "59.13", "58.47", "3", "400 A", "RP4A", "4"]);
  // The stray "1" stays with its description; the CKT column stays last.
  assert.deepEqual(p.rows[5].slice(-2), ["LTG ELEV. 2 2-198 1", "10"]);
  // No cell anywhere holds two loads.
  for (const r of p.rows) for (const c of r) assert.ok(!/^\d+\.\d+ \d+\.\d+$/.test(c), c);
}

// Panels whose title is centred over the panel (Tabler E612: 206 pt in from
// its left edge, not the usual ~40), three in a row with only 36 pt between
// them, less than the gaps inside one. Each window used to start at its
// title and take the next panel's left-hand columns, and the last one took
// the title block. The row's first panel shows how far its panels start left
// of their titles. Their heading takes two lines ("CKT." over "NO.").
{
  const y0 = 786, pitch = 739;
  const cols = [["NO.", 0, 17], ["LOAD DESCRIPTION", 61, 94], ["BKR", 198, 21], ["POLES", 232, 32], ["PHASE A VA", 279, 58], ["PHASE B VA", 358, 59], ["POLES", 435, 33], ["BKR", 484, 21], ["LOAD DESCRIPTION", 549, 94], ["NO.", 687, 17]];
  const panel = (name, x0, loads) => {
    const r = [run("PANELBOARD: " + name, x0 + 206, y0, 207)];
    r.push(run("LOCATION: UNIT " + name, x0 + 40, y0 - 20, 120), run("BUS AMPS: 100 A", x0 + 400, y0 - 20, 80));
    r.push(run("CKT.", x0, y0 - 84, 21), run("CKT.", x0 + 686, y0 - 84, 21));
    cols.forEach(([s, dx, w]) => r.push(run(s, x0 + dx, y0 - 97, w)));
    loads.forEach(([l, a, b, rt], i) => {
      const y = y0 - 110 - i * 13, ph = i % 2 === 0 ? 279 : 358;
      r.push(run(String(2 * i + 1), x0 + 6, y, 5), run(l, x0 + 28, y, W(l)), run("20 A", x0 + 199, y, 20), run("1", x0 + 245, y, 5));
      r.push(run(a, x0 + ph, y, W(a)), run(b, x0 + ph + 37, y, W(b)));
      r.push(run("1", x0 + 449, y, 5), run("20 A", x0 + 485, y, 20), run(rt, x0 + 516, y, W(rt)), run(String(2 * i + 2), x0 + 692, y, 5));
    });
    return r;
  };
  const loads = (tag) => [["LIGHTING", "172", "1080", "REC- BEDROOM " + tag], ["REC- HALL", "1440", "1080", "REC- BEDROOM"], ["GFI REC- RR", "270", "1080", "DISPOSAL"], ["SPARE", "0", "0", "SPARE"]];
  const raw = [...panel("P1", -1160, loads("A")), ...panel("P2", -1160 + pitch, loads("B")), ...panel("P3", -1160 + 2 * pitch, loads("C"))];
  // The title block beside the last panel.
  raw.push(run("IT IS A VIOLATION OF STATE EDUCATION LAW", -1160 + 2 * pitch + 740, y0 - 110, 190));
  const tables = extractSheetTables(orientSheetItems(raw));
  assert.deepEqual(tables.map((t) => t.title), ["PANELBOARD: P1", "PANELBOARD: P2", "PANELBOARD: P3"]);
  for (const [k, t] of tables.entries()) {
    const tag = "ABC"[k];
    assert.equal(t.columns, 12, t.title);
    assert.deepEqual(t.rows[0], ["CKT.", "", "", "", "", "", "", "", "", "", "", "CKT."]);
    assert.deepEqual(t.rows[1], ["NO.", "LOAD DESCRIPTION", "BKR", "POLES", "PHASE A VA", "PHASE A VA", "PHASE B VA", "PHASE B VA", "POLES", "BKR", "LOAD DESCRIPTION", "NO."]);
    assert.deepEqual(t.rows[2], ["1", "LIGHTING", "20 A", "1", "172", "1080", "", "", "1", "20 A", "REC- BEDROOM " + tag, "2"]);
    assert.deepEqual(t.rows[3], ["3", "REC- HALL", "20 A", "1", "", "", "1440", "1080", "1", "20 A", "REC- BEDROOM", "4"]);
    assert.ok(t.details[0].includes("UNIT P" + (k + 1)));
    // Nothing from a neighbour or the title block.
    assert.ok(!JSON.stringify(t).includes("VIOLATION"));
    for (const o of "ABC".replace(tag, "")) assert.ok(!JSON.stringify(t.rows).includes("REC- BEDROOM " + o));
  }
}

// ── drift anchors ───────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf8");
for (const anchor of [
  'mcp.tool("read_drawing_schedule"',
  // The extractor lives in its own module; the tool turns the page upright first.
  'from "./scheduleExtract.ts"',
  "items = orientSheetItems(tc.items as any[]);",
  // A changed extractor must not be served from an older saved parse.
  'const SCHED_PARSER = "sched-v5";',
  // Shared resolver serves both drawing tools.
  "async function resolveIndexedSheet",
] ) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}
// view_drawing rides the same resolver — both call sites exist.
assert.equal(src.split("resolveIndexedSheet(projectNumber, sheet, revision, set)").length - 1, 2);

console.log("readDrawingSchedule.test.mjs: all assertions passed");
