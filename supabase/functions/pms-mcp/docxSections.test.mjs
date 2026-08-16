// Behavioural contract for docxSections.ts.
//
// Run: node supabase/functions/pms-mcp/docxSections.test.mjs
//
// Imports the real module (import-free, erasable-syntax TS, stripped natively
// by Node 22.6+) rather than keeping drift-detected copies.
//
// If the real Setty proposal template is reachable, the last block also checks
// the ported logic against the Python original's numbers. It skips cleanly when
// the template is not on this machine, so the suite still runs anywhere.

import { existsSync, readFileSync } from "node:fs";
import {
  PROPOSAL_PARTS, childText, dropParts, dropSections, sections, topLevelChildren,
} from "./docxSections.ts";

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error("FAIL: " + msg); } };
const eq = (a, b, msg) => check(
  JSON.stringify(a) === JSON.stringify(b),
  `${msg}\n     expected ${JSON.stringify(b)}\n     actual   ${JSON.stringify(a)}`);

const para = (t, sect = false) =>
  `<w:p><w:pPr>${sect ? "<w:sectPr><w:pgSz w:w=\"12240\"/></w:sectPr>" : ""}</w:pPr>` +
  `<w:r><w:t>${t}</w:t></w:r></w:p>`;
const doc = (...kids) =>
  `<?xml version="1.0"?><w:document><w:body>${kids.join("")}` +
  `<w:sectPr><w:pgSz w:w="12240"/></w:sectPr></w:body></w:document>`;

// ── 1. the self-closing paragraph trap ──────────────────────────────────────
// <w:p .../> has no end tag. Treating it as unclosed makes the walker swallow
// the rest of the body. On the real template that turned 397 children into 1.
{
  const d = doc(para("A"), '<w:p w14:paraId="X" w:rsidR="00A"/>', para("B"), para("C"));
  const kids = topLevelChildren(d);
  // 4 paragraphs + the body's own trailing sectPr, which is also a child.
  eq(kids.length, 5, "self-closing: all four paragraphs found, none swallowed");
  eq(kids.map(k => k.kind), ["p", "p", "p", "p", "sectPr"], "self-closing: kinds");
  eq(childText(d, kids[1]), "", "self-closing: empty paragraph has no text");
  eq(childText(d, kids[3]), "C", "self-closing: later children still reachable");
}

// ── 2. nested paragraphs (text boxes) do not inflate the count ──────────────
{
  const nested = "<w:p><w:r><mc:AlternateContent><w:txbxContent>" +
    para("inside a text box") + "</w:txbxContent></mc:AlternateContent></w:r></w:p>";
  const d = doc(para("before"), nested, para("after"));
  const kids = topLevelChildren(d);   // 3 paragraphs + trailing sectPr
  eq(kids.length, 4, "nesting: text-box paragraph counts once, not twice");
  check(childText(d, kids[1]).includes("inside a text box"), "nesting: inner text reachable");
}

// ── 3. section boundaries ───────────────────────────────────────────────────
{
  const d = doc(para("s0a"), para("s0b", true), para("s1a"), para("s1b", true), para("s2"));
  const { children, sections: secs } = sections(d);
  eq(children.length, 6, "sections: 5 paragraphs + trailing sectPr");
  eq(secs.map(s => [s.first, s.last]), [[0, 1], [2, 3], [4, 5]], "sections: boundaries");
}

// ── 4. dropping ─────────────────────────────────────────────────────────────
{
  const d = doc(para("KEEP1"), para("DROPME", true), para("KEEP2"), para("KEEP3", true));
  const out = dropSections(d, [0]);
  check(!out.includes("KEEP1"), "drop: section 0 first child removed");
  check(!out.includes("DROPME"), "drop: section 0 terminator removed");
  check(out.includes("KEEP2") && out.includes("KEEP3"), "drop: later sections survive");
  eq(topLevelChildren(out).length, 3, "drop: two children removed");

  // the surviving section keeps its own sectPr
  check(/<w:sectPr/.test(out), "drop: page setup preserved on survivors");

  // dropping the middle of three leaves both neighbours
  const d3 = doc(para("A", true), para("B", true), para("C", true));
  const mid = dropSections(d3, [1]);
  check(mid.includes("A") && mid.includes("C") && !mid.includes(">B<"),
        "drop: middle section removed, neighbours intact");

  // multiple indices, and reverse-order application does not corrupt offsets
  const multi = dropSections(d3, [0, 2]);
  check(!multi.includes(">A<") && multi.includes("B") && !multi.includes(">C<"),
        "drop: multiple sections in one call");

  eq(dropSections(d3, []), d3, "drop: empty list is a no-op");
  let threw = false;
  try { dropSections(d3, [99]); } catch { threw = true; }
  check(threw, "drop: out-of-range section is an error, not silent");
}

// ── 5. named parts ──────────────────────────────────────────────────────────
{
  eq(Object.keys(PROPOSAL_PARTS).sort(),
     ["cover_letter", "cover_page", "firm_info", "terms"], "parts: names");
  eq(PROPOSAL_PARTS.cover_page, [0, 1, 2, 3], "parts: cover page spans four sections");
  check(!Object.values(PROPOSAL_PARTS).flat().some(i => i === 5 || i === 6),
        "parts: the proposal body (5,6) is never optional");
  let threw = false;
  try { dropParts("<w:document><w:body></w:body></w:document>", ["nope"]); } catch { threw = true; }
  check(threw, "parts: unknown name is an error");
}

// ── 6. against the real template, when available ────────────────────────────
{
  const real = "tools/docx-templates/build/proposal/TemplateProposal.docx";
  if (!existsSync(real)) {
    console.log("  (skipped real-template check: run tools/docx-templates first)");
  } else {
    const { unzipSync, strFromU8 } = await import("fflate");
    const zip = unzipSync(new Uint8Array(readFileSync(real)));
    const xml = strFromU8(zip["word/document.xml"]);
    const { children, sections: secs } = sections(xml);
    // These are the numbers the Python original produces.
    eq(children.length, 397, "real: 397 top-level body children");
    eq(secs.length, 12, "real: 12 sections");
    eq([secs[4].first, secs[4].last], [39, 67], "real: cover letter is children 39-67");
    const без = dropParts(xml, ["cover_letter"]);
    eq(topLevelChildren(без).length, 397 - 29, "real: dropping the cover letter removes 29 children");
    check(!без.includes("I appreciate the opportunity to provide our fee proposal"),
          "real: cover letter body text is gone");
    check(без.includes("PROFESSIONAL SERVICES PROPOSAL"), "real: proposal body survives");
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall docxSections tests passed");
process.exit(failures ? 1 : 0);
