// Proposal-formatting contract for setty-docx.js.
//
// Run: node setty-docx.proposal.test.mjs
//
// setty-docx.test.mjs needs the real tokenized template and skips without it.
// This file needs nothing: the fixture below reproduces the template's actual
// paragraph and numbering structures (copied from a generated proposal), so
// the first generated proposal's formatting defects stay fixed:
//   - run-in bold leads became headings (Project Approach all bold, included
//     sub-lines stealing list numbers 8/9/10)
//   - included services printed "1. 1. Title" (literal + auto number) as a
//     heading over an indented paragraph
//   - the excluded list printed twice and indented a full inch
//   - assumptions continued the excluded list's numbering
//   - the A./B./C. section letters rendered 11pt over 10pt headings
//   - Attachment A's letters continued the body's counter instead of
//     restarting, at 11pt
//   - the Accepted By line said "212 ARCHITECTS" (the template example
//     client, uppercase, missed by the tokenizer's case-sensitive pass)

import * as sd from "./setty-docx.js";

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error("FAIL: " + msg); } };
const eq = (a, b, msg) => check(
  JSON.stringify(a) === JSON.stringify(b),
  `${msg}\n     expected ${JSON.stringify(b)}\n     actual   ${JSON.stringify(a)}`);

// ── 1. htmlToBlocks: run-in bold lead vs heading ────────────────────────────
{
  const one = (html) => sd.htmlToBlocks(html)[0];
  eq(one("<p><b>A. </b>SCOPE OF ENGINEERING SERVICES</p>").kind, "h",
     "bold list marker + short caps remainder is a heading");
  eq(one("<p><b>B. </b><b>Expectations:</b></p>").kind, "h",
     "fully bold paragraph is a heading");
  eq(one("<p><b>Scope Report Phase.</b> Setty will attend the SCA scope meeting, prepare mechanical, electrical and plumbing narratives, and support the scope report deliverable.</p>").kind, "p",
     "bold lead + sentence is a body paragraph (Project Approach case)");
  eq(one("<p><b>Design Development / Design Manual (DD/DM):</b> One (1) M/E/P/FP design manual submission at the scope stage, issued for owner review.</p>").kind, "p",
     "bold sub-item lead + sentence is a body paragraph (included item 7 case)");
  eq(one("<h3>Project Approach</h3>").kind, "h", "real h3 stays a heading");
}

// ── 2. block helpers ────────────────────────────────────────────────────────
{
  eq(sd.stripEnum("1. Predesign Site Visit"), "Predesign Site Visit", "stripEnum digits");
  eq(sd.stripEnum("b) Second item"), "Second item", "stripEnum letters");
  eq(sd.stripEnum("Two (2) site visits"), "Two (2) site visits", "stripEnum leaves prose");

  const dd = sd.dedupeBlocks([
    { kind: "p", text: "Electrical testing services" },
    { kind: "p", text: "Electrical  testing services " },
    { kind: "p", text: "" },
    { kind: "p", text: "" },
    { kind: "p", text: "Site lighting design" },
  ]);
  eq(dd.map((b) => b.text), ["Electrical testing services", "", "", "Site lighting design"],
     "dedupeBlocks drops text-identical repeats, keeps empty spacers");

  const merged = sd.mergeItemBlocks([
    { kind: "h", text: "1. Predesign Site Visit" },
    { kind: "p", text: "Two (2) predesign site observations." },
    { kind: "h", text: "2. Preparation of Deliverables" },
    { kind: "p", text: "Setty will prepare deliverables." },
    { kind: "p", text: "Design Development: One (1) submission." },
    { kind: "h", text: "3. Heading-only item" },
  ]);
  eq(merged.length, 4, "mergeItemBlocks: 3 items, one continuation line");
  eq(merged[0], { kind: "h", text: "Two (2) predesign site observations.", plain: true },
     "item 1: body text becomes the numbered paragraph, title and literal number dropped");
  eq(merged[1], { kind: "h", text: "Setty will prepare deliverables.", plain: true },
     "item 2: first body paragraph numbered");
  eq(merged[2], { kind: "p", text: "Design Development: One (1) submission." },
     "item 2: further body paragraphs stay continuation lines");
  eq(merged[3], { kind: "h", text: "Heading-only item", plain: true },
     "a title with no body keeps its own text");

  eq(sd.mergeItemBlocks([{ kind: "p", text: "1. First item." }, { kind: "p", text: "2. Second item." }]),
     [{ kind: "h", text: "First item.", plain: true }, { kind: "h", text: "Second item.", plain: true }],
     "a box with no titles numbers every paragraph as an item");
}

// ── 3. buildDocx on a template-shaped fixture ───────────────────────────────

const P = (pPr, runs) => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs}</w:p>`;
const R = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const H1 = (numId) => `<w:pStyle w:val="Heading1"/>` +
  (numId != null ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` : "");

const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
  P("", R("Project Description: {{PROJECT_DESCRIPTION}}")) +
  P(H1(6), R("INCLUDED SERVICES:")) +
  P(H1(21), R("{{SCOPE_HEADING}}")) +
  P(H1(0) + `<w:ind w:left="720"/>`, R("{{SCOPE_BODY}}")) +
  P(H1(6), R("ADDITIONAL SERVICES:")) +
  P(H1(0), R("{{ADDITIONAL_HEADING}}")) +
  P(`<w:jc w:val="both"/>`, R("{{ADDITIONAL_BODY}}")) +
  P(H1(6), R("EXCLUDED SERVICES:")) +
  P(H1(0), R("{{EXCLUDED_HEADING}}")) +
  P(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="28"/></w:numPr>`, R("{{EXCLUDED_BODY}}")) +
  P(`<w:pStyle w:val="Heading1"/>`, R("ASSUMPTIONS")) +
  P(H1(0) + `<w:ind w:left="360"/>`, R("{{ASSUMPTIONS_HEADING}}")) +
  P(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="28"/></w:numPr>`, R("{{ASSUMPTIONS_BODY}}")) +
  P(`<w:pStyle w:val="Heading2"/>`, R("{{PROVISIONS_HEADING}}")) +
  P(`<w:pStyle w:val="Heading2"/><w:ind w:left="720"/>`, R("{{PROVISIONS_BODY}}")) +
  P("", `<w:r><w:t xml:space="preserve">Setty &amp; Associates, Ltd. PC</w:t><w:tab/><w:t>212 ARCHITECTS</w:t></w:r>`) +
  P(`<w:pStyle w:val="Heading1"/>`, R("TERMS AND CONDITIONS")) +
  P(`<w:pStyle w:val="Heading1"/>`, R("{{TERMS_HEADING}}")) +
  P(`<w:ind w:left="360"/>`, R("{{TERMS_BODY}}")) +
  `<w:sectPr/></w:body></w:document>`;

const NUM = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:b/><w:sz w:val="20"/></w:rPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="17"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="18"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:lvl></w:abstractNum>
<w:num w:numId="3"><w:abstractNumId w:val="18"/></w:num>
<w:num w:numId="6"><w:abstractNumId w:val="18"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
<w:num w:numId="21"><w:abstractNumId w:val="3"/></w:num>
<w:num w:numId="28"><w:abstractNumId w:val="17"/></w:num>
</w:numbering>`;

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

{
  const enc = new TextEncoder();
  const parts = new Map([
    ["[Content_Types].xml", enc.encode(CT)],
    ["word/document.xml", enc.encode(DOC)],
    ["word/numbering.xml", enc.encode(NUM)],
  ]);
  const bytes = await sd.zip(parts);

  const built = await sd.buildDocx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    fields: { CLIENT_FIRM: "Zambrano Architects" },
    scopeSections: {
      included:
        "<h3>1. Predesign Site Visit</h3><div><p>Two (2) predesign site observations of the existing MEP systems.</p></div>" +
        "<h3>2. Preparation of Deliverables</h3><div><p>Setty will prepare mechanical, electrical and plumbing deliverables at each phase.</p>" +
        "<p><b>Design Development / Design Manual (DD/DM):</b> One (1) M/E/P/FP design manual submission at the scope stage, issued for owner review.</p></div>",
      additional: "<p>Value engineering or redesign efforts.</p>",
      excluded:
        "<div><p>Electrical testing services (load testing).</p></div>" +
        "<div><p>MEP/FP system testing (e.g., TAB).</p></div>" +
        "<div><p>Electrical testing services (load testing).</p></div>",
      assumptions: "<p>Access to all areas will be provided.</p><p>Architectural backgrounds will be furnished in CAD.</p>",
      provisions: "",
    },
    paragraphs: {
      // First block fills the token in place (keeping the label's own
      // formatting), so the h3 sits second to exercise the clone path.
      PROJECT_DESCRIPTION:
        "<p>Zambrano Architects has requested a proposal for the library conversion.</p>" +
        "<h3>Project Approach</h3>" +
        "<p><b>Scope Report Phase.</b> Setty will attend the SCA scope meeting, prepare narratives, and support the scope report deliverable through the review cycle.</p>",
    },
    termsHtml:
      "<h1>STANDARD TERMS AND CONDITIONS</h1><p>These Standard Terms and Conditions are incorporated into the Proposal.</p>" +
      "<h2>1. Basis of Proposal</h2><p>Basis body.</p><h2>2. Compensation</h2><p>Compensation body.</p>",
  });

  const out = await sd.unzip(built.bytes.buffer.slice(built.bytes.byteOffset, built.bytes.byteOffset + built.bytes.byteLength));
  const dec = new TextDecoder();
  const doc = dec.decode(out.get("word/document.xml"));
  const num = dec.decode(out.get("word/numbering.xml"));
  // paragraph containing `text`, matched per-paragraph so assertions cannot
  // bleed across paragraph boundaries
  const paraWith = (text) => {
    const m = [...doc.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].find((p) => p[0].includes(text));
    return m ? m[0] : "";
  };

  eq(built.unfilled, [], "no tokens left unfilled");

  // included: one numbered paragraph per item, body text, no titles, unbolded
  check(!doc.includes("Predesign Site Visit"), "included: title line dropped");
  check(!doc.includes("1. Predesign"), "included: no literal number survives");
  const item1 = paraWith("Two (2) predesign");
  check(item1.includes('<w:numId w:val="21"/>'), "included: item is auto-numbered");
  check(item1.includes('<w:b w:val="0"/>'), "included: item text unbolded against Heading1");
  const sub = paraWith("Design Development / Design Manual");
  check(sub && !sub.includes('<w:numId w:val="21"/>'), "included: run-in sub-line is a continuation, not a numbered item");

  // excluded: deduped, indent repaired
  eq((doc.match(/Electrical testing services/g) || []).length, 1, "excluded: duplicate item printed once");
  check(num.includes('<w:abstractNum w:abstractNumId="17"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/>'),
        "numbering: excluded/assumptions list indents 720, not 1440");

  // assumptions: restart on a fresh num
  check(num.includes('<w:num w:numId="29"><w:abstractNumId w:val="17"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'),
        "numbering: assumptions restart definition added");
  const asm = paraWith("Access to all areas");
  check(asm.includes('<w:numId w:val="29"/>'), "assumptions: items repointed at the restart definition");

  // section letters at 10pt
  check(num.includes('<w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:b/><w:sz w:val="20"/></w:rPr>'),
        "numbering: A./B./C. letters are 10pt");

  // included item numbers not bold now that item text is body weight
  check(num.includes('<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:b w:val="0"/><w:sz w:val="20"/></w:rPr>'),
        "numbering: included item numbers unbolded");

  // Attachment A: letters restart, title unnumbered
  check(num.includes('<w:num w:numId="30"><w:abstractNumId w:val="18"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'),
        "numbering: Attachment A restart definition added");
  const basis = paraWith("Basis of Proposal");
  check(basis.includes('<w:numId w:val="30"/>'), "terms: headings repointed at the restart definition");
  const tTitle = paraWith(">TERMS AND CONDITIONS<");
  check(tTitle.includes('<w:numId w:val="0"/>'), "terms: attachment title carries no letter");

  // description: run-in bold lead renders as a plain paragraph
  const appr = paraWith("Setty will attend the SCA scope meeting");
  check(appr && !/<w:b\/>/.test(appr), "description: approach paragraph is not bolded");
  const apprH = paraWith(">Project Approach<");
  check(apprH && /<w:b\/>/.test(apprH), "description: real h3 heading still bolds");

  // Accepted By names the client, on ITS side of the column tab
  check(!doc.includes("212 ARCHITECTS"), "Accepted By: template example client removed");
  check(/PC<\/w:t><w:tab\/><w:t[^>]*>Zambrano Architects</.test(doc),
        "Accepted By: real client firm in place, right of the column tab");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall setty-docx proposal tests passed");
process.exit(failures ? 1 : 0);
