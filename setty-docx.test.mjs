// Contract for setty-docx.js, the browser-side .docx pipeline.
//
// Run: node setty-docx.test.mjs
//
// Two jobs:
//   1. prove the zip layer round-trips a real .docx
//   2. PIN THE DRIFT. The section and token logic is duplicated from the two
//      .ts modules the Edge Function needs and a browser cannot import. This
//      imports BOTH and asserts identical output on the real template, so a
//      divergence fails here instead of shipping quietly.

import { existsSync, readFileSync } from "node:fs";
import * as browser from "./setty-docx.js";
import * as tsSections from "./supabase/functions/pms-mcp/docxSections.ts";
import * as tsRender from "./supabase/functions/pms-mcp/docxRender.ts";

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error("FAIL: " + msg); } };
const eq = (a, b, msg) => check(
  JSON.stringify(a) === JSON.stringify(b),
  `${msg}\n     expected ${JSON.stringify(b)}\n     actual   ${JSON.stringify(a)}`);

const TEMPLATE = "tools/docx-templates/build/proposal/TemplateProposal.docx";
if (!existsSync(TEMPLATE)) {
  console.log("SKIP: real template not on this machine; run tools/docx-templates first.");
  process.exit(0);
}
const raw = readFileSync(TEMPLATE);

// ── 1. zip round-trip ───────────────────────────────────────────────────────
{
  const parts = await browser.unzip(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  eq(parts.size, 73, "unzip: all 73 parts read");
  check(parts.has("word/document.xml"), "unzip: document.xml present");
  check(parts.get("word/media/image1.png").length > 0, "unzip: media inflated");

  const rezipped = await browser.zip(parts);
  const again = await browser.unzip(rezipped.buffer.slice(rezipped.byteOffset, rezipped.byteOffset + rezipped.byteLength));
  eq(again.size, parts.size, "round-trip: part count preserved");

  let identical = true, checked = 0;
  for (const [name, bytes] of parts) {
    const b2 = again.get(name);
    if (!b2 || b2.length !== bytes.length || !bytes.every((v, i) => v === b2[i])) {
      identical = false;
      console.error("   differs: " + name);
      break;
    }
    checked++;
  }
  check(identical, `round-trip: every part byte-identical (checked ${checked})`);
}

// ── 2. drift: browser JS vs the TypeScript modules ──────────────────────────
{
  const parts = await browser.unzip(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const xml = new TextDecoder().decode(parts.get("word/document.xml"));

  eq(browser.topLevelChildren(xml).length, tsSections.topLevelChildren(xml).length,
     "drift: same top-level child count");
  eq(browser.sections(xml).sections, tsSections.sections(xml).sections,
     "drift: identical section boundaries");
  eq(browser.PROPOSAL_PARTS, tsSections.PROPOSAL_PARTS, "drift: identical part map");

  for (const part of ["cover_page", "cover_letter", "terms", "firm_info"]) {
    check(browser.dropParts(xml, [part]) === tsSections.dropParts(xml, [part]),
          `drift: dropping ${part} gives identical XML`);
  }
  check(browser.dropParts(xml, ["cover_page", "terms"]) ===
        tsSections.dropParts(xml, ["cover_page", "terms"]),
        "drift: multi-part drop identical");

  const fields = { PROJECT_NAME: "MADE Bush Terminal", CLIENT_FIRM: "Smith & Jones" };
  eq(browser.renderDocumentXml(xml, fields).xml,
     tsRender.renderDocumentXml(xml, fields).xml,
     "drift: identical substitution output");
  eq(browser.renderDocumentXml(xml, fields).unfilled,
     tsRender.renderDocumentXml(xml, fields).unfilled,
     "drift: identical unfilled report");
}

// ── 3. buildDocx, the single call the PMS makes ─────────────────────────────
{
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const full = await browser.buildDocx(ab);
  const cut = await browser.buildDocx(ab, { omit: ["cover_letter", "terms"] });

  const pFull = await browser.unzip(full.bytes.buffer.slice(full.bytes.byteOffset, full.bytes.byteOffset + full.bytes.byteLength));
  const pCut = await browser.unzip(cut.bytes.buffer.slice(cut.bytes.byteOffset, cut.bytes.byteOffset + cut.bytes.byteLength));

  eq(pCut.size, pFull.size, "buildDocx: dropping sections does not drop package parts");

  const kidsFull = browser.topLevelChildren(new TextDecoder().decode(pFull.get("word/document.xml")));
  const kidsCut = browser.topLevelChildren(new TextDecoder().decode(pCut.get("word/document.xml")));
  eq(kidsFull.length, 397, "buildDocx: full document keeps 397 children");
  eq(kidsCut.length, 397 - 29 - 54, "buildDocx: cover letter (29) and terms (54) removed");

  // the look-carrying parts must survive untouched — except numbering.xml,
  // which buildDocx now deliberately repairs (indents, letter size, and the
  // restart definitions for Assumptions and Attachment A)
  const orig = await browser.unzip(ab);
  for (const name of ["word/media/image1.png", "word/styles.xml", "word/theme/theme1.xml"]) {
    const a = orig.get(name), b = pCut.get(name);
    check(a && b && a.length === b.length && a.every((v, i) => v === b[i]),
          `buildDocx: ${name} byte-identical`);
  }
  {
    const numOut = new TextDecoder().decode(pCut.get("word/numbering.xml"));
    check((numOut.match(/<w:startOverride w:val="1"\/>/g) || []).length >=
          (new TextDecoder().decode(orig.get("word/numbering.xml")).match(/<w:startOverride w:val="1"\/>/g) || []).length + 2,
          "buildDocx: numbering.xml gained the two restart definitions");
  }

  const ct = new TextDecoder().decode(pCut.get("[Content_Types].xml"));
  check(!ct.includes("wordprocessingml.template.main+xml"),
        "buildDocx: content type is a document, not a template");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall setty-docx tests passed");
process.exit(failures ? 1 : 0);
