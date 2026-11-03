// portalLogSpec.js — the RFI Log and Submittal Log workbooks the client
// portal shows the contractor (step 5 of PROPOSAL-portal-ca-exchange.md).
//
// A contractor who only has a folder still needs Procore's list page: what
// is logged, its number, when it is due, whether it is answered, and where
// the response is. The connector regenerates "RFI Log.xlsx" and "Submittal
// Log.xlsx" in the portal Deliverables folder whenever the project changed
// after the file was last written (portalLogsRun.ts), so the contractor's
// view is minutes behind the PMS, never a separate record.
//
// Contractor-facing on purpose: numbers, subjects, dates, a status in their
// words, the stamp, and a link to the returned document. Nothing internal
// (sub routing, internal notes, response text, who at Setty has it).
//
// NO IMPORTS, on purpose: the connector runs a byte-identical copy
// (supabase/functions/pms-mcp/portalLogSpec.js, portalLogSpecDrift.test.mjs)
// and zips the parts itself. Pure: no DOM, no fetch.

export const PORTAL_LOG_FILE = { rfi: "RFI Log.xlsx", submittal: "Submittal Log.xlsx" };

export const xmlEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Trailing integer of a log number ("RFI-012" → 12); null if none.
const numberValue = (num) => { const m = String(num == null ? "" : num).match(/(\d+)(?:\.\d+)?\s*$/); return m ? parseInt(m[1], 10) : null; };
const day = (v) => String(v || "").slice(0, 10);

// The item's status in the contractor's words. Internal states (sub review,
// unreviewed intake) collapse into what they mean from outside.
export function contractorStatus(item, type) {
  const s = String((item && item.status) || "");
  if (s === "Void") return "Void";
  if (type === "rfi") {
    if (s === "Closed") return "Closed";
    if (s === "Responded") return "Responded";
    return "Open";
  }
  if (s === "Returned") return "Returned";
  if (s === "Resubmittal Required") return "Resubmittal required";
  return "Under review";
}

export function portalLogColumns(type) {
  const isRFI = type === "rfi";
  return [
    { key: "number", label: isRFI ? "RFI #" : "Submittal #", width: 13 },
    { key: "ref", label: "Your reference", width: 16 },
    { key: "subject", label: isRFI ? "Subject" : "Description", width: 48 },
    ...(isRFI ? [] : [{ key: "spec", label: "Spec section", width: 13 }]),
    { key: "received", label: "Received", width: 12 },
    { key: "due", label: isRFI ? "Response due" : "Return due", width: 13 },
    { key: "status", label: "Status", width: 18 },
    ...(isRFI ? [] : [{ key: "stamp", label: "Stamp", width: 20 }, { key: "revision", label: "Rev", width: 6 }]),
    { key: "returned", label: isRFI ? "Responded" : "Returned", width: 12 },
    { key: "link", label: isRFI ? "Response" : "Returned document", width: 18, link: true },
  ];
}

// One row per item, oldest number first. `link` is the URL of the returned
// document's folder (or file) when the response was posted to the portal.
export function portalLogRows(project, type) {
  const isRFI = type === "rfi";
  const items = [...((project && project[isRFI ? "rfis" : "submittals"]) || [])].filter(Boolean)
    .sort((a, b) => (numberValue(a.number) || 0) - (numberValue(b.number) || 0) || String(a.number || "").localeCompare(String(b.number || "")));
  return items.map((it) => {
    const pr = it.portalReturn || {};
    return {
      number: String(it.number || ""),
      ref: String(it.extNumber || ""),
      subject: String((isRFI ? it.title : it.description) || ""),
      spec: String(it.specSection || ""),
      received: day(it.dateReceived),
      due: day(it.dueDate),
      status: contractorStatus(it, type),
      stamp: !isRFI && it.stamp && it.stamp !== "—" ? String(it.stamp) : "",
      revision: !isRFI && it.resubNumber ? String(it.resubNumber) : "",
      returned: day(isRFI ? it.dateResponded : it.dateReturned),
      link: String(pr.folderUrl || pr.fileUrl || ""),
    };
  });
}

/* ---------- workbook ---------- */
const SHEET = "Log";
const HEADER_ROW = 4;
const colLetter = (i) => { let n = i + 1, s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const inlineStr = (ref, text, styleId) =>
  `<c r="${ref}" t="inlineStr"${styleId ? ` s="${styleId}"` : ""}><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
// A clickable cell without a relationships part: the HYPERLINK formula, with
// the label cached as the value so it reads right before Excel recalculates.
const linkCell = (ref, url, label) =>
  `<c r="${ref}" s="3" t="str"><f>HYPERLINK(&quot;${xmlEsc(url).replace(/"/g, "&quot;&quot;")}&quot;,&quot;${xmlEsc(label)}&quot;)</f><v>${xmlEsc(label)}</v></c>`;

// Styles: 0 normal, 1 header (bold, shaded), 2 title, 3 hyperlink, 4 note, 5 wrapping text.
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF1F3864"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
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

function workbookXml(lastRow, lastCol) {
  const ref = `${SHEET}!$A$${HEADER_ROW}:$${lastCol}$${lastRow}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${SHEET}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${ref}</definedName></definedNames>
<calcPr fullCalcOnLoad="1"/>
</workbook>`;
}

function sheetXml({ title, note, columns, rows }) {
  const lastCol = colLetter(columns.length - 1);
  const lastRow = Math.max(HEADER_ROW + rows.length, HEADER_ROW + 1);
  const out = [];
  out.push(`<row r="1">${inlineStr("A1", title, 2)}</row>`);
  out.push(`<row r="2">${inlineStr("A2", note, 4)}</row>`);
  out.push(`<row r="${HEADER_ROW}">${columns.map((c, i) => inlineStr(colLetter(i) + HEADER_ROW, c.label, 1)).join("")}</row>`);
  rows.forEach((r, ri) => {
    const rn = HEADER_ROW + 1 + ri;
    out.push(`<row r="${rn}">` + columns.map((c, i) => {
      const ref = colLetter(i) + rn;
      const v = r[c.key] == null ? "" : String(r[c.key]);
      if (c.link) return v ? linkCell(ref, v, "Open") : "";
      return v === "" ? "" : inlineStr(ref, v, c.key === "subject" ? 5 : 0);
    }).join("") + `</row>`);
  });
  if (!rows.length) out.push(`<row r="${HEADER_ROW + 1}">${inlineStr("A" + (HEADER_ROW + 1), "Nothing logged yet.", 4)}</row>`);
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${HEADER_ROW}" topLeftCell="A${HEADER_ROW + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${out.join("")}</sheetData>
<autoFilter ref="A${HEADER_ROW}:${lastCol}${lastRow}"/>
</worksheet>`;
}

const stamp = (iso) => String(iso || "").replace("T", " ").slice(0, 16) + " UTC";

/**
 * The log workbook's parts: [[path, bytes], ...] in zip order. `project` is
 * the PMS record; `type` "rfi" | "submittal"; `generatedAt` ISO.
 */
export function buildPortalLogParts({ project, type, generatedAt }) {
  const isRFI = type === "rfi";
  const label = [project.projectNumber, project.name].filter(Boolean).join(" - ");
  const columns = portalLogColumns(type);
  const rows = portalLogRows(project, type);
  const title = "SETTY — " + (isRFI ? "RFI Log" : "Submittal Log") + (label ? " — " + label : "");
  const note = "Generated " + stamp(generatedAt) + " by the Setty PMS and refreshed automatically whenever the log changes. " +
    "Newest numbers are at the bottom. Click Open to go to the returned document.";
  const enc = new TextEncoder();
  const lastRow = Math.max(HEADER_ROW + rows.length, HEADER_ROW + 1);
  return [
    ["[Content_Types].xml", enc.encode(CONTENT_TYPES_XML)],
    ["_rels/.rels", enc.encode(ROOT_RELS_XML)],
    ["xl/workbook.xml", enc.encode(workbookXml(lastRow, colLetter(columns.length - 1)))],
    ["xl/_rels/workbook.xml.rels", enc.encode(WORKBOOK_RELS_XML)],
    ["xl/worksheets/sheet1.xml", enc.encode(sheetXml({ title, note, columns, rows }))],
    ["xl/styles.xml", enc.encode(STYLES_XML)],
  ];
}
