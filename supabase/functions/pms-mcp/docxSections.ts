// Map and drop whole Word SECTIONS in a .docx.
//
// Port of tools/docx-templates/sections.py. Import-free like docxRender.ts, so
// it runs unchanged in the Edge Function and in the browser.
//
// WHY: a Setty proposal is cover page + cover letter + body + Attachment A +
// firm info, and not every job wants every part. Deleting them by hand after
// generating is the annoyance this removes.
//
// Word already models them as sections. An intermediate section break lives as
// a <w:sectPr> inside the <w:pPr> of the LAST paragraph of that section; the
// final section's properties sit directly in <w:body>. So dropping a section
// means removing its top-level body children up to and including the paragraph
// carrying its sectPr, and the sections around it keep their own page setup,
// headers and footers untouched.

export type ChildKind = "p" | "tbl" | "sectPr";
export interface Child { kind: ChildKind; start: number; end: number; }
export interface Section { first: number; last: number; }

const TEXT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

function bodySpan(doc: string): [number, number] {
  const a = doc.indexOf("<w:body>");
  if (a === -1) throw new Error("no <w:body> in document.xml");
  return [a + "<w:body>".length, doc.lastIndexOf("</w:body>")];
}

/**
 * Direct children of <w:body>, in document order.
 *
 * TRAP: `<w:p .../>` self-closes. An attribute pattern of [^>]* greedily eats
 * the trailing slash, so a `(/?)` capture group comes back EMPTY and the
 * element reads as unclosed. That single mistake makes this walker run to the
 * end of the body and report an entire 397-child proposal as one 517 KB
 * "paragraph", which would corrupt every drop built on it. The template in
 * question has 413 <w:p> opens against 411 closes, so it is not hypothetical.
 * Detect self-closing by testing that the matched tag ENDS WITH "/>".
 */
export function topLevelChildren(doc: string): Child[] {
  const [a, b] = bodySpan(doc);
  const out: Child[] = [];
  const openAny = /<(w:p|w:tbl|w:sectPr)(?:\s[^>]*)?>/g;
  let i = a;

  while (i < b) {
    openAny.lastIndex = i;
    const m = openAny.exec(doc);
    if (!m || m.index >= b) break;
    const tag = m[1];
    const kind = tag.split(":")[1] as ChildKind;

    if (m[0].endsWith("/>")) {                 // self-closing, no end tag
      out.push({ kind, start: m.index, end: m.index + m[0].length });
      i = m.index + m[0].length;
      continue;
    }

    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g");
    const close = `</${tag}>`;
    let depth = 1;
    let j = m.index + m[0].length;
    while (depth > 0) {
      openRe.lastIndex = j;
      const no = openRe.exec(doc);
      const nc = doc.indexOf(close, j);
      if (nc === -1 || nc >= b) break;
      if (no && no.index < nc && no.index < b && !no[0].endsWith("/>")) {
        depth++;
        j = no.index + no[0].length;
      } else {
        depth--;
        j = nc + close.length;
      }
    }
    out.push({ kind, start: m.index, end: j });
    i = j;
  }
  return out;
}

export function childText(doc: string, c: Child): string {
  const s = doc.slice(c.start, c.end);
  const re = new RegExp(TEXT_RE.source, "g");
  let m: RegExpExecArray | null, out = "";
  while ((m = re.exec(s)) !== null) out += m[1];
  return out;
}

/** Section boundaries as [firstChild, lastChild] index pairs. */
export function sections(doc: string): { children: Child[]; sections: Section[] } {
  const children = topLevelChildren(doc);
  const secs: Section[] = [];
  let start = 0;
  children.forEach((c, i) => {
    if (c.kind === "sectPr") return;
    const body = doc.slice(c.start, c.end);
    // a sectPr inside this paragraph's own pPr terminates a section
    if (c.kind === "p" && /<w:pPr>[\s\S]*?<w:sectPr/.test(body)) {
      secs.push({ first: start, last: i });
      start = i + 1;
    }
  });
  if (start < children.length) secs.push({ first: start, last: children.length - 1 });
  return { children, sections: secs };
}

/** Remove whole sections by index. Returns the new document.xml. */
export function dropSections(doc: string, indices: number[]): string {
  const { children, sections: secs } = sections(doc);
  const cuts: Array<[number, number]> = [];
  for (const si of [...new Set(indices)].sort((x, y) => y - x)) {
    if (si < 0 || si >= secs.length) {
      throw new Error(`no section ${si} (have 0..${secs.length - 1})`);
    }
    cuts.push([children[secs[si].first].start, children[secs[si].last].end]);
  }
  let out = doc;
  for (const [s, e] of cuts) out = out.slice(0, s) + out.slice(e);   // reverse-ordered
  return out;
}

/**
 * Named parts of the Setty proposal, by section index. The body (5, 6) is not
 * listed because it is never optional.
 *
 * These are POSITIONAL and verified against Template Proposal.docx as of
 * 2026-08-16. Re-derive with tools/docx-templates/sections.py map if the
 * template is restructured; this object is the one place to update.
 */
export const PROPOSAL_PARTS: Record<string, number[]> = {
  cover_page: [0, 1, 2, 3],
  cover_letter: [4],
  terms: [7],
  firm_info: [8, 9, 10, 11],
};

export function dropParts(doc: string, names: string[]): string {
  const idx: number[] = [];
  for (const n of names) {
    const part = PROPOSAL_PARTS[n];
    if (!part) {
      throw new Error(`unknown part ${n}; have: ${Object.keys(PROPOSAL_PARTS).join(", ")}`);
    }
    idx.push(...part);
  }
  return idx.length ? dropSections(doc, idx) : doc;
}
