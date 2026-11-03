// node --test portalReturnDoc.test.mjs
// The Word document returned to the contractor through the portal: a complete
// package, the right text in the right places, everything escaped.
import test from "node:test";
import assert from "node:assert/strict";
import { unzip } from "./setty-docx.js";
import {
  buildReturnDocx, buildReturnDocxParts, documentXml, htmlToText, textParas, returnFileName,
  returnItemFolderName, RETURN_FOLDER, xmlEsc,
} from "./portalReturnDoc.js";

const txt = (u8) => new TextDecoder().decode(u8);
const ENTITY = { legalName: "Setty & Associates, Ltd. PC", legalNameCaps: "SETTY & ASSOCIATES, LTD. PC", addressLines: ["149 W 36th Street, 8th Floor", "New York, NY 10018"], phone: "646-253-9000" };
const PROJECT = { name: "County of Dutchess 10 Market Street CA", projectNumber: "SAPX176021.01" };
const RFI = { number: "RFI-005", title: "Condensate line routing <above ceiling>", description: "<p>Can the line run above the ceiling?</p><p>Second question &amp; detail.</p>", response: "<p>Yes, provided:</p><ul><li>slope 1/8\" per foot</li><li>insulate</li></ul>", from: "Jane Doe, Acme", extNumber: "Acme 12", dateReceived: "2026-11-02", specSection: "23 05 00" };
const SUB = { number: "SUB-008", description: "Exhaust fans EF-1 to EF-4 — Greenheck", comments: "Approved as noted. Provide vibration isolators.", stamp: "Approved as Noted", resubNumber: 1, dateReceived: "2026-11-02" };

test("RFI response document is a complete package with letterhead, details, question and response", async () => {
  const bytes = await buildReturnDocx({ entity: ENTITY, project: PROJECT, item: RFI, type: "rfi", date: "2026-11-10", reviewer: "Sara Arias, P.E." });
  const parts = await unzip(bytes.buffer);
  for (const p of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml"]) assert.ok(parts.has(p), p);
  const doc = txt(parts.get("word/document.xml"));
  assert.ok(doc.includes("SETTY &amp; ASSOCIATES, LTD. PC"));
  assert.ok(doc.includes("149 W 36th Street, 8th Floor"));
  assert.ok(doc.includes(">RFI RESPONSE<"));
  assert.ok(doc.includes("County of Dutchess 10 Market Street CA (SAPX176021.01)"));
  assert.ok(doc.includes(">RFI-005<"));
  assert.ok(doc.includes("Condensate line routing &lt;above ceiling&gt;"), "subject escaped");
  assert.ok(doc.includes("Acme 12") && doc.includes("23 05 00") && doc.includes("Jane Doe, Acme"));
  assert.ok(doc.includes("November 2, 2026") && doc.includes("November 10, 2026"));
  assert.ok(doc.includes("CONTRACTOR&apos;S QUESTION") || doc.includes("CONTRACTOR'S QUESTION"));
  assert.ok(doc.includes("Second question &amp; detail."), "question html stripped and re-escaped");
  assert.ok(doc.includes("• slope 1/8&quot; per foot"), "list items become bullet lines");
  assert.ok(doc.includes("Sara Arias, P.E."));
  assert.ok(!doc.includes("<p>") && !doc.includes("<ul>"), "no raw html in the document");
  assert.ok(doc.includes("<w:sectPr>"));
});

test("submittal return carries the stamp and revision and no question block", () => {
  const doc = documentXml({ entity: ENTITY, project: PROJECT, item: SUB, type: "submittal", date: "2026-11-10", reviewer: "R" });
  assert.ok(doc.includes(">SUBMITTAL RETURN<"));
  assert.ok(doc.includes("Approved as Noted"));
  assert.ok(doc.includes(">Revision<") && doc.includes(">1<"));
  assert.ok(doc.includes(">REVIEW COMMENTS<"));
  assert.ok(!doc.includes("CONTRACTOR"));
  assert.ok(doc.includes("Provide vibration isolators."));
});

test("a missing response is said plainly, never blank", () => {
  const doc = documentXml({ entity: ENTITY, project: PROJECT, item: { ...RFI, response: "" }, type: "rfi", date: "2026-11-10", reviewer: "R" });
  assert.ok(doc.includes("(no response text entered)"));
});

test("html → text and text → paragraphs", () => {
  assert.equal(htmlToText("<p>a</p><p>b &amp; c</p><br>"), "a\nb & c");
  const p = textParas("one\n\ntwo");
  assert.equal((p.match(/<w:p>/g) || []).length, 3);
  assert.ok(p.includes(">one<") && p.includes(">two<"));
  assert.equal(xmlEsc("<&\">"), "&lt;&amp;&quot;&gt;");
});

test("file and folder names are safe and revisions are suffixed", () => {
  assert.equal(returnFileName(RFI, "rfi", 1), "RFI-005 - RFI Response.docx");
  assert.equal(returnFileName(SUB, "submittal", 2), "SUB-008 - Submittal Return -r2.docx");
  assert.equal(returnItemFolderName({ number: "RFI-005", title: "A/B: c?" }, "rfi"), "RFI-005 - A-B- c-");
  assert.equal(RETURN_FOLDER.rfi, "RFI Responses");
  assert.equal(buildReturnDocxParts({ entity: ENTITY, project: PROJECT, item: RFI, type: "rfi", date: "2026-11-10", reviewer: "R" }).length, 5);
});
