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
  eq(merged[2], { kind: "p", text: "Design Development: One (1) submission.", bullet: true },
     "item 2: further body paragraphs become bulleted continuation lines");
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
  P(`<w:pStyle w:val="Heading1"/><w:rPr><w:szCs w:val="20"/></w:rPr>`, R("ASSUMPTIONS")) +
  P(H1(0) + `<w:ind w:left="360"/>`, R("{{ASSUMPTIONS_HEADING}}")) +
  P(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="28"/></w:numPr>`, R("{{ASSUMPTIONS_BODY}}")) +
  P(`<w:pStyle w:val="Heading2"/>`, R("{{PROVISIONS_HEADING}}")) +
  P(`<w:pStyle w:val="Heading2"/><w:ind w:left="720"/>`, R("{{PROVISIONS_BODY}}")) +
  P(`<w:ind w:left="720"/>`, `<w:r><w:t xml:space="preserve">{{RATE_ROLE_A}}</w:t><w:tab/><w:t>{{RATE_A}}</w:t><w:tab/><w:t>{{RATE_ROLE_B}}</w:t><w:tab/><w:t>{{RATE_B}}</w:t></w:r>`) +
  P(`<w:pStyle w:val="Heading1"/>`, R("FEES")) +
  // Basic Fee sentence and rows SPLIT across many runs, as the real
  // template has them (rsid fragmentation) — position-based run writing
  // interleaved new text with old remnants here.
  P(`<w:ind w:left="360"/><w:jc w:val="both"/>`,
    `<w:r><w:rPr><w:b/></w:rPr><w:t>Basic Fee:</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> The fee for services will be </w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">FORTY THOUSAND EIGHT HUNDRED DOLLARS </w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">AND NO CENTS (</w:t></w:r>` +
    `<w:r><w:t>$</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">40,800.00). This project is to be invoiced lump sum, plus expenses based on the stages of completion listed below.  </w:t></w:r>`) +
  P(`<w:pStyle w:val="Default"/><w:ind w:left="1800"/>`,
    `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">Design </w:t></w:r>` +
    `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">Manual</w:t><w:tab/></w:r>` +
    `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>$</w:t></w:r>` +
    `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>12,2</w:t></w:r>` +
    `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>40.00</w:t></w:r>`) +
  P(`<w:pStyle w:val="Default"/><w:ind w:left="1800"/>`,
    `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">Construction Documents/Permit</w:t><w:tab/></w:r>` +
    `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>$</w:t></w:r>` +
    `<w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>16,320.00</w:t></w:r>`) +
  P(`<w:pStyle w:val="Default"/><w:ind w:left="1800"/>`, "") + // the rule/spacer line
  P(`<w:pStyle w:val="Default"/><w:ind w:left="1800"/>`,
    `<w:r><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">Total </w:t><w:tab/></w:r>` +
    `<w:r><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>$</w:t></w:r>` +
    `<w:r><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>40,800.00</w:t></w:r>`) +
  P("", `<w:r><w:t xml:space="preserve">Setty &amp; Associates, Ltd. PC</w:t><w:tab/><w:t>212 ARCHITECTS</w:t></w:r>`) +
  P(`<w:pStyle w:val="Heading1"/>`, R("TERMS AND CONDITIONS")) +
  P(`<w:pStyle w:val="Heading1"/>`, R("{{TERMS_HEADING}}")) +
  P(`<w:ind w:left="360"/>`, R("{{TERMS_BODY}}")) +
  `<w:sectPr/></w:body></w:document>`;

// The sent-proposal footer: Fairfax | New York columns, the NY street stale
// (and truncated at "21s" in the template itself), and a leftover FPID.
const FTR = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  P("", `<w:r><w:t>3040 Williams Drive, Suite 600</w:t><w:tab/><w:t>535 8th Avenue, 21s</w:t></w:r>`) +
  P("", `<w:r><w:t>Fairfax, VA 22031</w:t><w:tab/><w:t>New York, NY 10018</w:t></w:r>`) +
  P("", `<w:r><w:t xml:space="preserve">F: [703-691-8084] FPID: ANY10233R00</w:t><w:tab/><w:t>F: [646-224-8497]</w:t></w:r>`) +
  `</w:ftr>`;

const HDR = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  P(`<w:pStyle w:val="Header"/><w:jc w:val="center"/>`,
    `<w:r><w:rPr><w:color w:val="808080"/><w:sz w:val="16"/></w:rPr><w:t>FPID: ANY10233R00</w:t></w:r>`) +
  `</w:hdr>`;

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
    ["word/header1.xml", enc.encode(HDR)],
    ["word/footer1.xml", enc.encode(FTR)],
  ]);
  const bytes = await sd.zip(parts);

  const logoBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const built = await sd.buildDocx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    fields: { CLIENT_FIRM: "Zambrano Architects", PROJECT_NAME: "Frank McCourt High School" },
    rates: [{ role: "Principal", rate: 336 }, { role: "Project Manager", rate: 205 }],
    fees: {
      totalWords: "FORTY THOUSAND SIX HUNDRED NINETY-EIGHT DOLLARS AND NO CENTS",
      totalAmount: "40,698.00",
      feeType: "lump sum",
      rows: [
        { label: "Conditions Assessment", amount: "14,244.30" },
        { label: "Design Development Documents", amount: "26,453.70" },
      ],
    },
    headerLogo: logoBytes,
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
      provisions:
        "<p>This proposal, including the associated fee, is based on the following provisions.</p>" +
        "<p><strong>Fee Structure.</strong> This proposal is based on the assumption of a lump sum contract.</p>",
    },
    paragraphs: {
      // The leading "Project Understanding" heading must be dropped (it lands
      // inline after the label); the h3 later exercises the clone path.
      PROJECT_DESCRIPTION:
        "<h3>Project Understanding</h3>" +
        "<p>Zambrano Architects has requested a proposal for the library conversion.</p>" +
        "<h3>Project Approach</h3>" +
        "<p><b>Scope Report Phase.</b> Setty will attend the SCA scope meeting, prepare narratives, and support the scope report deliverable through the review cycle.</p>",
    },
    termsHtml:
      "<h1>STANDARD TERMS AND CONDITIONS</h1><p>These Standard Terms and Conditions are incorporated into the Proposal.</p>" +
      "<h2>1. Basis of Proposal</h2><p>Basis body.</p><h2>2. Compensation</h2><p>Compensation body.</p>",
  });

  const out = await sd.unzip(built.bytes.buffer.slice(built.bytes.byteOffset, built.bytes.byteOffset + built.bytes.byteLength));
  globalThis.__lastOut = out;
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
  check(sub && !sub.includes('<w:numId w:val="21"/>'), "included: run-in sub-line is not a numbered item");
  check(sub.includes('<w:numId w:val="31"/>') && sub.includes('<w:ind w:left="1440" w:hanging="360"/>'),
        "included: sub-line is an indented bullet");
  check(num.includes('<w:numFmt w:val="bullet"/>') &&
        num.includes('<w:num w:numId="31">'),
        "numbering: bullet list defined for included sub-lines");

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

  // description: leading heading gone, blank line between paragraphs
  check(!doc.includes("Project Understanding"), "description: leading heading dropped");
  const introIdx = doc.indexOf("library conversion.");
  const apprHeadIdx = doc.indexOf(">Project Approach<");
  check(introIdx !== -1 && apprHeadIdx > introIdx &&
        /<w:t xml:space="preserve"><\/w:t>/.test(doc.slice(introIdx, apprHeadIdx)),
        "description: blank paragraph between blocks");

  // a blank paragraph separates the included list from ADDITIONAL SERVICES
  {
    const lastItemEnd = doc.indexOf("</w:p>", doc.indexOf("Design Development / Design Manual"));
    const addIdx = doc.indexOf(">ADDITIONAL SERVICES:<");
    check(lastItemEnd !== -1 && addIdx > lastItemEnd &&
          doc.slice(lastItemEnd, addIdx).includes('<w:t xml:space="preserve"></w:t>'),
          "included: trailing blank before ADDITIONAL SERVICES");
  }

  // the tight section headings carry spacing-after 0
  for (const t of ["ADDITIONAL SERVICES:", "EXCLUDED SERVICES:", "ASSUMPTIONS", "FEES"]) {
    check((paraWith(">" + t + "<") || "").includes('<w:spacing w:after="0"'),
          `chrome heading "${t}" tightened`);
  }
  // the ASSUMPTIONS heading has a paragraph-mark rPr: the spacing must land
  // BEFORE it (schema order), where Word honors it — the first fix did not
  check(/<w:spacing w:after="0"\/><w:rPr><w:szCs w:val="20"\/><\/w:rPr><\/w:pPr>[^]*?>ASSUMPTIONS</.test(paraWith(">ASSUMPTIONS<")),
        "chrome heading: spacing precedes the paragraph-mark rPr");

  // provisions: intro paragraph pulled back to the section margin, no gap
  const provIntro = paraWith("based on the following provisions");
  check(provIntro.includes('<w:ind w:left="360"/>'), "provisions: intro indent decreased to 360");
  check(provIntro.includes('w:before="0"'), "provisions: no gap under the E heading");

  // body text left-aligned, not justified
  check(!doc.includes('<w:jc w:val="both"/>'), "body: no justified paragraphs remain");
  check(doc.includes('<w:jc w:val="left"/>'), "body: justification flipped to left");

  // terms: one paragraph per section, tight heading, single spacer between
  check(basis.includes('<w:spacing w:after="0"'), "terms: heading clone tightened");
  check(paraWith("Basis body.") !== "", "terms: section body present");

  // hourly rates: own lettered section heading before the rate rows
  const ratesHead = paraWith(">SCHEDULE OF HOURLY RATES<");
  check(ratesHead.includes('<w:pStyle w:val="Heading1"/>'), "rates: SCHEDULE OF HOURLY RATES heading added");
  check(paraWith("Principal:").includes("$336.00/hr."), "rates: rows filled");

  // fee block: real figures over the template example, at 10pt, with no
  // remnants of the example text left beside them (the split-run trap)
  check(!doc.includes("FORTY THOUSAND EIGHT HUNDRED"), "fees: example sentence replaced");
  check(doc.includes("FORTY THOUSAND SIX HUNDRED NINETY-EIGHT DOLLARS AND NO CENTS"), "fees: real total in words");
  check(!doc.includes("40,800.00") && !doc.includes("16,320.00") &&
        !doc.includes("12,240.00") && !doc.includes("12,2</w:t>") && !doc.includes(">40.00<"),
        "fees: example amounts gone, including split-run fragments");
  eq((doc.match(/40,698\.00/g) || []).length, 2, "fees: real total in sentence and Total row");
  check((paraWith("Basic Fee:").match(/This project is to be invoiced/g) || []).length === 1,
        "fees: sentence appears once, no duplicated tail");
  const ddRow = paraWith("Conditions Assessment</w:t>");
  check(ddRow.includes("14,244.30"), "fees: phase row amount filled");
  check(!ddRow.includes("Manual") && !ddRow.includes("Design "),
        "fees: no example-label fragment beside the new label");
  check(ddRow.includes('<w:sz w:val="20"/>') && !ddRow.includes('<w:sz w:val="22"/>'),
        "fees: chart set to 10pt body size");
  check(paraWith("Design Development Documents").includes("26,453.70"), "fees: second phase row present");

  // header: FPID gone, project name + logo in, package parts added
  const hdr = dec.decode(out.get("word/header1.xml"));
  check(!hdr.includes("FPID"), "header: FPID line removed");
  check(hdr.includes("Frank McCourt High School"), "header: project name present");
  check(hdr.includes('r:embed="rIdSettyLogo"'), "header: logo drawing embedded");
  check(!hdr.includes('<w:jc w:val="center"/>'), "header: paragraph left-aligned so the logo sits at the margin");
  check(/<\/w:drawing><\/w:r><w:r>[^]*?<w:tab\/><\/w:r><w:r>[^]*?Frank McCourt High School</.test(hdr),
        "header: name tabs to the center stop after the logo");
  check(!!out.get("word/media/settylogo.png"), "header: logo media part added");
  check(dec.decode(out.get("word/_rels/header1.xml.rels")).includes("media/settylogo.png"),
        "header: relationship written");
  check(dec.decode(out.get("[Content_Types].xml")).includes('Extension="png"'),
        "header: png content type declared");

  // footer: current NY office in, old office and stale FPID out
  const ftr = dec.decode(out.get("word/footer1.xml"));
  check(ftr.includes("149 W 36th Street, 8th Floor"), "footer: current NY street in place");
  check(!ftr.includes("535 8th Avenue"), "footer: old NY street removed");
  check(!ftr.includes("FPID"), "footer: stale FPID removed");
  check(ftr.includes("3040 Williams Drive, Suite 600") && ftr.includes("Fairfax, VA 22031"),
        "footer: Fairfax column untouched");
  check(ftr.includes("F: [703-691-8084]") && ftr.includes("F: [646-224-8497]"),
        "footer: fax lines survive the FPID removal");

  // the full-length old street maps as one string (prefix key must not win)
  {
    const para = sd.replaceAll('<w:p><w:r><w:t>535 8th Avenue, 21st Floor</w:t></w:r></w:p>', sd.CHROME_FIX);
    check(para.includes(">149 W 36th Street, 8th Floor<"), "chrome map: full old street replaced cleanly");
    check(!para.includes("t Floor</w:t></w:r></w:p>") || para.includes("8th Floor</w:t>"),
          "chrome map: no stranded 't Floor'");
  }
}

// ── 4. omitting Attachment A also removes the body's reference to it ────────
{
  const sec = (inner) => inner + `<w:p><w:pPr><w:sectPr/></w:pPr></w:p>`;
  let body = "";
  for (let i = 0; i < 7; i++) {
    body += sec(i === 5
      ? P(`<w:pStyle w:val="Heading1"/>`, R("TERMS AND CONDITIONS AS OUTLINED IN ATTACHMENT A."))
      : P("", R("section " + i)));
  }
  body += sec(P("", R("attachment A terms content")));   // section 7 = terms
  body += P("", R("tail")) + `<w:sectPr/>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` + body + `</w:body></w:document>`;
  const enc = new TextEncoder();
  const parts = new Map([["[Content_Types].xml", enc.encode(CT)], ["word/document.xml", enc.encode(doc)]]);
  const bytes = await sd.zip(parts);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const cut = await sd.buildDocx(ab, { omit: ["terms"] });
  const cutDoc = new TextDecoder().decode((await sd.unzip(cut.bytes.buffer.slice(cut.bytes.byteOffset, cut.bytes.byteOffset + cut.bytes.byteLength))).get("word/document.xml"));
  check(!cutDoc.includes("attachment A terms content"), "omit terms: attachment section dropped");
  check(!cutDoc.includes("AS OUTLINED IN ATTACHMENT A"), "omit terms: body reference heading removed");

  const full = await sd.buildDocx(ab, {});
  const fullDoc = new TextDecoder().decode((await sd.unzip(full.bytes.buffer.slice(full.bytes.byteOffset, full.bytes.byteOffset + full.bytes.byteLength))).get("word/document.xml"));
  check(fullDoc.includes("AS OUTLINED IN ATTACHMENT A"), "with terms: the reference heading stays");
}

// DUMP_DIR=<dir> writes the rendered parts out for external well-formedness
// checks (see the python xml.dom.minidom pass in the PR notes).
if (process.env.DUMP_DIR) {
  const { writeFileSync } = await import("node:fs");
  const dec2 = new TextDecoder();
  for (const n of ["word/document.xml", "word/numbering.xml", "word/header1.xml", "word/_rels/header1.xml.rels", "[Content_Types].xml"]) {
    writeFileSync(process.env.DUMP_DIR + "/" + n.replace(/[\/\[\]]/g, "_"), dec2.decode(globalThis.__lastOut.get(n)));
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall setty-docx proposal tests passed");
process.exit(failures ? 1 : 0);
