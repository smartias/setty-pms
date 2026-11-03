// portalFormSpec.js — the contractor-facing submit convention for the client
// portal on jobs where SETTY IS PRIME (step 1 of PROPOSAL-portal-ca-exchange.md):
// the field lists, the readme text, the workbook PARTS and the reader.
//
// NO IMPORTS, on purpose. The browser wraps this with the zip layer from
// setty-docx.js (portalForms.js, window.PortalForms), and the connector runs a
// byte-identical copy (supabase/functions/pms-mcp/portalFormSpec.js, pinned
// by portalFormSpecDrift.test.mjs) with fflate doing the unzip, so the sweep
// and the page agree on what a form is. Pure: no DOM, no fetch.
//
// On a prime job there is no Procore: the contractor needs somewhere to put an
// RFI or a submittal and we need to read it back without retyping. The
// convention is two subfolders under the project's portal Uploads folder,
// each seeded with a one-sheet form workbook and a readme:
//
//   <name> Uploads/
//     RFIs/            _READ ME - how to submit an RFI.txt        RFI form.xlsx
//     Submittals/      _READ ME - how to submit a submittal.txt   Submittal transmittal form.xlsx
//
// The contractor fills the yellow cells, saves the form beside its
// attachments, and that is the submission. Every answer cell carries a
// workbook-level defined name (Subject, Question, SpecSection, ...), so the
// intake sweep (step 2) reads named cells, never "row 7 column B", and a
// contractor who adds a note above the table does not break it. A constant
// defined name, PortalFormKind, says which form it is.

/* ---------- the convention ---------- */

export const PORTAL_INTAKE_KINDS = {
  rfi: {
    folder: "RFIs",
    formFile: "RFI form.xlsx",
    readmeFile: "_READ ME - how to submit an RFI.txt",
    title: "RFI form",
    noun: "RFI",
  },
  submittal: {
    folder: "Submittals",
    formFile: "Submittal transmittal form.xlsx",
    readmeFile: "_READ ME - how to submit a submittal.txt",
    title: "Submittal transmittal form",
    noun: "submittal",
  },
};

// Field order is the row order on the sheet. `name` is the defined name the
// sweep reads; keep names stable once a form is in a contractor's hands.
// type: text | long | date | yesno | email. `required` is what the sweep
// needs to log the item at all (everything else is nice to have).
export const PORTAL_FORM_FIELDS = {
  rfi: [
    { name: "ContractorNumber", label: "Your RFI number", hint: "Your own reference, if you keep one. Setty assigns the official RFI number when it is logged.", type: "text" },
    { name: "Subject", label: "Subject", hint: "One line. This becomes the RFI title.", type: "text", required: true },
    { name: "Question", label: "Question", hint: "What you need answered, with enough context to answer it. Reference sheets, details and spec sections.", type: "long", required: true },
    { name: "SpecSection", label: "Spec section / drawing reference", hint: "For example 23 05 00, or M-401 detail 3.", type: "text" },
    { name: "DateNeeded", label: "Date response needed by", hint: "YYYY-MM-DD. Setty confirms the due date when the RFI is acknowledged.", type: "date" },
    { name: "CostImpact", label: "Cost impact?", hint: "Yes if the answer could change the contract sum.", type: "yesno" },
    { name: "ScheduleImpact", label: "Schedule impact?", hint: "Yes if the answer could affect the schedule.", type: "yesno" },
    { name: "SubmittedBy", label: "Submitted by", hint: "Your name and company.", type: "text", required: true },
    { name: "Email", label: "Email", hint: "Where the acknowledgement and the response go.", type: "email", required: true },
    { name: "Attachments", label: "Attachments", hint: "List the files you saved beside this form (sketches, photos, marked-up sheets).", type: "long" },
  ],
  submittal: [
    { name: "ContractorNumber", label: "Your submittal number", hint: "Your own reference, if you keep one. Setty assigns the official submittal number when it is logged.", type: "text" },
    { name: "SpecSection", label: "Spec section", hint: "The section this submittal is under, for example 23 34 00.", type: "text", required: true },
    { name: "Subject", label: "Description / item", hint: "What is being submitted, for example 'Exhaust fans EF-1 to EF-4, product data'.", type: "text", required: true },
    { name: "Manufacturer", label: "Manufacturer / model", hint: "If a product: who makes it and the model submitted.", type: "text" },
    { name: "Revision", label: "Revision", hint: "0 for a first submission; 1, 2, ... for a resubmittal. Give the Setty number of the item being resubmitted under 'Your submittal number'.", type: "text" },
    { name: "DateNeeded", label: "Date return needed by", hint: "YYYY-MM-DD. The contract review period applies; Setty confirms the due date when the submittal is acknowledged.", type: "date" },
    { name: "SubmittedBy", label: "Submitted by", hint: "Your name and company.", type: "text", required: true },
    { name: "Email", label: "Email", hint: "Where the acknowledgement and the returned submittal go.", type: "email", required: true },
    { name: "Attachments", label: "Attachments", hint: "List the files you saved beside this form (product data, shop drawings, samples log).", type: "long" },
  ],
};

export function intakeKindInfo(kind) {
  const k = PORTAL_INTAKE_KINDS[kind];
  if (!k) throw new Error("Unknown portal intake kind: " + kind);
  return k;
}

/* ---------- sheet layout ---------- */

const SHEET_NAME = "Form";
const FIRST_FIELD_ROW = 5; // rows 1-3 are the heading, row 4 is a spacer
const COL_LABEL = "A", COL_VALUE = "B", COL_HINT = "C";

// name → "B7" for every field of a kind: the single source for the defined
// names the writer emits and the cells the reader looks in.
export function formCellMap(kind) {
  const out = {};
  (PORTAL_FORM_FIELDS[kind] || []).forEach((f, i) => { out[f.name] = COL_VALUE + (FIRST_FIELD_ROW + i); });
  return out;
}

export const xmlEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const inlineStr = (ref, text, styleId) =>
  `<c r="${ref}" t="inlineStr"${styleId ? ` s="${styleId}"` : ""}><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
const emptyCell = (ref, styleId) => `<c r="${ref}" s="${styleId}"/>`;

// Style ids in styles.xml below: 0 normal, 1 bold label, 2 yellow answer
// (wrapping), 3 grey hint (wrapping), 4 title.
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function workbookXml(kind) {
  const cells = formCellMap(kind);
  const names = Object.keys(cells).map(n =>
    `<definedName name="${n}">${SHEET_NAME}!$${cells[n][0]}$${cells[n].slice(1)}</definedName>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets>
<definedNames>${names}<definedName name="PortalFormKind">"${kind}"</definedName></definedNames>
</workbook>`;
}

function sheetXml(kind, projectLabel) {
  const info = intakeKindInfo(kind);
  const fields = PORTAL_FORM_FIELDS[kind];
  const rows = [];
  rows.push(`<row r="1">${inlineStr("A1", "SETTY — " + info.title, 4)}</row>`);
  rows.push(`<row r="2">${inlineStr("A2", "Project: " + (projectLabel || ""), 1)}</row>`);
  rows.push(`<row r="3">${inlineStr("A3",
    "Fill in the yellow cells, then save this file in the " + info.folder + " folder beside its attachments. " +
    "Setty logs it, assigns the number and emails an acknowledgement.", 3)}</row>`);
  const validations = [];
  fields.forEach((f, i) => {
    const r = FIRST_FIELD_ROW + i;
    const tall = f.type === "long";
    rows.push(`<row r="${r}"${tall ? ` ht="90" customHeight="1"` : ""}>` +
      inlineStr(COL_LABEL + r, f.label + (f.required ? " *" : ""), 1) +
      emptyCell(COL_VALUE + r, 2) +
      inlineStr(COL_HINT + r, f.hint, 3) +
      `</row>`);
    if (f.type === "yesno") {
      validations.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${COL_VALUE + r}"><formula1>"Yes,No"</formula1></dataValidation>`);
    }
  });
  const lastRow = FIRST_FIELD_ROW + fields.length;
  rows.push(`<row r="${lastRow}">${inlineStr("A" + lastRow, "* required", 3)}</row>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:C${lastRow}"/>
<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="70" customWidth="1"/><col min="3" max="3" width="48" customWidth="1"/></cols>
<sheetData>${rows.join("")}</sheetData>
${validations.length ? `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>` : ""}
</worksheet>`;
}

/** The parts of the form workbook for one kind: [[path, bytes], ...] in zip order. */
export function buildFormParts(kind, projectLabel) {
  intakeKindInfo(kind);
  const enc = new TextEncoder();
  return [
    ["[Content_Types].xml", enc.encode(CONTENT_TYPES_XML)],
    ["_rels/.rels", enc.encode(ROOT_RELS_XML)],
    ["xl/workbook.xml", enc.encode(workbookXml(kind))],
    ["xl/_rels/workbook.xml.rels", enc.encode(WORKBOOK_RELS_XML)],
    ["xl/worksheets/sheet1.xml", enc.encode(sheetXml(kind, projectLabel))],
    ["xl/styles.xml", enc.encode(STYLES_XML)],
  ];
}

/* ---------- reading a filled form back ---------- */

const decodeXml = (s) => String(s)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

// Excel date serial (days since 1899-12-30) → YYYY-MM-DD.
export function serialToIsoDate(n) {
  const ms = Math.round((Number(n) - 25569) * 86400000);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function sharedStrings(get) {
  const xml = get("xl/sharedStrings.xml");
  if (!xml) return [];
  const out = [];
  const text = new TextDecoder().decode(xml);
  for (const m of text.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push(decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join("")));
  }
  return out;
}

// Cell address → raw value for one sheet's XML. Handles inline strings (what
// we write), shared strings (what Excel writes back after a save), numbers
// and booleans. Formulas are read by their cached value.
function sheetCells(sheetXmlText, shared) {
  const cells = {};
  for (const m of sheetXmlText.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = m[1], attrs = m[2] || "", inner = m[3] || "";
    const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "";
    let value = "";
    if (type === "inlineStr") {
      value = decodeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(""));
    } else {
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (v == null) continue;
      if (type === "s") value = shared[+v] ?? "";
      else if (type === "b") value = v === "1" ? "Yes" : "No";
      else if (type === "str") value = decodeXml(v);
      else value = Number(v);
    }
    cells[ref] = value;
  }
  return cells;
}

/**
 * Read a (filled) form workbook from its unzipped parts, a Map of path →
 * Uint8Array (or any object with .get(path)). Returns { kind, fields: {name:
 * string}, missing: [required names left blank] } or { kind: null } when the
 * file is not one of ours. Cells are located by the workbook's defined names
 * first (so the sheet surviving a contractor's edits is what matters),
 * falling back to the layout this module writes.
 */
export function readFormParts(parts) {
  const get = (name) => (typeof parts.get === "function" ? parts.get(name) : parts[name]);
  const has = (name) => get(name) != null;
  const keys = () => (typeof parts.keys === "function" ? [...parts.keys()] : Object.keys(parts));
  const wb = get("xl/workbook.xml");
  if (!wb) return { kind: null, fields: {}, missing: [] };
  const wbText = new TextDecoder().decode(wb);
  const kind = (wbText.match(/<definedName name="PortalFormKind"[^>]*>"([a-z]+)"<\/definedName>/) || [])[1] || null;
  if (!kind || !PORTAL_FORM_FIELDS[kind]) return { kind: null, fields: {}, missing: [] };

  // Defined names → cell refs (Form!$B$5 → B5). Sheet lookup by name is
  // unnecessary: the form has one sheet, and Excel keeps it as sheet1.xml.
  const refs = formCellMap(kind);
  for (const m of wbText.matchAll(/<definedName name="([A-Za-z]+)"[^>]*>[^<]*!\$([A-Z]+)\$(\d+)<\/definedName>/g)) {
    if (refs[m[1]]) refs[m[1]] = m[2] + m[3];
  }
  const sheetKey = keys().find(k => /^xl\/worksheets\/sheet1\.xml$/.test(k)) || keys().find(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  const cells = sheetKey && has(sheetKey) ? sheetCells(new TextDecoder().decode(get(sheetKey)), sharedStrings(get)) : {};

  const fields = {}, missing = [];
  for (const f of PORTAL_FORM_FIELDS[kind]) {
    let v = cells[refs[f.name]];
    if (typeof v === "number") v = f.type === "date" ? serialToIsoDate(v) : String(v);
    v = String(v == null ? "" : v).trim();
    if (f.type === "yesno" && v) v = /^y/i.test(v) ? "Yes" : /^n/i.test(v) ? "No" : v;
    fields[f.name] = v;
    if (f.required && !v) missing.push(f.name);
  }
  return { kind, fields, missing };
}

/* ---------- the readme ---------- */

// Plain text with CRLF line ends, like the portal access guide, so it reads
// right in Notepad. `names` is portalFolderNames(project) from the PMS.
export function buildIntakeReadme(kind, names) {
  const info = intakeKindInfo(kind);
  const label = (names && names.label) || "";
  const L = [];
  L.push("HOW TO SUBMIT " + (kind === "rfi" ? "AN RFI" : "A SUBMITTAL") + " — SETTY project " + label);
  L.push("=".repeat(60));
  L.push("");
  L.push("1. Make a copy of \"" + info.formFile + "\" and fill in the yellow cells.");
  L.push("   The cells marked * are needed to log the " + info.noun + "; the rest help us");
  L.push("   answer it faster.");
  L.push("");
  L.push("2. Save the filled form in THIS folder, with its attachments beside");
  L.push("   it. Name the form and its attachments the same way, for example");
  L.push(kind === "rfi"
    ? "     \"Your RFI 12 - Condensate line routing.xlsx\" plus a folder or files"
    : "     \"23 34 00 - Exhaust fans EF-1 to EF-4.xlsx\" plus a folder or files");
  L.push("     of the same name for sketches, photos or product data.");
  L.push("   Leave the blank \"" + info.formFile + "\" here for the next one.");
  L.push("");
  L.push("3. That is the submission. Setty picks it up within the hour, assigns");
  L.push("   the official " + info.noun + " number, moves the files into a numbered folder");
  L.push("   here so you can see it was received, and emails an acknowledgement");
  L.push("   with the due date to the address on the form.");
  L.push("");
  L.push("4. The response comes back in the " + ((names && names.deliverables) || "Deliverables") + " folder,");
  L.push("   under \"" + (kind === "rfi" ? "RFI Responses" : "Submittal Returns") + "\", with an email that links to it.");
  L.push("");
  L.push("TIPS");
  L.push("");
  L.push("- Click Sync in the folder toolbar to have this folder in File Explorer;");
  L.push("  then drag files in instead of uploading in the browser.");
  L.push("- One form per " + info.noun + ". For a resubmittal, fill a new form and give");
  L.push("  the Setty number of the original under \"Your " + info.noun + " number\".");
  L.push("- A form with the * cells blank cannot be logged; we will email you.");
  L.push("- Trouble signing in? See \"_START HERE - Folder Access Guide.txt\" one");
  L.push("  folder up, or reply to your invitation email.");
  L.push("");
  return L.join("\r\n") + "\r\n";
}
