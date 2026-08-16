// Behavioural contract for docxRender.ts — the deterministic .docx renderer.
//
// Run: node supabase/functions/pms-mcp/docxRender.test.mjs
//
// Unlike the other tests here, this one imports the REAL module instead of
// keeping copies with a drift detector. It can, because docxRender.ts has no
// imports and is erasable-syntax-only TypeScript, which Node 22.6+ strips
// natively. No copies means no drift, so prefer this shape for any future
// logic that can be lifted out of index.ts.
//
// Every case below is a bug that actually happened while building the Python
// original. They are regression tests, not hypotheticals.

import {
  INSTRUCTION_MARKERS, expandList, isEditablePart, markFieldsDirty,
  renderDocumentXml, replaceAll, replaceInParagraph, runText,
  stripInstructionTextboxes, templateToDocument, xmlEscape,
} from "./docxRender.ts";

let failures = 0;
function check(ok, msg) {
  if (!ok) { failures++; console.error("FAIL: " + msg); }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  check(a === b, `${msg}\n     expected ${b}\n     actual   ${a}`);
}

const run = (t, extra = "") => `<w:r${extra}><w:t>${t}</w:t></w:r>`;
const para = (...inner) => `<w:p>${inner.join("")}</w:p>`;
const textOf = (p) => (p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
  .map((s) => s.replace(/<[^>]+>/g, "")).join("");

// ── 1. run splitting ────────────────────────────────────────────────────────
// Word stores one logical string across several runs. In the real add service
// template 4 of 11 targets are not literal strings in document.xml, including
// the date and the first fee. A naive replace fails on exactly those.
{
  const p = para(run("Octo"), run("ber 20, "), run("2025"));
  const { para: out, count } = replaceInParagraph(p, "October 20, 2025", "{{DATE}}");
  eq(count, 1, "run-split: one replacement");
  eq(textOf(out), "{{DATE}}", "run-split: value replaced across three runs");
}

// ── 2. zero-width runs ──────────────────────────────────────────────────────
// Runs with no <w:t> (tab stops, bookmark markers) have zero text width.
// Targeting one drops the replacement with no error. This cost 6 of 16 tokens
// on the first attempt while the build still reported 12/12 "ok".
{
  const p = para(
    run("Date:"),
    '<w:r><w:tab/></w:r>',                       // zero-width, no <w:t>
    '<w:bookmarkStart w:id="0" w:name="txtX"/>',
    run("October 20, 2025"),
  );
  const { para: out, count } = replaceInParagraph(p, "October 20, 2025", "{{DATE}}");
  eq(count, 1, "zero-width: one replacement");
  check(out.includes("{{DATE}}"), "zero-width: token actually landed in the file");
  check(out.includes("<w:tab/>"), "zero-width: tab run preserved verbatim");
  check(out.includes("bookmarkStart"), "zero-width: bookmark preserved verbatim");
  eq(textOf(out), "Date:{{DATE}}", "zero-width: surrounding text intact");
}

// ── 3. nth selection ────────────────────────────────────────────────────────
// '[Insert Date]' means ISSUE DATE at occurrence 1 and CONTRACT DATE at 2.
// Ops on one (paragraph, find) pair must be applied in DESCENDING nth so the
// index refers to the original document.
{
  const p = para(run("ISSUE: [Insert Date]  CONTRACT: [Insert Date]"));
  let out = replaceInParagraph(p, "[Insert Date]", "{{CONTRACT_DATE}}", 2).para;
  out = replaceInParagraph(out, "[Insert Date]", "{{ISSUE_DATE}}", 1).para;
  eq(textOf(out), "ISSUE: {{ISSUE_DATE}}  CONTRACT: {{CONTRACT_DATE}}",
     "nth: both placeholders resolved distinctly");

  eq(replaceInParagraph(p, "[Insert Date]", "X", 9).count, 0, "nth: out of range is a no-op");
}

// ── 4. list expansion ───────────────────────────────────────────────────────
{
  const xml = para(run("keep")) + para(run("{{SCOPE_ITEMS}}")) + para(run("tail"));
  const r = expandList(xml, "{{SCOPE_ITEMS}}", ["one", "two", "three"]);
  check(r.found, "list: token located");
  eq((r.xml.match(/<w:p>/g) || []).length, 5, "list: 3 clones + 2 untouched paragraphs");
  check(r.xml.includes("one") && r.xml.includes("three"), "list: items present");

  const empty = expandList(xml, "{{SCOPE_ITEMS}}", []);
  eq((empty.xml.match(/<w:p>/g) || []).length, 2, "list: empty list removes the paragraph");
}

// ── 5. author call-outs ─────────────────────────────────────────────────────
// The subagreement carries 5 red boxes, each existing twice as the mc:Choice
// and mc:Fallback rendering of one AlternateContent. Removing the whole
// AlternateContent takes both. Nested <w:p> inside is why this must run BEFORE
// substitution — two placeholders hid behind the resulting mis-parse.
{
  const callout =
    '<mc:AlternateContent><mc:Choice><w:drawing><w:txbxContent>' +
    para(run("Once you’ve reached here, press Ctrl-A then F9 again.")) +
    '</w:txbxContent></w:drawing></mc:Choice></mc:AlternateContent>';
  const xml = para(run("before")) + callout + para(run("[SETTY P/N]"));
  const r = stripInstructionTextboxes(xml);
  eq(r.removed, 1, "call-outs: one AlternateContent removed");
  check(!r.xml.includes("Ctrl-A"), "call-outs: instruction text gone");
  check(r.xml.includes("before") && r.xml.includes("[SETTY P/N]"),
        "call-outs: surrounding paragraphs survive");
  eq(replaceAll(r.xml, { "[SETTY P/N]": "{{PROJECT_NUMBER}}" }).includes("{{PROJECT_NUMBER}}"),
     true, "call-outs: placeholder reachable once the box is gone");
  check(INSTRUCTION_MARKERS.every((m) => !r.xml.includes(m)), "call-outs: no marker survives");
}

// ── 6. stale REF fields ─────────────────────────────────────────────────────
{
  const xml = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:instrText> REF SubCompany \\h </w:instrText>';
  const once = markFieldsDirty(xml);
  eq(once.marked, 1, "fields: one field marked");
  check(once.xml.includes('w:dirty="true"'), "fields: dirty attribute added");
  eq(markFieldsDirty(once.xml).marked, 0, "fields: idempotent, no double-marking");
}

// ── 7. .dotx content type ───────────────────────────────────────────────────
// A template content type under a .docx name makes Word reject the file as
// corrupt. Six of the eight Setty templates are .dotx.
{
  const ct = '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"/>';
  const out = templateToDocument(ct);
  check(out.includes("document.main+xml"), "content type: converted to document");
  check(!out.includes("template.main+xml"), "content type: template type gone");
}

// ── 8. escaping ─────────────────────────────────────────────────────────────
// Firm names contain ampersands. An unescaped one produces invalid XML, which
// Word reports as a corrupt file.
{
  eq(xmlEscape("Setty & Associates <PC>"), "Setty &amp; Associates &lt;PC&gt;", "escape: & and <>");
  const p = para(run("{{CLIENT_FIRM}}"));
  const r = renderDocumentXml(p, { CLIENT_FIRM: "Smith & Jones" });
  check(r.xml.includes("Smith &amp; Jones"), "escape: applied to field values");
  check(!/[^&]&[^a]/.test(r.xml), "escape: no bare ampersand left");
}

// ── 9. missing-field policy ─────────────────────────────────────────────────
// Default is "leave": these are fee-bearing contracts, so a visible token is
// preferable to a silently blank fee.
{
  const p = para(run("Fee {{FEE}} dated {{ORIGINAL_CONTRACT_DATE}}"));
  const left = renderDocumentXml(p, { FEE: "$100.00" });
  eq(left.unfilled, ["{{ORIGINAL_CONTRACT_DATE}}"], "missing/leave: reported");
  check(left.xml.includes("{{ORIGINAL_CONTRACT_DATE}}"), "missing/leave: token still visible");
  check(left.warnings.some((w) => w.startsWith("UNFILLED")), "missing/leave: warned");

  const blanked = renderDocumentXml(p, { FEE: "$100.00" }, { onMissing: "blank" });
  check(!blanked.xml.includes("{{"), "missing/blank: token removed");

  let threw = false;
  try { renderDocumentXml(p, { FEE: "$100.00" }, { onMissing: "fail" }); } catch { threw = true; }
  check(threw, "missing/fail: refuses to render");

  const full = renderDocumentXml(p, { FEE: "$100.00", ORIGINAL_CONTRACT_DATE: "3/26/2020" });
  eq(full.unfilled, [], "complete: nothing unfilled");
  eq(full.warnings, [], "complete: no warnings");
}

// ── 10. part selection ──────────────────────────────────────────────────────
// Only text parts and the content types are edited. Everything else — the
// 471 KB logo, styles, theme, numbering — is copied through untouched, which
// is what preserves the letterhead.
{
  for (const p of ["word/document.xml", "word/header1.xml", "word/footer2.xml", "[Content_Types].xml"]) {
    check(isEditablePart(p), `part: ${p} is editable`);
  }
  for (const p of ["word/media/image1.png", "word/styles.xml", "word/numbering.xml",
                   "word/theme/theme1.xml", "word/fontTable.xml", "docProps/app.xml"]) {
    check(!isEditablePart(p), `part: ${p} must NOT be touched`);
  }
}

// ── 11. end to end on a realistic header block ──────────────────────────────
{
  const xml =
    para(run("To:"), '<w:r><w:tab/></w:r>', run("{{CONTACT_NAME}}"), run("Date:"), run("{{DATE}}")) +
    para(run("{{SCOPE_ITEMS}}"));
  const r = renderDocumentXml(xml, {
    CONTACT_NAME: "Maggie Zou", DATE: "August 16, 2026",
    SCOPE_ITEMS: ["Extend CA duration.", "Add (6) site visits."],
  }, { listTokens: ["{{SCOPE_ITEMS}}"] });
  eq(r.unfilled, [], "e2e: fully filled");
  check(r.xml.includes("Maggie Zou") && r.xml.includes("August 16, 2026"), "e2e: scalars");
  eq((r.xml.match(/<w:p>/g) || []).length, 3, "e2e: list expanded to 2 paragraphs");
  check(r.xml.includes("<w:tab/>"), "e2e: tab run survived");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall docxRender tests passed");
process.exit(failures ? 1 : 0);
