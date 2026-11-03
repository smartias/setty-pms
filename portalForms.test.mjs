// node --test portalForms.test.mjs
// The portal submit convention: the form workbooks are valid .xlsx packages
// with a defined name per field, and a filled one reads back by those names.
import test from "node:test";
import assert from "node:assert/strict";
import { unzip, zip } from "./setty-docx.js";
import {
  PORTAL_INTAKE_KINDS, PORTAL_FORM_FIELDS, formCellMap, buildFormWorkbook, readFormWorkbook,
  buildIntakeReadme, serialToIsoDate, xmlEsc,
} from "./portalForms.js";

const txt = (u8) => new TextDecoder().decode(u8);

for (const kind of Object.keys(PORTAL_INTAKE_KINDS)) {
  test(`${kind} workbook is a complete package with one defined name per field`, async () => {
    const bytes = await buildFormWorkbook(kind, "SAPX176021.01 - County of Dutchess 10 Market Street CA");
    const parts = await unzip(bytes.buffer);
    for (const p of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) {
      assert.ok(parts.has(p), "missing part " + p);
    }
    const wb = txt(parts.get("xl/workbook.xml"));
    const cells = formCellMap(kind);
    for (const f of PORTAL_FORM_FIELDS[kind]) {
      const ref = cells[f.name];
      assert.match(wb, new RegExp(`<definedName name="${f.name}">Form!\\$${ref[0]}\\$${ref.slice(1)}</definedName>`), f.name + " defined name");
    }
    assert.match(wb, new RegExp(`<definedName name="PortalFormKind">"${kind}"</definedName>`));
    const sheet = txt(parts.get("xl/worksheets/sheet1.xml"));
    for (const f of PORTAL_FORM_FIELDS[kind]) {
      assert.ok(sheet.includes(xmlEsc(f.label)), "label on sheet: " + f.label);
      assert.ok(sheet.includes(`<c r="${cells[f.name]}" s="2"/>`), "empty yellow answer cell " + cells[f.name]);
    }
    // Every Yes/No field gets a dropdown and nothing else does.
    const yesno = PORTAL_FORM_FIELDS[kind].filter(f => f.type === "yesno").length;
    assert.equal((sheet.match(/<dataValidation /g) || []).length, yesno);
    assert.ok(sheet.includes("Project: SAPX176021.01 - County of Dutchess"));
  });
}

test("defined names are unique per form and stable across kinds that share a name", () => {
  for (const kind of Object.keys(PORTAL_FORM_FIELDS)) {
    const names = PORTAL_FORM_FIELDS[kind].map(f => f.name);
    assert.equal(new Set(names).size, names.length, kind + " has duplicate names");
    assert.ok(names.includes("Subject") && names.includes("Email") && names.includes("SubmittedBy"));
  }
});

test("a blank form reads back as its kind with every required field missing", async () => {
  const bytes = await buildFormWorkbook("rfi", "P");
  const r = await readFormWorkbook(bytes);
  assert.equal(r.kind, "rfi");
  assert.deepEqual(r.missing, PORTAL_FORM_FIELDS.rfi.filter(f => f.required).map(f => f.name));
  assert.equal(r.fields.Subject, "");
});

// Simulate what Excel does on save: shared strings instead of inline strings,
// a date typed as a serial, a boolean, and extra rows the contractor added
// above the table (the defined names move with them).
test("a filled form saved by Excel reads back by defined name, not by row", async () => {
  const blank = await buildFormWorkbook("submittal", "P");
  const parts = await unzip(blank.buffer);
  const enc = new TextEncoder();
  // Shift every field down two rows in the defined names, as Excel would after
  // two rows were inserted above the table.
  const wb = txt(parts.get("xl/workbook.xml")).replace(/Form!\$B\$(\d+)/g, (_, n) => "Form!$B$" + (+n + 2));
  const shared = ["23 34 00", "Exhaust fans EF-1 to EF-4, product data", "Jane Doe, Acme Mechanical", "jane@acme.example", "Greenheck SQ-120"];
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">` +
    shared.map(s => `<si><t>${s}</t></si>`).join("") + `</sst>`;
  const cells = formCellMap("submittal");
  const row = (name) => +cells[name].slice(1) + 2;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="${row("SpecSection")}"><c r="B${row("SpecSection")}" t="s"><v>0</v></c></row>` +
    `<row r="${row("Subject")}"><c r="B${row("Subject")}" t="s"><v>1</v></c></row>` +
    `<row r="${row("Manufacturer")}"><c r="B${row("Manufacturer")}" t="s"><v>4</v></c></row>` +
    `<row r="${row("Revision")}"><c r="B${row("Revision")}"><v>1</v></c></row>` +
    `<row r="${row("DateNeeded")}"><c r="B${row("DateNeeded")}" s="5"><v>46388</v></c></row>` +
    `<row r="${row("SubmittedBy")}"><c r="B${row("SubmittedBy")}" t="s"><v>2</v></c></row>` +
    `<row r="${row("Email")}"><c r="B${row("Email")}" t="s"><v>3</v></c></row>` +
    `</sheetData></worksheet>`;
  const filled = await zip([
    ["[Content_Types].xml", parts.get("[Content_Types].xml")],
    ["_rels/.rels", parts.get("_rels/.rels")],
    ["xl/workbook.xml", enc.encode(wb)],
    ["xl/_rels/workbook.xml.rels", parts.get("xl/_rels/workbook.xml.rels")],
    ["xl/worksheets/sheet1.xml", enc.encode(sheet)],
    ["xl/styles.xml", parts.get("xl/styles.xml")],
    ["xl/sharedStrings.xml", enc.encode(sst)],
  ]);
  const r = await readFormWorkbook(filled);
  assert.equal(r.kind, "submittal");
  assert.deepEqual(r.missing, []);
  assert.equal(r.fields.SpecSection, "23 34 00");
  assert.equal(r.fields.Subject, "Exhaust fans EF-1 to EF-4, product data");
  assert.equal(r.fields.Manufacturer, "Greenheck SQ-120");
  assert.equal(r.fields.Revision, "1");
  assert.equal(r.fields.DateNeeded, "2027-01-01");
  assert.equal(r.fields.Email, "jane@acme.example");
});

test("yes/no answers normalise and a foreign workbook is not a form", async () => {
  const blank = await buildFormWorkbook("rfi", "P");
  const parts = await unzip(blank.buffer);
  const enc = new TextEncoder();
  const cells = formCellMap("rfi");
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="${cells.CostImpact.slice(1)}"><c r="${cells.CostImpact}" t="inlineStr"><is><t>yes</t></is></c></row>` +
    `<row r="${cells.ScheduleImpact.slice(1)}"><c r="${cells.ScheduleImpact}" t="b"><v>0</v></c></row>` +
    `</sheetData></worksheet>`;
  const entries = [...parts.entries()].map(([k, v]) => k === "xl/worksheets/sheet1.xml" ? [k, enc.encode(sheet)] : [k, v]);
  const r = await readFormWorkbook(await zip(entries));
  assert.equal(r.fields.CostImpact, "Yes");
  assert.equal(r.fields.ScheduleImpact, "No");

  const foreign = await zip([["[Content_Types].xml", enc.encode("<Types/>")], ["xl/workbook.xml", enc.encode("<workbook/>")]]);
  assert.equal((await readFormWorkbook(foreign)).kind, null);
});

test("serialToIsoDate follows Excel's 1900 epoch", () => {
  assert.equal(serialToIsoDate(45658), "2025-01-01");
  assert.equal(serialToIsoDate(46388), "2027-01-01");
});

test("readme names the form, the folder, the return folder and the sign-in guide", () => {
  const names = { label: "SAPX176021.01 - 10 Market Street", uploads: "10 Market Street Uploads", deliverables: "10 Market Street Deliverables" };
  const rfi = buildIntakeReadme("rfi", names);
  assert.ok(rfi.startsWith("HOW TO SUBMIT AN RFI — SETTY project SAPX176021.01"));
  assert.ok(rfi.includes('"RFI form.xlsx"'));
  assert.ok(rfi.includes("10 Market Street Deliverables"));
  assert.ok(rfi.includes("RFI Responses"));
  assert.ok(rfi.includes("_START HERE - Folder Access Guide.txt"));
  assert.ok(!rfi.includes("\n") || rfi.split("\n").every(l => l === "" || l.endsWith("\r")), "CRLF line ends");
  const sub = buildIntakeReadme("submittal", names);
  assert.ok(sub.includes("Submittal Returns") && sub.includes('"Submittal transmittal form.xlsx"'));
  assert.throws(() => buildIntakeReadme("other", names));
});

test("portalFormSpec.js has no imports, so the connector can run a copy on its own", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./portalFormSpec.js", import.meta.url), "utf8");
  assert.ok(!/^\s*import\s/m.test(src));
});
