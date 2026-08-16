// Deterministic .docx token substitution.
//
// Port of tools/docx-templates/engine.py. Same algorithm, same traps handled.
// Kept free of any zip or network dependency so it runs unchanged in the Edge
// Function (fflate is already a dependency of index.ts) AND in the browser,
// where the PMS app holds a delegated Graph token and can write the result as
// the signed-in user. See docxRender.test.mjs for the behavioural contract.
//
// WHY THIS EXISTS: get_template returns a template as plain TEXT, and the
// letterhead is not in that text. A Word file is a zip of parts; for the add
// service template word/media/image1.png alone is 471 KB of the 524 KB total,
// with the tagline in header1.xml, fonts in styles.xml/theme1.xml and the
// numbered clauses in numbering.xml. None of it travels in a text payload, so
// a model asked to "follow the template" redraws it from a skeleton and
// invents the look every run. The fix is to never generate the document:
// substitute inside a copy of the real .docx and copy every other part
// through untouched.

const RUN_RE = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
const TEXT_RE = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
const PARA_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
export const TOKEN_RE = /\{\{[A-Z_0-9]+\}\}/g;

const TEMPLATE_CT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
const DOCUMENT_CT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

export const INSTRUCTION_MARKERS = [
  "This form has fields",
  "Ctrl-A",
  "red text boxes",
  "To populate the header",
];

export function xmlEscape(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function matchAll(re: RegExp, s: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(s)) !== null) {
    out.push(m);
    if (m[0] === "") r.lastIndex++;
  }
  return out;
}

export function runText(run: string): string {
  return matchAll(TEXT_RE, run).map((m) => m[2]).join("");
}

/** Put `text` in the run's FIRST <w:t>, blank any others. */
export function setRunText(run: string, text: string): string {
  let first = true;
  return run.replace(new RegExp(TEXT_RE.source, "g"), (_all, open: string, _mid: string, close: string) => {
    if (first) {
      first = false;
      const o = open.includes("xml:space") ? open : open.slice(0, -1) + ' xml:space="preserve">';
      return o + text + close;
    }
    return open + close;
  });
}

/**
 * Replace `old` with `new_` inside one paragraph, tolerating runs that split
 * `old` across boundaries. Formatting of the run where the match STARTS is
 * applied to the whole replacement.
 *
 * TRAP 1 — Word splits a logical string across several <w:r> runs (spell-check
 * state, rsid boundaries, stray formatting). In the add service template 4 of
 * 11 target values are NOT literal strings in document.xml, including the date
 * and the first fee. A naive string replace fails on exactly the highest-stakes
 * fields and silently succeeds everywhere else.
 *
 * TRAP 2 — runs carrying no <w:t> at all (tab stops, bookmark markers) have
 * zero text width. Choose one as the write target and the replacement
 * evaporates with no error; this cost 6 of 16 tokens on the first attempt.
 * Only TEXT-BEARING runs may enter the character map.
 *
 * `nth` is 1-based and selects a single occurrence. Ops sharing a
 * (paragraph, find) pair must be applied in DESCENDING nth.
 */
export function replaceInParagraph(
  para: string, old: string, new_: string, nth?: number,
): { para: string; count: number } {
  const runs = matchAll(RUN_RE, para);
  if (!runs.length) return { para, count: 0 };

  const entries: Array<{ i: number; a: number; b: number }> = [];
  const texts = new Map<number, string>();
  let pos = 0;
  runs.forEach((r, i) => {
    if (!new RegExp(TEXT_RE.source).test(r[0])) return; // zero-width: never target
    const t = runText(r[0]);
    entries.push({ i, a: pos, b: pos + t.length });
    texts.set(i, t);
    pos += t.length;
  });

  const joined = entries.map((e) => texts.get(e.i)).join("");
  if (!joined.includes(old)) return { para, count: 0 };

  let starts: number[] = [];
  for (let k = joined.indexOf(old); k !== -1; k = joined.indexOf(old, k + 1)) starts.push(k);
  if (nth !== undefined) {
    if (nth < 1 || nth > starts.length) return { para, count: 0 };
    starts = [starts[nth - 1]];
  }

  const dirty = new Set<number>();
  let count = 0;
  // Right-to-left so offsets of earlier matches stay valid.
  for (const s of starts.slice().reverse()) {
    const e = s + old.length;
    const fi = entries.findIndex((x) => x.a <= s && s < x.b);
    const li = entries.findIndex((x) => x.a < e && e <= x.b);
    if (fi === -1 || li === -1) continue;

    const f = entries[fi], l = entries[li];
    const head = (texts.get(f.i) as string).slice(0, s - f.a);
    const tail = (texts.get(l.i) as string).slice(e - l.a);

    if (fi === li) {
      texts.set(f.i, head + new_ + tail);
      dirty.add(f.i);
    } else {
      texts.set(f.i, head + new_);
      dirty.add(f.i);
      for (let k = fi + 1; k < li; k++) { texts.set(entries[k].i, ""); dirty.add(entries[k].i); }
      texts.set(l.i, tail);
      dirty.add(l.i);
    }
    count++;
  }

  let out = "", cursor = 0;
  runs.forEach((r, i) => {
    out += para.slice(cursor, r.index);
    out += dirty.has(i) ? setRunText(r[0], texts.get(i) as string) : r[0];
    cursor = r.index + r[0].length;
  });
  return { para: out + para.slice(cursor), count };
}

/** Apply {old: new} across every paragraph. */
export function replaceAll(xml: string, mapping: Record<string, string>): string {
  const paras = matchAll(PARA_RE, xml);
  let out = "", cursor = 0;
  for (const pm of paras) {
    out += xml.slice(cursor, pm.index);
    let para = pm[0];
    for (const [old, new_] of Object.entries(mapping)) {
      para = replaceInParagraph(para, old, new_).para;
    }
    out += para;
    cursor = pm.index + pm[0].length;
  }
  return out + xml.slice(cursor);
}

/**
 * Replace the paragraph containing `token` with one cloned paragraph per item,
 * inheriting that paragraph's style (bullet / numbering / indent / font).
 * An empty `items` removes the paragraph entirely.
 */
export function expandList(
  xml: string, token: string, items: string[],
): { xml: string; found: boolean } {
  for (const pm of matchAll(PARA_RE, xml)) {
    const para = pm[0];
    const joined = matchAll(RUN_RE, para).map((r) => runText(r[0])).join("");
    if (!joined.includes(token)) continue;
    const clones = items
      .map((it) => replaceInParagraph(para, token, xmlEscape(it)).para)
      .join("");
    return {
      xml: xml.slice(0, pm.index) + clones + xml.slice(pm.index + para.length),
      found: true,
    };
  }
  return { xml, found: false };
}

/** (start, end) of each balanced <tag ...> ... </tag>, outermost only. */
function balancedSpans(xml: string, tag: string): Array<[number, number]> {
  const openRe = new RegExp(`<${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s[^>]*)?>`, "g");
  const close = `</${tag}>`;
  const spans: Array<[number, number]> = [];
  let pos = 0;
  for (;;) {
    openRe.lastIndex = pos;
    const m = openRe.exec(xml);
    if (!m) return spans;
    let depth = 1, i = m.index + m[0].length;
    while (depth) {
      openRe.lastIndex = i;
      const nextOpen = openRe.exec(xml);
      const nextClose = xml.indexOf(close, i);
      if (nextClose === -1) return spans;
      if (nextOpen && nextOpen.index < nextClose) { depth++; i = nextOpen.index + nextOpen[0].length; }
      else { depth--; i = nextClose + close.length; }
    }
    spans.push([m.index, i]);
    pos = i;
  }
}

/**
 * Remove the red author-instruction call-outs ("press Ctrl-A then F9",
 * "delete all the red text boxes") these templates carry for the manual Word
 * workflow. They are drawing anchors, not body text, so they survive
 * paragraph-level editing and would otherwise print on a client document.
 *
 * TRAP 3 — this must run BEFORE any substitution. A call-out holds its own
 * nested <w:p>, which makes paragraph parsing around it unreliable; two
 * placeholders in the subagreement hid behind that mis-parse and escaped
 * substitution entirely while the build still reported clean.
 */
export function stripInstructionTextboxes(
  xml: string, markers: string[] = INSTRUCTION_MARKERS,
): { xml: string; removed: number } {
  let removed = 0;
  for (const tag of ["mc:AlternateContent", "w:pict"]) {
    for (;;) {
      let hit: [number, number] | null = null;
      for (const [a, b] of balancedSpans(xml, tag)) {
        const block = xml.slice(a, b);
        if (!block.includes("<w:txbxContent>")) continue;
        const text = matchAll(TEXT_RE, block).map((m) => m[2]).join("");
        if (markers.some((k) => text.includes(k))) { hit = [a, b]; break; }
      }
      if (!hit) break;
      xml = xml.slice(0, hit[0]) + xml.slice(hit[1]);
      removed++;
    }
  }
  return { xml, removed };
}

/**
 * Flag every Word field for re-evaluation on open. These templates mirror
 * bookmarks through REF fields that ship with STALE cached results, which is
 * why the template itself tells the user to press Ctrl-A then F9. A rendered
 * document must not require that.
 */
export function markFieldsDirty(xml: string): { xml: string; marked: number } {
  let marked = 0;
  const out = xml.replace(
    /<w:fldChar(?![^>]*w:dirty)([^>]*?)w:fldCharType="begin"/g,
    (_all, mid: string) => { marked++; return `<w:fldChar${mid}w:fldCharType="begin" w:dirty="true"`; },
  );
  return { xml: out, marked };
}

/**
 * Convert a .dotx package into a .docx one.
 *
 * TRAP 4 — six of the eight Setty templates are .dotx, whose
 * [Content_Types].xml declares word/document.xml as a TEMPLATE part. Write
 * those bytes under a .docx name and Word refuses the file outright: "Word was
 * unable to read this document. It may be corrupt."
 */
export function templateToDocument(contentTypesXml: string): string {
  return contentTypesXml.split(TEMPLATE_CT).join(DOCUMENT_CT);
}

export type MissingPolicy = "leave" | "blank" | "fail";

export interface RenderResult {
  xml: string;
  warnings: string[];
  unfilled: string[];
}

/**
 * Fill one document part. `fields` values that are arrays expand as lists.
 *
 * Missing tokens default to "leave", which keeps {{TOKEN}} visible as a to-do.
 * These are fee-bearing contracts: a visible token is ugly, a silently blank
 * fee is dangerous.
 */
export function renderDocumentXml(
  xml: string,
  fields: Record<string, unknown>,
  opts: { listTokens?: string[]; onMissing?: MissingPolicy } = {},
): RenderResult {
  const listTokens = opts.listTokens ?? [];
  const onMissing = opts.onMissing ?? "leave";
  const warnings: string[] = [];

  for (const tok of listTokens) {
    const key = tok.replace(/[{}]/g, "");
    const v = fields[key];
    if (v === undefined || v === null) continue;
    const items = Array.isArray(v) ? v.map(String) : [String(v)];
    const r = expandList(xml, tok, items);
    xml = r.xml;
    if (r.found && !items.length) warnings.push(`${key}: empty list, paragraph removed`);
  }

  const mapping: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!Array.isArray(v)) mapping[`{{${k}}}`] = xmlEscape(v);
  }
  xml = replaceAll(xml, mapping);

  const unfilled = [...new Set(matchAll(TOKEN_RE, xml).map((m) => m[0]))].sort();
  for (const u of unfilled) warnings.push(`UNFILLED ${u}`);
  if (onMissing === "blank") xml = xml.replace(new RegExp(TOKEN_RE.source, "g"), "");
  if (onMissing === "fail" && unfilled.length) {
    throw new Error("render refused, unfilled tokens: " + unfilled.join(", "));
  }
  return { xml, warnings, unfilled };
}

/** True for the parts renderDocumentXml should be applied to. */
export function isEditablePart(name: string): boolean {
  return name === "[Content_Types].xml" ||
    ((name.startsWith("word/document.xml") || name.startsWith("word/header") ||
      name.startsWith("word/footer")) && name.endsWith(".xml"));
}
