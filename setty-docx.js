// setty-docx.js — browser-side .docx pipeline for the PMS.
//
// Loaded as a plain <script type="module"> alongside SettyPMS.html, because the
// PMS is a single Babel-compiled file and cannot import TypeScript.
//
// Contains three things:
//   1. a minimal zip reader/writer (a .docx IS a zip)
//   2. Word section mapping and dropping   — mirrors docxSections.ts
//   3. {{TOKEN}} substitution              — mirrors docxRender.ts
//
// NO DEPENDENCIES. Compression uses the platform's own DecompressionStream /
// CompressionStream("deflate-raw"), which both modern browsers and Node 18+
// provide, so this needs neither pako nor fflate and behaves identically in
// the app and in tests.
//
// DRIFT: the section and token logic is duplicated from the two .ts modules in
// supabase/functions/pms-mcp/, which the Edge Function needs and which cannot
// be imported by a browser. setty-docx.test.mjs imports BOTH and asserts they
// produce identical output on the real template, so a divergence fails the
// build rather than shipping quietly.

// ── zip ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

async function deflateRaw(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Read a .docx into {name: Uint8Array}, preserving entry order.
 *
 * Reads the CENTRAL DIRECTORY rather than scanning local headers: a local
 * header may carry a data descriptor with zeroed sizes, so the central
 * directory is the only reliable source for compressed length.
 */
export async function unzip(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);

  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));

    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = b.subarray(dataStart, dataStart + compSize);

    out.set(name, method === 0 ? raw.slice() : await inflateRaw(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Write {name: Uint8Array} back out as a .docx. */
export async function zip(entries) {
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = enc.encode(name);
    const deflated = await deflateRaw(data);
    // Keep whichever is smaller; tiny parts often inflate under deflate.
    const useStore = deflated.length >= data.length;
    const body = useStore ? data : deflated;
    const method = useStore ? 0 : 8;
    const crc = crc32(data);

    const lh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(6, 0, true);
    ldv.setUint16(8, method, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, body.length, true);
    ldv.setUint32(22, data.length, true);
    ldv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    locals.push(lh, body);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(10, method, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, body.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + body.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, central.length, true);
  edv.setUint16(10, central.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, offset, true);

  const parts = [...locals, ...central, eocd];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ── sections (mirrors docxSections.ts) ──────────────────────────────────────

function bodySpan(doc) {
  const a = doc.indexOf("<w:body>");
  if (a === -1) throw new Error("no <w:body> in document.xml");
  return [a + "<w:body>".length, doc.lastIndexOf("</w:body>")];
}

/**
 * Direct children of <w:body>.
 *
 * TRAP: `<w:p .../>` self-closes, and an attribute pattern of [^>]* eats the
 * trailing slash, so a capture group reads empty and the element looks
 * unclosed. That made an earlier walker swallow a whole 397-child proposal
 * into one 517 KB "paragraph". Detect self-closing by the "/>"" ending.
 */
export function topLevelChildren(doc) {
  const [a, b] = bodySpan(doc);
  const out = [];
  const openAny = /<(w:p|w:tbl|w:sectPr)(?:\s[^>]*)?>/g;
  let i = a;
  while (i < b) {
    openAny.lastIndex = i;
    const m = openAny.exec(doc);
    if (!m || m.index >= b) break;
    const tag = m[1];
    const kind = tag.split(":")[1];
    if (m[0].endsWith("/>")) {
      out.push({ kind, start: m.index, end: m.index + m[0].length });
      i = m.index + m[0].length;
      continue;
    }
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g");
    const close = `</${tag}>`;
    let depth = 1, j = m.index + m[0].length;
    while (depth > 0) {
      openRe.lastIndex = j;
      const no = openRe.exec(doc);
      const nc = doc.indexOf(close, j);
      if (nc === -1 || nc >= b) break;
      if (no && no.index < nc && no.index < b && !no[0].endsWith("/>")) {
        depth++; j = no.index + no[0].length;
      } else {
        depth--; j = nc + close.length;
      }
    }
    out.push({ kind, start: m.index, end: j });
    i = j;
  }
  return out;
}

export function sections(doc) {
  const children = topLevelChildren(doc);
  const secs = [];
  let start = 0;
  children.forEach((c, i) => {
    if (c.kind === "sectPr") return;
    if (c.kind === "p" && /<w:pPr>[\s\S]*?<w:sectPr/.test(doc.slice(c.start, c.end))) {
      secs.push({ first: start, last: i });
      start = i + 1;
    }
  });
  if (start < children.length) secs.push({ first: start, last: children.length - 1 });
  return { children, sections: secs };
}

export function dropSections(doc, indices) {
  const { children, sections: secs } = sections(doc);
  const cuts = [];
  for (const si of [...new Set(indices)].sort((x, y) => y - x)) {
    if (si < 0 || si >= secs.length) throw new Error(`no section ${si} (have 0..${secs.length - 1})`);
    cuts.push([children[secs[si].first].start, children[secs[si].last].end]);
  }
  let out = doc;
  for (const [s, e] of cuts) out = out.slice(0, s) + out.slice(e);
  return out;
}

export const PROPOSAL_PARTS = {
  cover_page: [0, 1, 2, 3],
  cover_letter: [4],
  terms: [7],
  firm_info: [8, 9, 10, 11],
};

export function dropParts(doc, names) {
  const idx = [];
  for (const n of names) {
    const part = PROPOSAL_PARTS[n];
    if (!part) throw new Error(`unknown part ${n}`);
    idx.push(...part);
  }
  return idx.length ? dropSections(doc, idx) : doc;
}

// ── token substitution (mirrors docxRender.ts) ──────────────────────────────

const RUN_RE = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
const TEXT_RE = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
const PARA_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
export const TOKEN_RE = /\{\{[A-Z_0-9]+\}\}/g;

export const xmlEscape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function matchAll(re, s) {
  const out = [], r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = r.exec(s)) !== null) { out.push(m); if (m[0] === "") r.lastIndex++; }
  return out;
}

const runText = (run) => matchAll(TEXT_RE, run).map((m) => m[2]).join("");

function setRunText(run, text) {
  let first = true;
  return run.replace(new RegExp(TEXT_RE.source, "g"), (_a, open, _m, close) => {
    if (first) {
      first = false;
      const o = open.includes("xml:space") ? open : open.slice(0, -1) + ' xml:space="preserve">';
      return o + text + close;
    }
    return open + close;
  });
}

/**
 * Replace inside one paragraph, tolerating values split across runs.
 * Only TEXT-BEARING runs enter the character map: runs with no <w:t> (tab
 * stops, bookmark markers) have zero width and silently swallow a replacement
 * written into them.
 */
export function replaceInParagraph(para, old, next) {
  const runs = matchAll(RUN_RE, para);
  if (!runs.length) return para;
  const entries = [], texts = new Map();
  let pos = 0;
  runs.forEach((r, i) => {
    if (!new RegExp(TEXT_RE.source).test(r[0])) return;
    const t = runText(r[0]);
    entries.push({ i, a: pos, b: pos + t.length });
    texts.set(i, t);
    pos += t.length;
  });
  const joined = entries.map((e) => texts.get(e.i)).join("");
  if (!joined.includes(old)) return para;

  const starts = [];
  for (let k = joined.indexOf(old); k !== -1; k = joined.indexOf(old, k + 1)) starts.push(k);
  const dirty = new Set();
  for (const s of starts.reverse()) {
    const e = s + old.length;
    const fi = entries.findIndex((x) => x.a <= s && s < x.b);
    const li = entries.findIndex((x) => x.a < e && e <= x.b);
    if (fi === -1 || li === -1) continue;
    const f = entries[fi], l = entries[li];
    const head = texts.get(f.i).slice(0, s - f.a);
    const tail = texts.get(l.i).slice(e - l.a);
    if (fi === li) { texts.set(f.i, head + next + tail); dirty.add(f.i); }
    else {
      texts.set(f.i, head + next); dirty.add(f.i);
      for (let k = fi + 1; k < li; k++) { texts.set(entries[k].i, ""); dirty.add(entries[k].i); }
      texts.set(l.i, tail); dirty.add(l.i);
    }
  }
  let out = "", cursor = 0;
  runs.forEach((r, i) => {
    out += para.slice(cursor, r.index);
    out += dirty.has(i) ? setRunText(r[0], texts.get(i)) : r[0];
    cursor = r.index + r[0].length;
  });
  return out + para.slice(cursor);
}

export function replaceAll(xml, mapping) {
  const paras = matchAll(PARA_RE, xml);
  let out = "", cursor = 0;
  for (const pm of paras) {
    out += xml.slice(cursor, pm.index);
    let para = pm[0];
    for (const [old, next] of Object.entries(mapping)) para = replaceInParagraph(para, old, next);
    out += para;
    cursor = pm.index + pm[0].length;
  }
  return out + xml.slice(cursor);
}

export function expandList(xml, token, items) {
  for (const pm of matchAll(PARA_RE, xml)) {
    const para = pm[0];
    if (!matchAll(RUN_RE, para).map((r) => runText(r[0])).join("").includes(token)) continue;
    const clones = items.map((it) => replaceInParagraph(para, token, xmlEscape(it))).join("");
    return { xml: xml.slice(0, pm.index) + clones + xml.slice(pm.index + para.length), found: true };
  }
  return { xml, found: false };
}

export function renderDocumentXml(xml, fields, opts = {}) {
  const listTokens = opts.listTokens || [];
  for (const tok of listTokens) {
    const v = fields[tok.replace(/[{}]/g, "")];
    if (v === undefined || v === null) continue;
    xml = expandList(xml, tok, Array.isArray(v) ? v.map(String) : [String(v)]).xml;
  }
  const mapping = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!Array.isArray(v)) mapping[`{{${k}}}`] = xmlEscape(v);
  }
  xml = replaceAll(xml, mapping);
  const unfilled = [...new Set(matchAll(TOKEN_RE, xml).map((m) => m[0]))].sort();
  return { xml, unfilled };
}

export const isEditablePart = (name) =>
  name === "[Content_Types].xml" ||
  ((name.startsWith("word/document.xml") || name.startsWith("word/header") ||
    name.startsWith("word/footer")) && name.endsWith(".xml"));

const TEMPLATE_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
const DOCUMENT_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

// ── scope HTML -> Word blocks ───────────────────────────────────────────────

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", bull: "•",
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
}

/**
 * Turn the PMS scope field into ordered blocks for the proposal.
 *
 * scopeContent is HTML PASTED OUT OF WORD, so it arrives wrapped in Office
 * conditional comments, <xml> settings islands and <style> blocks -- the Q226
 * scope is 75 KB of which most is that. All of it has to go before any text is
 * read, or the settings leak into the document as prose.
 *
 * Returns [{kind: "h"|"p", text}]. A paragraph whose entire content is bold is
 * treated as a heading, which is how these scopes are actually written.
 */
export function htmlToBlocks(html) {
  if (!html) return [];
  let s = String(html)
    // Downlevel-hidden blocks: "<!--[if gte mso 9]> ... <![endif]-->". The
    // condition is followed by "]>", which is what separates these from the
    // inline list markers below. Requiring "]>" matters: Word uses BOTH
    // terminator spellings, and a regex that accepts either will run from a
    // list marker all the way to the next style block, eating real scope text.
    .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<xml[\s\S]*?<\/xml>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    // "<!--[if !supportLists]-->a.&nbsp;<!--[endif]-->" — the leading "a." is
    // the visible list letter and is kept; only the comments go.
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, " ");

  // Split on block BOUNDARIES rather than matching <tag>...</tag> pairs.
  // The Q226 scope wraps everything in a single <h2>, so pair matching would
  // return the entire 75 KB as one heading.
  const tags = [...s.matchAll(/<(\/?)(p|div|h[1-6]|li|tr)\b[^>]*>/gi)];
  const blocks = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t[1] === "/") continue;                       // closing tag
    const name = t[2].toLowerCase();
    const from = t.index + t[0].length;
    const to = i + 1 < tags.length ? tags[i + 1].index : s.length;
    const raw = s.slice(from, to);
    const text = decodeEntities(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text) continue;                              // wrapper with no own text
    const inner = raw.replace(/<\/?(span|font|o:p|a)\b[^>]*>/gi, "").trim();
    // A paragraph that STARTS bold is a heading. Requiring the whole thing to
    // be bold was wrong on real scopes: they bold only the list marker, so
    // "<b>A. </b>SCOPE OF ENGINEERING SERVICES" came through as body text
    // while "<b>B. </b><b>Expectations:</b>" became a heading -- inconsistent
    // within one document. Sub-items ("a.", "b.") carry no bold at all, so
    // leading-bold cleanly separates the two levels.
    const startsBold = /^<(b|strong)\b[^>]*>/i.test(inner);
    blocks.push({ kind: /^h[1-6]$/.test(name) || startsBold ? "h" : "p", text });
  }
  return blocks;
}

/**
 * Replace the {{SCOPE_HEADING}} / {{SCOPE_BODY}} prototype pair with one
 * cloned paragraph per block.
 *
 * The prototypes are real paragraphs lifted from the template, so the cloned
 * output keeps the section's numbering, indents and fonts exactly. Building
 * paragraphs from scratch would lose all of it.
 */
export function expandBlocks(xml, headingToken, bodyToken, blocks) {
  const paras = matchAll(PARA_RE, xml);
  const find = (tok) => paras.find((p) =>
    matchAll(RUN_RE, p[0]).map((r) => runText(r[0])).join("").includes(tok));
  const ph = find(headingToken);
  const pb = find(bodyToken);
  if (!ph || !pb) return { xml, found: false };

  const out = blocks.map((b) => {
    const proto = b.kind === "h" ? ph[0] : pb[0];
    const tok = b.kind === "h" ? headingToken : bodyToken;
    return replaceInParagraph(proto, tok, xmlEscape(b.text));
  }).join("");

  const start = Math.min(ph.index, pb.index);
  const end = Math.max(ph.index + ph[0].length, pb.index + pb[0].length);
  return { xml: xml.slice(0, start) + out + xml.slice(end), found: true };
}

/**
 * Expand ONE token paragraph into as many paragraphs as the HTML has blocks,
 * for a field like "Project Description: {{PROJECT_DESCRIPTION}}" whose value
 * is a few paragraphs, not a phrase. Filling it as a field flattened every
 * paragraph break into one run, which is what "the description formatting
 * didn't survive" looked like.
 *
 * The first block replaces the token in place, so the label and its bold run
 * survive. Each further block is a clone of the paragraph with every text run
 * blanked except the token's, which keeps the token run's own formatting (not
 * the bold label's) and the paragraph's spacing and justification. Heading
 * blocks get <w:b/> on that run.
 */
export function expandParagraph(xml, token, blocks) {
  if (!blocks.length) return { xml, found: false };
  const paras = matchAll(PARA_RE, xml);
  const pm = paras.find((p) =>
    matchAll(RUN_RE, p[0]).map((r) => runText(r[0])).join("").includes(token));
  if (!pm) return { xml, found: false };
  const para = pm[0];

  const first = replaceInParagraph(para, token, xmlEscape(blocks[0].text));
  const rest = blocks.slice(1).map((b) => {
    let tokenRunSeen = false;
    const runs = matchAll(RUN_RE, para);
    let out = "", cursor = 0;
    for (const r of runs) {
      out += para.slice(cursor, r.index);
      cursor = r.index + r[0].length;
      if (!new RegExp(TEXT_RE.source).test(r[0])) { out += r[0]; continue; }
      if (!tokenRunSeen && runText(r[0]).includes(token)) {
        tokenRunSeen = true;
        let run = setRunText(r[0], xmlEscape(b.text));
        if (b.kind === "h") {
          run = run.includes("<w:rPr>")
            ? run.replace("<w:rPr>", "<w:rPr><w:b/>")
            : run.replace(/^(<w:r(?:\s[^>]*)?>)/, "$1<w:rPr><w:b/></w:rPr>");
        }
        out += run;
      } else {
        out += setRunText(r[0], "");
      }
    }
    out += para.slice(cursor);
    // Token split across runs: fall back to writing the whole thing into the
    // paragraph text, formatting of the first run and all.
    return tokenRunSeen ? out : replaceInParagraph(para, token, xmlEscape(b.text));
  });
  return {
    xml: xml.slice(0, pm.index) + first + rest.join("") + xml.slice(pm.index + para.length),
    found: true,
  };
}

// ── the one call the PMS makes ──────────────────────────────────────────────

/**
 * template bytes + choices -> finished .docx bytes.
 *
 * `omit` names parts to leave out (cover_page, cover_letter, terms,
 * firm_info); `fields` fills {{TOKENS}}; `paragraphs` maps a token to HTML
 * that expands into one paragraph per block (see expandParagraph); `blank`
 * lists tokens to REMOVE together with one following space, for an optional
 * word like the honorific where a leftover token or a double space would both
 * be wrong. Every part not touched is copied through byte-for-byte, which is
 * what preserves the letterhead.
 */
/**
 * Attachment A from the PMS terms HTML (library assembly or the project's own
 * edited copy): "<h1>STANDARD TERMS AND CONDITIONS</h1><h2>1. Title</h2><p>…"
 * -> blocks for the {{TERMS_HEADING}} / {{TERMS_BODY}} prototypes.
 *
 * The template keeps its own "TERMS AND CONDITIONS" title, so the h1 is
 * dropped. Heading1 in this template AUTO-NUMBERS through its style, so the
 * "12. " the PMS generated for print is stripped or Word would show "1. 12.".
 * The template separates body paragraphs with an empty paragraph, so an
 * empty body clone follows each body block; headings get none, which is the
 * pattern the original section used.
 */
export function termsHtmlToBlocks(html) {
  const s = String(html || "").replace(/^\s*<h1>[\s\S]*?<\/h1>/i, "");
  const out = [];
  for (const b of htmlToBlocks(s)) {
    if (b.kind === "h") out.push({ kind: "h", text: b.text.replace(/^\d+\.\s+/, "") });
    else { out.push(b); out.push({ kind: "p", text: "" }); }
  }
  return out;
}

export async function buildDocx(
  arrayBuffer,
  { omit = [], fields = {}, listTokens = [], scopeHtml = "", scopeSections = {},
    paragraphs = {}, blank = [], termsHtml = "" } = {},
) {
  const parts = await unzip(arrayBuffer);
  const dec = new TextDecoder(), enc = new TextEncoder();
  let unfilled = [];
  let scopeBlocks = 0;
  let scopeNote = "";

  for (const [name, bytes] of parts) {
    if (!isEditablePart(name)) continue;
    let xml = dec.decode(bytes);
    if (name === "[Content_Types].xml") {
      parts.set(name, enc.encode(xml.split(TEMPLATE_CT).join(DOCUMENT_CT)));
      continue;
    }
    if (name === "word/document.xml") {
      if (omit.length) xml = dropParts(xml, omit);
      // Scope BEFORE token substitution: the prototypes carry the tokens, and
      // filling them first would leave nothing to clone.
      // Three independent sections, each with its own prototype pair. Keeping
      // them apart is what removes the heading guesswork: an Included box IS
      // the included list, so nothing has to be inferred from bold prefixes.
      // scopeHtml (single blob) still maps to Included, so a client that has
      // not been updated keeps working.
      const sections = {
        included: scopeSections.included || scopeHtml || "",
        additional: scopeSections.additional || "",
        excluded: scopeSections.excluded || "",
      };
      const anchors = {
        included: ["{{SCOPE_HEADING}}", "{{SCOPE_BODY}}"],
        additional: ["{{ADDITIONAL_HEADING}}", "{{ADDITIONAL_BODY}}"],
        excluded: ["{{EXCLUDED_HEADING}}", "{{EXCLUDED_BODY}}"],
      };
      const notes = [];
      for (const [key, html] of Object.entries(sections)) {
        const [h, b] = anchors[key];
        const blocks = htmlToBlocks(html);
        if (!html) {
          // An untouched section leaves its prototypes behind, which would
          // print as {{TOKENS}}. Blank them instead.
          xml = expandBlocks(xml, h, b, []).xml;
          continue;
        }
        if (!blocks.length) {
          notes.push(key + " is " + html.length + " chars but had no readable paragraphs");
          xml = expandBlocks(xml, h, b, []).xml;
          continue;
        }
        const r = expandBlocks(xml, h, b, blocks);
        if (r.found) { xml = r.xml; scopeBlocks += blocks.length; }
        else notes.push(key + ": template is missing " + h + " (old copy cached?)");
      }
      // Attachment A. If the terms part was omitted the prototypes left with
      // it and there is nothing to do; if no terms were supplied, blank the
      // prototypes so no {{TERMS_*}} prints.
      if (!omit.includes("terms")) {
        const tb = termsHtml ? termsHtmlToBlocks(termsHtml) : [];
        const tr = expandBlocks(xml, "{{TERMS_HEADING}}", "{{TERMS_BODY}}", tb);
        if (tr.found) {
          xml = tr.xml;
          if (tb.length) scopeBlocks += tb.length;
        } else if (termsHtml) {
          notes.push("terms: template is missing {{TERMS_HEADING}} (old copy cached?)");
        }
      }
      scopeNote = notes.join("; ");
      // Multi-paragraph fields, also before token substitution.
      for (const [tok, html] of Object.entries(paragraphs)) {
        const blocks = htmlToBlocks(html);
        if (blocks.length) xml = expandParagraph(xml, "{{" + tok + "}}", blocks).xml;
      }
    }
    if (blank.length) {
      const gone = {};
      for (const tok of blank) { gone["{{" + tok + "}} "] = ""; gone["{{" + tok + "}}"] = ""; }
      xml = replaceAll(xml, gone);
    }
    const r = renderDocumentXml(xml, fields, { listTokens });
    if (name === "word/document.xml") unfilled = r.unfilled;
    parts.set(name, enc.encode(r.xml));
  }
  return { bytes: await zip(parts), unfilled, scopeBlocks, scopeNote };
}
