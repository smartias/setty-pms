// Tests for costEstimateLines.js: reading every line of a cost estimate
// workbook from a described layout, and the transcribed path for PDFs.
//
//   node --test supabase/functions/pms-mcp/costEstimateLines.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  cellNumber, resolveColumn, disciplineFromText, extractSheetLines, normalizeSuppliedLines,
  summarizeLines, checkAgainstReview, toRows, LINE_DISCIPLINES, LINES_MAX,
  amountForms, amountAppears, verifyLinesAgainstPages,
} from "./costEstimateLines.js";
import { ESTIMATE_DISCIPLINES } from "./constructionCost.js";

// A trade sheet the way estimators lay them out: title rows, a heading row,
// division headings, lines, subtotals.
const sheet = [
  ["ACME ESTIMATING", null, null, null, null, null],
  ["100% DD Estimate", null, null, null, null, null],
  ["Code", "Description", "Qty", "Unit", "Unit Cost", "Total Cost"],
  ["23 00 00", "DIVISION 23 - HVAC", null, null, null, null],
  ["23 73 00", "Air handling unit AHU-1", 2, "EA", 150000, 300000],
  ["23 31 00", "Galvanized ductwork", "12,500", "LB", "$14.00", "$175,000.00"],
  [null, "Electrical connection to AHU-1", 2, "EA", 2500, 5000],
  [null, "Subtotal HVAC", null, null, null, 480000],
  [null, null, null, null, null, null],
  ["22 00 00", "DIVISION 22 - PLUMBING", null, null, null, null],
  ["22 40 00", "Fixtures", 40, "EA", 1800, 72000],
  [null, "Credit for owner-furnished fixtures", 1, "LS", null, "(5,000)"],
  [null, "Allowance", 1, "LS", null, "TBD"],
  [null, "General Requirements", null, null, null, null],
  [null, "Supervision", 6, "MO", 12000, 72000],
];
const spec = { sheet: "MEP", headerRow: 3, columns: { description: "Description", amount: "Total Cost", quantity: "Qty", unit: "Unit", unitCost: "Unit Cost", code: "Code" } };

test("cell values parse as money, and text or percentages do not", () => {
  assert.equal(cellNumber(1234.5), 1234.5);
  assert.equal(cellNumber("$1,234.50"), 1234.5);
  assert.equal(cellNumber("(500)"), -500);
  assert.equal(cellNumber("-12"), -12);
  for (const v of ["", null, "TBD", "12%", "1,2a", "N/A"]) assert.equal(cellNumber(v), null, String(v));
});

test("a column is found by letter, number or heading text", () => {
  const heads = sheet[2];
  assert.equal(resolveColumn("F", heads), 5);
  assert.equal(resolveColumn("AB", heads), 27);
  assert.equal(resolveColumn(2, heads), 1);
  assert.equal(resolveColumn("total cost", heads), 5);
  assert.equal(resolveColumn("Unit", heads), 3, "exact heading wins over 'Unit Cost'");
  assert.equal(resolveColumn("Markup", heads), null);
  assert.equal(resolveColumn("", heads), null);
});

test("every line is read from the cells, with its section, row and discipline", () => {
  const { lines, warnings } = extractSheetLines(sheet, spec);
  assert.equal(lines.length, 8);
  const ahu = lines[0];
  assert.deepEqual([ahu.code, ahu.description, ahu.quantity, ahu.unit, ahu.unitCost, ahu.amount], ["23 73 00", "Air handling unit AHU-1", 2, "EA", 150000, 300000]);
  assert.equal(ahu.section, "23 00 00 DIVISION 23 - HVAC");
  assert.equal(ahu.rowRef, "MEP!R5");
  assert.equal(ahu.discipline, "mechanical");
  assert.deepEqual([lines[1].quantity, lines[1].unitCost, lines[1].amount], [12500, 14, 175000], "formatted cells");
  assert.equal(lines[2].discipline, "mechanical", "a line under HVAC stays mechanical whatever its words say");
  assert.equal(lines[3].isSubtotal, true);
  assert.equal(lines[4].discipline, "plumbing");
  assert.equal(lines[5].amount, -5000, "a credit in parentheses");
  assert.equal(lines[6].amount, null, "TBD is not a number");
  assert.deepEqual([lines[7].section, lines[7].discipline], ["General Requirements", null], "not one of our disciplines");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /1 row\(s\) have text in the amount column/);
});

test("row limits, a sheet-wide discipline and section rules", () => {
  const some = extractSheetLines(sheet, { ...spec, firstRow: 11, lastRow: 12 });
  assert.deepEqual(some.lines.map((l) => l.rowRef), ["MEP!R11", "MEP!R12"]);
  assert.equal(some.lines[0].discipline, "plumbing", "from the line's own CSI code when no heading is in range");
  const all = extractSheetLines(sheet, { ...spec, discipline: "electrical" });
  assert.equal(all.lines[7].discipline, "electrical", "the sheet's discipline covers lines no heading placed");
  assert.equal(all.lines[0].discipline, "electrical", "and overrides a heading guess");
  const ruled = extractSheetLines(sheet, { ...spec, sections: [{ match: "general requirements", discipline: "technology" }] });
  assert.equal(ruled.lines[7].discipline, "technology");
  assert.equal(ruled.lines[0].discipline, "mechanical");
});

test("a layout that does not fit the sheet is refused with the headings it found", () => {
  const bad = extractSheetLines(sheet, { ...spec, columns: { ...spec.columns, amount: "Extended" } });
  assert.match(bad.error, /no column "Extended" for amount on heading row 3/);
  assert.match(bad.error, /Total Cost/);
  assert.match(extractSheetLines(sheet, { sheet: "MEP", columns: { description: "B" } }).error, /required/);
  assert.match(extractSheetLines(sheet, { sheet: "MEP", columns: { description: "Description", amount: "F" } }).error, /Give headerRow/);
  const empty = extractSheetLines(sheet, { ...spec, firstRow: 9, lastRow: 9 });
  assert.equal(empty.lines.length, 0);
  assert.match(empty.warnings[0], /no lines found/);
});

test("headings and codes map to a discipline; a bare number does not", () => {
  assert.equal(disciplineFromText("Division 26 - Electrical"), "electrical");
  assert.equal(disciplineFromText("21 13 13 Wet-Pipe Sprinkler Systems"), "fireProtection");
  assert.equal(disciplineFromText("25 - Integrated Automation"), "mechanical");
  assert.equal(disciplineFromText("28 31 00"), "technology");
  assert.equal(disciplineFromText("Fire Alarm"), "technology");
  assert.equal(disciplineFromText("PLUMBING"), "plumbing");
  assert.equal(disciplineFromText("Sitework"), null);
  assert.equal(disciplineFromText("03 30 00 Cast-in-place concrete"), null);
  assert.equal(disciplineFromText("1,223 SF"), null);
  assert.equal(disciplineFromText(null, ""), null);
});

test("sums leave subtotals out and are checked against the review", () => {
  const { lines } = extractSheetLines(sheet, spec);
  const s = summarizeLines(lines);
  assert.deepEqual([s.lines, s.subtotalRows, s.linesWithoutAmount], [8, 1, 1]);
  assert.deepEqual(s.sumByDiscipline, { mechanical: 480000, plumbing: 67000 });
  assert.equal(s.sumUnassigned, 72000);
  assert.equal(s.sumOfLines, 619000);
  const check = checkAgainstReview(s, { disciplines: [
    { discipline: "mechanical", amount: 480000 }, { discipline: "plumbing", amount: 80000 }, { discipline: "electrical", amount: 100000 },
  ] });
  assert.deepEqual([check[0].diffPct, check[0].note], [0, undefined]);
  assert.equal(check[1].diffPct, -16.2);
  assert.match(check[1].note, /do not add up/);
  assert.equal(check[2].lines, null);
});

test("lines typed from a PDF take the same shape", () => {
  const lines = normalizeSuppliedLines([
    { description: "Switchgear", amount: 250000, section: "Division 26 Electrical", page: 14, quantity: "1", unit: "LS" },
    { description: "Total Electrical", amount: "1,200,000", discipline: "electrical" },
    { description: "", amount: 5 },
    { description: "Site lighting", discipline: "bogus", section: "Sitework" },
  ]);
  assert.equal(lines.length, 3);
  assert.deepEqual([lines[0].discipline, lines[0].rowRef, lines[0].quantity], ["electrical", "p.14", 1]);
  assert.deepEqual([lines[1].isSubtotal, lines[1].amount], [true, 1200000]);
  assert.deepEqual([lines[2].discipline, lines[2].amount], [null, null]);
});

test("database rows are numbered and stamped, and capped", () => {
  const { lines } = extractSheetLines(sheet, spec);
  const rows = toRows(lines, { project: "SAPX260001.00", reviewId: "r1", documentName: "Est.xlsx", itemId: "d|1", source: "workbook", by: "PM", startAt: 100 });
  assert.deepEqual([rows[0].line_no, rows[7].line_no], [101, 108]);
  assert.deepEqual([rows[0].project, rows[0].review_id, rows[0].source, rows[0].unit_cost, rows[3].is_subtotal], ["SAPX260001.00", "r1", "workbook", 150000, true]);
  assert.equal(toRows(lines, { source: "nope" })[0].source, "transcribed");
  assert.equal(toRows(Array.from({ length: LINES_MAX + 5 }, () => lines[0]), {}).length, LINES_MAX);
});

test("a typed amount is looked for in the PDF text the way an estimate prints it", () => {
  assert.deepEqual(amountForms(1234567).sort(), ["1,234,567", "1,234,567.00", "1234567", "1234567.00"].sort());
  assert.deepEqual(amountForms(1234.5).sort(), ["1,234.50", "1234.50"].sort());
  assert.deepEqual(amountForms("x"), []);
  const page = "23 73 00 Air handling units 2 EA 150,000.00 300,000 Subtotal HVAC $480,000 Credit (5,000) Qty 12,500 LB";
  assert.equal(amountAppears(300000, page), true);
  assert.equal(amountAppears(480000, page), true, "after a dollar sign");
  assert.equal(amountAppears(-5000, page), true, "a credit in parentheses");
  assert.equal(amountAppears(150000, page), true, "printed with cents");
  assert.equal(amountAppears(300, page), false, "not as part of 300,000");
  assert.equal(amountAppears(80000, page), false, "not as the tail of 480,000");
  assert.equal(amountAppears(2500, page), false, "not as the tail of 12,500");
  assert.equal(amountAppears(310000, page), false, "a mistyped digit");
  assert.equal(amountAppears(300000, ""), false);
});

test("typed lines are marked verified, not found, or unchecked", () => {
  const lines = normalizeSuppliedLines([
    { description: "Switchgear", amount: 250000, page: 2 },
    { description: "Feeders", amount: 91000, page: 2 },
    { description: "Lighting", amount: 410000, page: 3 },
    { description: "Allowance", page: 3 },
  ]);
  const filler = " Division 26 Electrical estimate detail ".repeat(8);
  const v = verifyLinesAgainstPages(lines, { 2: "Switchgear 1 LS 250,000" + filler, 3: "Feeders 91,000 Lighting 401,000" + filler });
  assert.deepEqual([v.readable, v.checked, v.verified, v.notFoundCount], [true, 3, 2, 1]);
  assert.deepEqual(lines.map((l) => l.verified), [true, true, false, null], "found on another page still counts; a line with no amount is not checked");
  assert.deepEqual(v.notFound, [{ description: "Lighting", amount: 410000, page: 3 }]);
  const scan = verifyLinesAgainstPages(normalizeSuppliedLines([{ description: "Switchgear", amount: 250000, page: 2 }]), { 2: "   " });
  assert.deepEqual([scan.readable, scan.checked], [false, 0], "a scanned PDF cannot be checked");
  const rows = toRows(lines, { source: "transcribed" });
  assert.deepEqual(rows.map((r) => r.verified), [true, true, false, null]);
  assert.equal(toRows(lines, { source: "workbook" })[2].verified, true, "cells read by the connector need no check");
});

// The table, the module and the review rules must agree on the discipline keys.
test("discipline keys match the review module and the table's check constraint", () => {
  assert.deepEqual(LINE_DISCIPLINES, ESTIMATE_DISCIPLINES.map((d) => d.key));
  const sql = readFileSync(new URL("../../migrations/20261124180000_pms_cost_estimate_lines.sql", import.meta.url), "utf8");
  for (const k of LINE_DISCIPLINES) assert.ok(sql.includes("'" + k + "'"), k);
  assert.ok(sql.includes("pms_has_cap('fees.view', project)"), "readable only with the fees permission");
  assert.ok(!/for select to authenticated using \(true\)/.test(sql));
  assert.ok(/verified\s+boolean/.test(sql));
});
