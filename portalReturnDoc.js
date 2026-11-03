// portalReturnDoc.js — the Word document that goes back to the contractor
// through the client portal (step 4 of PROPOSAL-portal-ca-exchange.md).
//
// On a job where Setty is prime the RFI response or the submittal return is
// issued under Setty's name. "Return via portal" in the RFI / submittal modal
// builds this .docx, saves it under the portal's Deliverables folder (RFI
// Responses / Submittal Returns, one folder per item) and drafts the email
// that links to it. There is no Word letterhead template on SharePoint to
// fill, so the document is written from scratch: letterhead block, a details
// table, the contractor's question (RFIs), the response or review comments,
// and a signature block. Plain Calibri; anyone can open it in Word and edit.
//
// Built with the zip writer from setty-docx.js (a .docx IS a zip), so there
// are no dependencies and it runs identically in the browser
// (window.PortalReturnDoc) and in node (portalReturnDoc.test.mjs). Pure.

import { zip } from "./setty-docx.js";

export const xmlEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── paragraph helpers (WordprocessingML) ─────────────────────────────────────
// opts: { bold, size (half-points), color (hex), align, spacingAfter (twips),
// caps }. Text is escaped here; callers pass plain strings.
function run(text, o = {}) {
  const rPr = [
    o.bold ? "<w:b/>" : "",
    o.caps ? "<w:caps/>" : "",
    o.color ? `<w:color w:val="${o.color}"/>` : "",
    o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : "",
  ].join("");
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}
function para(text, o = {}) {
  const pPr = [
    o.align ? `<w:jc w:val="${o.align}"/>` : "",
    `<w:spacing w:after="${o.spacingAfter == null ? 120 : o.spacingAfter}"/>`,
  ].join("");
  return `<w:p><w:pPr>${pPr}</w:pPr>${text === "" ? "" : run(text, o)}</w:p>`;
}
// A block of free text: one paragraph per line, blank lines kept as spacing.
export function textParas(text, o = {}) {
  const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
  return lines.map((l) => para(l.replace(/\t/g, "    "), { ...o, spacingAfter: l.trim() ? 80 : 160 })).join("");
}
// Rich text from the PMS response field (it is HTML in the modal) → plain lines.
export function htmlToText(html) {
  return String(html == null ? "" : html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const CELL_W = [2600, 6760]; // twips: label column, value column (6.5" page width)
function cell(text, width, o = {}) {
  const shade = o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>` : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${para(text, { bold: o.bold, spacingAfter: 40 })}</w:tc>`;
}
function detailsTable(rows) {
  const border = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`).join("")}</w:tblBorders>`;
  const body = rows.map(([k, v], i) =>
    `<w:tr>${cell(k, CELL_W[0], { bold: true, shade: i % 2 === 0 })}${cell(v, CELL_W[1], { shade: i % 2 === 0 })}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${CELL_W[0] + CELL_W[1]}" w:type="dxa"/>${border}<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${CELL_W[0]}"/><w:gridCol w:w="${CELL_W[1]}"/></w:tblGrid>${body}</w:tbl>`;
}

const fmtDay = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso || "");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
};

/**
 * The document body. `entity` is one of the PMS proposal entities
 * ({ legalNameCaps, addressLines, phone }); `item` is the RFI or submittal
 * record; `type` is "rfi" | "submittal"; `date` YYYY-MM-DD; `reviewer` the
 * person issuing it. Returns the XML of word/document.xml.
 */
export function documentXml({ entity, project, item, type, date, reviewer }) {
  const isRFI = type === "rfi";
  const e = entity || {};
  const head = [
    para("SETTY", { bold: true, size: 44, color: "C00000" }),
    para(e.legalNameCaps || "SETTY & ASSOCIATES, LTD. PC", { bold: true, size: 18, color: "44546A", spacingAfter: 0 }),
    ...(e.addressLines || []).map((l) => para(l, { size: 18, color: "44546A", spacingAfter: 0 })),
    e.phone ? para("Tel " + e.phone, { size: 18, color: "44546A", spacingAfter: 240 }) : para("", { spacingAfter: 240 }),
  ].join("");
  const title = para(isRFI ? "RFI RESPONSE" : "SUBMITTAL RETURN", { bold: true, size: 32, color: "1F3864", spacingAfter: 200 });
  const rows = [
    ["Project", [project.name || "", project.projectNumber ? "(" + project.projectNumber + ")" : ""].filter(Boolean).join(" ")],
    [isRFI ? "RFI number" : "Submittal number", item.number || ""],
    [isRFI ? "Subject" : "Description", (isRFI ? item.title : item.description) || ""],
  ];
  if (item.specSection) rows.push(["Spec section", item.specSection]);
  if (item.extNumber) rows.push(["Contractor's reference", item.extNumber]);
  if (item.from) rows.push(["Submitted by", item.from]);
  if (item.dateReceived) rows.push(["Received", fmtDay(item.dateReceived)]);
  if (!isRFI) {
    rows.push(["Review stamp", item.stamp && item.stamp !== "—" ? item.stamp : "—"]);
    if (item.resubNumber) rows.push(["Revision", String(item.resubNumber)]);
  }
  rows.push([isRFI ? "Response date" : "Return date", fmtDay(date)]);

  const question = isRFI && item.description
    ? para("CONTRACTOR'S QUESTION", { bold: true, size: 18, color: "92600A", spacingAfter: 60 }) + textParas(htmlToText(item.description))
    : "";
  const responseText = htmlToText(isRFI ? item.response : item.comments);
  const response = para(isRFI ? "SETTY RESPONSE" : "REVIEW COMMENTS", { bold: true, size: 18, color: "2E7D32", spacingAfter: 60 }) +
    (responseText ? textParas(responseText) : para("(no response text entered)", { color: "888888" }));
  const closing = [
    para("", { spacingAfter: 200 }),
    para("Please contact us if you have any questions regarding the above.", { size: 20 }),
    para("", { spacingAfter: 200 }),
    para(reviewer || "", { bold: true, spacingAfter: 0 }),
    para(e.legalName || "Setty & Associates, Ltd. PC", { spacingAfter: 0 }),
    para(fmtDay(date), { color: "44546A" }),
  ].join("");
  const sect = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1200" w:right="1440" w:bottom="1200" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${head}${title}${detailsTable(rows)}${para("", { spacingAfter: 160 })}${question}${response}${closing}${sect}</w:body></w:document>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

/** The .docx parts: [[path, bytes], ...] in zip order. */
export function buildReturnDocxParts(input) {
  const enc = new TextEncoder();
  return [
    ["[Content_Types].xml", enc.encode(CONTENT_TYPES_XML)],
    ["_rels/.rels", enc.encode(ROOT_RELS_XML)],
    ["word/document.xml", enc.encode(documentXml(input))],
    ["word/_rels/document.xml.rels", enc.encode(DOC_RELS_XML)],
    ["word/styles.xml", enc.encode(STYLES_XML)],
  ];
}

/** The .docx as bytes. */
export async function buildReturnDocx(input) {
  return zip(buildReturnDocxParts(input));
}

/** File name for the document inside the item's folder. */
export function returnFileName(item, type, revision) {
  const base = (item.number || "item") + " - " + (type === "rfi" ? "RFI Response" : "Submittal Return");
  return base.replace(/[\\/:*?"<>|#%]/g, "-") + (revision > 1 ? " -r" + revision : "") + ".docx";
}

/** Folder names under the portal Deliverables folder. */
export const RETURN_FOLDER = { rfi: "RFI Responses", submittal: "Submittal Returns" };
export function returnItemFolderName(item, type) {
  const subject = (type === "rfi" ? item.title : item.description) || "";
  return ((item.number || "") + " - " + subject).replace(/[\\/:*?"<>|#%]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}
