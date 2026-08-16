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

// ── the one call the PMS makes ──────────────────────────────────────────────

/**
 * template bytes + choices -> finished .docx bytes.
 *
 * `omit` names parts to leave out (cover_page, cover_letter, terms,
 * firm_info); `fields` fills {{TOKENS}}. Every part not touched is copied
 * through byte-for-byte, which is what preserves the letterhead.
 */
export async function buildDocx(arrayBuffer, { omit = [], fields = {}, listTokens = [] } = {}) {
  const parts = await unzip(arrayBuffer);
  const dec = new TextDecoder(), enc = new TextEncoder();
  let unfilled = [];

  for (const [name, bytes] of parts) {
    if (!isEditablePart(name)) continue;
    let xml = dec.decode(bytes);
    if (name === "[Content_Types].xml") {
      parts.set(name, enc.encode(xml.split(TEMPLATE_CT).join(DOCUMENT_CT)));
      continue;
    }
    if (name === "word/document.xml" && omit.length) xml = dropParts(xml, omit);
    const r = renderDocumentXml(xml, fields, { listTokens });
    if (name === "word/document.xml") unfilled = r.unfilled;
    parts.set(name, enc.encode(r.xml));
  }
  return { bytes: await zip(parts), unfilled };
}
