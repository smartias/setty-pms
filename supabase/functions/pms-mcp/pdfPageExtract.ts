// One page out of a large PDF, as a small PDF of its own, read in byte ranges.
//
// view_drawing rasterizes with PDFium, which wants the whole file in memory,
// so it refused anything over 40MB. An architect's combined set is routinely
// 50 to 150MB, and those are the sheets the cross-discipline QA checks need
// (ceiling plans, sections, framing). On 2026-11-25 a QA look-back could only
// read Tabler's 70MB architectural volume by downloading it by hand.
//
// A sheet rarely needs more than a few MB of that file: its content streams,
// its fonts and its images. This module reads the cross-reference table, walks
// the page tree to the one page asked for, follows that page's references, and
// writes those objects out as a one-page PDF. Objects are copied byte for byte
// under their original numbers, so nothing is re-encoded; only the page
// dictionary is rewritten (new parent, inherited attributes made explicit).
//
// What it does not do, on purpose:
//   - repair a damaged cross-reference table. It fails with a clear message;
//     the caller points the person at download_document.
//   - decrypt. An encrypted file is refused.
//   - follow references to other pages (link annotations, article threads,
//     the structure tree). They are left dangling, which readers treat as null.
// The one thing taken from the catalog is /OCProperties: which layers are on.
//
// Pure of any storage: the caller supplies `fetchRange`. See its tests.
import { inflateSync, constants as zlibConstants } from "node:zlib";

export type RangeRead = (begin: number, endExclusive: number) => Promise<Uint8Array>;

export class PdfExtractError extends Error {
  constructor(message: string) { super(message); this.name = "PdfExtractError"; }
}

export type ExtractedPage = {
  bytes: Uint8Array;       // a complete one-page PDF
  pageCount: number;       // pages in the source file
  objects: number;         // objects copied
  bytesFetched: number;    // bytes read from the source
  requests: number;        // range requests made
};

export const EXTRACT_CHUNK_BYTES = 512 * 1024;
const DEFAULT_MAX_OUT_BYTES = 40 * 1024 * 1024;
const DEFAULT_MAX_FETCH_BYTES = 96 * 1024 * 1024;
const PREFETCH_PARALLEL = 6;
const OBJSTM_CACHE_MAX_BYTES = 48 * 1024 * 1024;
// Chunks kept in memory while a file is open. Reading many pages of one file
// (a text search) would otherwise hold everything it has ever fetched.
const CHUNKS_KEEP_BYTES = 48 * 1024 * 1024;

// ── bytes ───────────────────────────────────────────────────────────────────
const latin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192) as unknown as number[]);
  return s;
};
const bytesOf = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

// The file, fetched a chunk at a time and kept. Every read is counted so a
// caller can cap what one page is allowed to cost.
class Chunks {
  private got = new Map<number, Uint8Array | Promise<Uint8Array>>();
  bytesFetched = 0;
  requests = 0;
  private kept = 0;
  // Wall time with at least one range in flight. A caller that budgets CPU
  // subtracts it from elapsed time: waiting on the network is not compute.
  private inFlight = 0;
  private busySince = 0;
  private busyMs = 0;
  fetchBusyMs(): number { return this.busyMs + (this.inFlight > 0 ? Date.now() - this.busySince : 0); }
  readonly size: number;
  private fetchRange: RangeRead;
  private chunk: number;
  private maxFetch: number;
  // No parameter properties anywhere in this file: Node runs the tests by
  // stripping types, and that mode cannot rewrite them.
  constructor(size: number, fetchRange: RangeRead, chunk: number, maxFetch: number) {
    this.size = size; this.fetchRange = fetchRange; this.chunk = chunk; this.maxFetch = maxFetch;
  }

  private load(i: number): Promise<Uint8Array> | Uint8Array {
    const have = this.got.get(i);
    if (have) return have;
    const begin = i * this.chunk, end = Math.min(this.size, begin + this.chunk);
    if (this.bytesFetched + (end - begin) > this.maxFetch) {
      throw new PdfExtractError(`this page needs more than ${Math.round(this.maxFetch / 1048576)}MB of the file to be read`);
    }
    this.bytesFetched += end - begin;
    this.requests++;
    if (this.inFlight++ === 0) this.busySince = Date.now();
    const settle = () => { if (--this.inFlight === 0) this.busyMs += Date.now() - this.busySince; };
    const raw = this.fetchRange(begin, end);
    raw.then(settle, settle); // exactly once, success or failure
    const p = raw.then((b) => {
      if (b.byteLength !== end - begin) throw new PdfExtractError(`bytes ${begin}-${end} came back as ${b.byteLength} bytes`);
      this.got.set(i, b);
      this.kept += b.byteLength;
      // Oldest first. A view already handed out keeps its buffer alive, so
      // dropping a chunk here never invalidates bytes a caller holds.
      for (const [k, v] of this.got) {
        if (this.kept <= CHUNKS_KEEP_BYTES) break;
        if (k === i || v instanceof Promise) continue;
        this.kept -= v.byteLength;
        this.got.delete(k);
      }
      return b;
    });
    this.got.set(i, p);
    p.catch(() => { this.got.delete(i); });
    return p;
  }

  async slice(begin: number, end: number): Promise<Uint8Array> {
    const b = Math.max(0, begin), e = Math.min(this.size, end);
    if (e <= b) return new Uint8Array(0);
    const first = Math.floor(b / this.chunk), last = Math.floor((e - 1) / this.chunk);
    if (first === last) {
      const c = await this.load(first);
      return c.subarray(b - first * this.chunk, e - first * this.chunk);
    }
    const out = new Uint8Array(e - b);
    for (let i = first; i <= last; i++) {
      const c = await this.load(i);
      const cb = i * this.chunk;
      const from = Math.max(b, cb), to = Math.min(e, cb + c.byteLength);
      out.set(c.subarray(from - cb, to - cb), from - b);
    }
    return out;
  }

  // Warm the chunks a batch of offsets live in, a few at a time: objects of one
  // page are scattered, and fetching their chunks one after another is slow.
  async prefetch(offsets: number[]): Promise<void> {
    const want = [...new Set(offsets.filter((o) => o >= 0 && o < this.size).map((o) => Math.floor(o / this.chunk)))].filter((i) => !this.got.has(i));
    for (let i = 0; i < want.length; i += PREFETCH_PARALLEL) {
      await Promise.all(want.slice(i, i + PREFETCH_PARALLEL).map((c) => this.load(c)));
    }
  }
}

// ── syntax ──────────────────────────────────────────────────────────────────
export type PdfRef = { t: "ref"; n: number; g: number };
export type PdfName = { t: "name"; v: string };
export type PdfDict = { t: "dict"; m: Map<string, PdfValue>; spans: Map<string, [number, number]> };
export type PdfValue = number | boolean | null | PdfRef | PdfName | PdfDict | { t: "str" } | PdfValue[];

const isDict = (v: unknown): v is PdfDict => !!v && (v as any).t === "dict";
const isRef = (v: unknown): v is PdfRef => !!v && (v as any).t === "ref";
const isName = (v: unknown): v is PdfName => !!v && (v as any).t === "name";

const NEED_MORE = Symbol("need more bytes");
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]); // ( ) < > [ ] { } / %

// A tokenizer over one buffer. Reading past the end of a buffer that is not
// the end of the file throws NEED_MORE, and the caller retries with more.
class Lexer {
  pos = 0;
  readonly buf: Uint8Array;
  private atEof: boolean;
  constructor(buf: Uint8Array, atEof: boolean) { this.buf = buf; this.atEof = atEof; }
  at(i: number): number {
    if (i < this.buf.length) return this.buf[i];
    if (this.atEof) return -1;
    throw NEED_MORE;
  }
  skipWs(): void {
    for (;;) {
      const c = this.at(this.pos);
      if (c === 37) { while (this.at(this.pos) !== 10 && this.at(this.pos) !== 13 && this.at(this.pos) !== -1) this.pos++; continue; }
      if (c !== -1 && WS.has(c)) { this.pos++; continue; }
      return;
    }
  }
  private isBreak(c: number): boolean { return c === -1 || WS.has(c) || DELIM.has(c); }
  word(): string {
    const s = this.pos;
    while (!this.isBreak(this.at(this.pos))) this.pos++;
    return latin1(this.buf.subarray(s, this.pos));
  }
  keyword(k: string): boolean {
    for (let i = 0; i < k.length; i++) if (this.at(this.pos + i) !== k.charCodeAt(i)) return false;
    if (!this.isBreak(this.at(this.pos + k.length))) return false;
    this.pos += k.length;
    return true;
  }
  integer(): number | null {
    const save = this.pos;
    const w = this.word();
    if (!/^[+-]?\d+$/.test(w)) { this.pos = save; return null; }
    return parseInt(w, 10);
  }
  value(depth = 0): PdfValue {
    if (depth > 200) throw new PdfExtractError("the file nests objects too deeply to read");
    this.skipWs();
    const c = this.at(this.pos);
    if (c === -1) throw new PdfExtractError("the file ends in the middle of an object");
    if (c === 60) { // <
      if (this.at(this.pos + 1) === 60) return this.dict(depth);
      this.pos++;
      while (this.at(this.pos) !== 62) { if (this.at(this.pos) === -1) throw new PdfExtractError("unterminated hex string"); this.pos++; }
      this.pos++;
      return { t: "str" };
    }
    if (c === 40) { // (
      let level = 0;
      for (;;) {
        const d = this.at(this.pos);
        if (d === -1) throw new PdfExtractError("unterminated string");
        if (d === 92) { this.at(this.pos + 1); this.pos += 2; continue; }
        if (d === 40) level++;
        else if (d === 41) { level--; if (level === 0) { this.pos++; break; } }
        this.pos++;
      }
      return { t: "str" };
    }
    if (c === 47) { // /
      this.pos++;
      const raw = this.word();
      return { t: "name", v: raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (c === 91) { // [
      this.pos++;
      const out: PdfValue[] = [];
      for (;;) {
        this.skipWs();
        if (this.at(this.pos) === 93) { this.pos++; return out; }
        if (this.at(this.pos) === -1) throw new PdfExtractError("unterminated array");
        out.push(this.value(depth + 1));
      }
    }
    const w = this.word();
    if (w === "true") return true;
    if (w === "false") return false;
    if (w === "null") return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      const n = Number(w);
      if (/^\d+$/.test(w)) {
        // "12 0 R" is a reference: look ahead for the generation and the R.
        const save = this.pos;
        this.skipWs();
        const g = this.integer();
        if (g !== null && g >= 0) { this.skipWs(); if (this.keyword("R")) return { t: "ref", n, g }; }
        this.pos = save;
      }
      return n;
    }
    if (w === "") throw new PdfExtractError(`unexpected character ${String.fromCharCode(c)} where an object was expected`);
    return null; // an unknown keyword: carry on rather than refuse the file
  }
  private dict(depth: number): PdfDict {
    this.pos += 2;
    const m = new Map<string, PdfValue>(), spans = new Map<string, [number, number]>();
    for (;;) {
      this.skipWs();
      const c = this.at(this.pos);
      if (c === 62 && this.at(this.pos + 1) === 62) { this.pos += 2; return { t: "dict", m, spans }; }
      if (c !== 47) throw new PdfExtractError("a dictionary key was not a name");
      const key = this.value(depth + 1) as PdfName;
      this.skipWs();
      const s = this.pos;
      const v = this.value(depth + 1);
      if (!m.has(key.v)) { m.set(key.v, v); spans.set(key.v, [s, this.pos]); }
    }
  }
}

// Parse with a window that grows until the parser stops asking for more.
async function parseAt<T>(chunks: Chunks, offset: number, fn: (lx: Lexer) => T, first = 16 * 1024): Promise<{ out: T; lx: Lexer }> {
  if (!(offset >= 0 && offset < chunks.size)) throw new PdfExtractError(`an object is recorded at byte ${offset}, outside the file`);
  for (let win = first; ; win *= 4) {
    const end = Math.min(chunks.size, offset + win);
    const lx = new Lexer(await chunks.slice(offset, end), end >= chunks.size);
    try {
      return { out: fn(lx), lx };
    } catch (e) {
      if (e !== NEED_MORE) throw e;
      if (end >= chunks.size) throw new PdfExtractError("the file ends in the middle of an object");
    }
  }
}

// ── streams ─────────────────────────────────────────────────────────────────
function inflate(data: Uint8Array): Uint8Array {
  try {
    // Z_SYNC_FLUSH: a stream cut a few bytes short still yields what it holds.
    const out = inflateSync(data, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } catch (e) {
    throw new PdfExtractError(`a compressed table in the file could not be unpacked (${String((e as any)?.message ?? e).slice(0, 80)})`);
  }
}

function unpredict(data: Uint8Array, predictor: number, columns: number): Uint8Array {
  if (predictor < 10) {
    if (predictor <= 1) return data;
    throw new PdfExtractError("the file uses a TIFF predictor on a table, which is not supported");
  }
  const row = columns + 1, rows = Math.floor(data.length / row);
  const out = new Uint8Array(rows * columns);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * row], src = r * row + 1, dst = r * columns, up = dst - columns;
    for (let i = 0; i < columns; i++) {
      const x = data[src + i];
      const a = i > 0 ? out[dst + i - 1] : 0, b = r > 0 ? out[up + i] : 0, c = r > 0 && i > 0 ? out[up + i - 1] : 0;
      let v: number;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}

// Only what cross-reference streams and object streams use: no filter, or Flate.
function decodeTableStream(dict: PdfDict, data: Uint8Array): Uint8Array {
  let filter = dict.m.get("Filter");
  if (Array.isArray(filter)) {
    if (filter.length > 1) throw new PdfExtractError("a table in the file is packed with more than one filter");
    filter = filter[0];
  }
  if (filter == null) return data;
  if (!isName(filter) || filter.v !== "FlateDecode") throw new PdfExtractError(`a table in the file uses ${isName(filter) ? filter.v : "an unknown filter"}`);
  let parms = dict.m.get("DecodeParms");
  if (Array.isArray(parms)) parms = parms[0];
  const raw = inflate(data);
  if (!isDict(parms)) return raw;
  const predictor = Number(parms.m.get("Predictor") ?? 1), columns = Number(parms.m.get("Columns") ?? 1);
  return unpredict(raw, predictor, columns);
}

// ── the file ────────────────────────────────────────────────────────────────
type XrefEntry = { kind: "free" } | { kind: "at"; offset: number; gen: number } | { kind: "in"; stm: number; index: number };
type Loaded = {
  num: number; gen: number;
  value: PdfValue;
  raw: Uint8Array;                 // the value's own bytes
  shift: number;                   // dict spans are positions in the parse buffer: subtract this to index `raw`
  stream: null | { dataStart: number; length: number }; // absolute, for a top-level stream object
};

class PdfFile {
  xref = new Map<number, XrefEntry>();
  root: PdfRef | null = null;
  maxNum = 0;
  private objStms = new Map<number, { data: Uint8Array; first: number; index: [number, number][] }>();
  private objStmBytes = 0;
  private cache = new Map<number, Loaded>();

  readonly chunks: Chunks;
  constructor(chunks: Chunks) { this.chunks = chunks; }

  async open(): Promise<void> {
    const size = this.chunks.size;
    const tail = await this.chunks.slice(Math.max(0, size - 2048), size);
    const text = latin1(tail);
    const at = text.lastIndexOf("startxref");
    if (at < 0) throw new PdfExtractError("the file has no cross-reference pointer at its end, so it cannot be read in pieces");
    const m = /startxref\s+(\d+)/.exec(text.slice(at));
    if (!m) throw new PdfExtractError("the file's cross-reference pointer is unreadable");
    const seen = new Set<number>();
    const todo: number[] = [Number(m[1])];
    while (todo.length) {
      const off = todo.shift()!;
      if (seen.has(off)) continue;
      seen.add(off);
      if (seen.size > 500) throw new PdfExtractError("the file's cross-reference table loops");
      const trailer = await this.readXrefSection(off);
      if (trailer.m.has("Encrypt")) throw new PdfExtractError("the file is encrypted");
      if (!this.root && isRef(trailer.m.get("Root"))) this.root = trailer.m.get("Root") as PdfRef;
      const size2 = Number(trailer.m.get("Size") ?? 0);
      if (size2 - 1 > this.maxNum) this.maxNum = size2 - 1;
      // A hybrid file's /XRefStm is read with its table (readXrefSection).
      const prev = trailer.m.get("Prev");
      if (typeof prev === "number") todo.unshift(prev);
    }
    if (!this.root) throw new PdfExtractError("the file names no document catalog");
    for (const n of this.xref.keys()) if (n > this.maxNum) this.maxNum = n;
  }

  private put(n: number, e: XrefEntry): void { if (!this.xref.has(n)) this.xref.set(n, e); }

  private async readXrefSection(offset: number): Promise<PdfDict> {
    const head = latin1(await this.chunks.slice(offset, Math.min(this.chunks.size, offset + 32)));
    if (/^\s*xref/.test(head)) {
      const { out } = await parseAt(this.chunks, offset, (lx) => {
        lx.skipWs();
        if (!lx.keyword("xref")) throw new PdfExtractError("the cross-reference table is damaged");
        const entries: [number, XrefEntry][] = [];
        for (;;) {
          lx.skipWs();
          if (lx.keyword("trailer")) break;
          const start = lx.integer();
          lx.skipWs();
          const count = lx.integer();
          if (start === null || count === null) throw new PdfExtractError("the cross-reference table is damaged");
          for (let i = 0; i < count; i++) {
            lx.skipWs(); const off = lx.integer();
            lx.skipWs(); const gen = lx.integer();
            lx.skipWs(); const flag = lx.word();
            if (off === null || gen === null || (flag !== "n" && flag !== "f")) throw new PdfExtractError("the cross-reference table is damaged");
            entries.push([start + i, flag === "n" && off > 0 ? { kind: "at", offset: off, gen } : { kind: "free" }]);
          }
        }
        const trailer = lx.value();
        if (!isDict(trailer)) throw new PdfExtractError("the cross-reference table has no trailer");
        return { entries, trailer };
      }, 64 * 1024);
      // A hybrid file lists its packed objects as FREE in the table, so that an
      // old reader ignores them, and gives their real places in /XRefStm. So
      // the table's in-use entries go in first, then the stream, and the
      // table's free entries last: a free entry must not hide the stream's.
      for (const [n, e] of out.entries) if (e.kind !== "free") this.put(n, e);
      const stm = out.trailer.m.get("XRefStm");
      if (typeof stm === "number") await this.readXrefSection(stm);
      for (const [n, e] of out.entries) if (e.kind === "free") this.put(n, e);
      return out.trailer;
    }
    // A cross-reference stream.
    const obj = await this.readObjectAt(offset, null);
    if (!isDict(obj.value) || !obj.stream) throw new PdfExtractError("the cross-reference table is damaged");
    const d = obj.value;
    const data = decodeTableStream(d, await this.chunks.slice(obj.stream.dataStart, obj.stream.dataStart + obj.stream.length));
    const w = d.m.get("W");
    if (!Array.isArray(w) || w.length < 3) throw new PdfExtractError("the cross-reference stream gives no field widths");
    const [w0, w1, w2] = w.map(Number);
    const rowLen = w0 + w1 + w2;
    const index = Array.isArray(d.m.get("Index")) ? (d.m.get("Index") as PdfValue[]).map(Number) : [0, Number(d.m.get("Size") ?? 0)];
    const field = (p: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + data[p + i]; return v; };
    let p = 0;
    for (let s = 0; s + 1 < index.length; s += 2) {
      for (let i = 0; i < index[s + 1]; i++, p += rowLen) {
        if (p + rowLen > data.length) break;
        const type = w0 ? field(p, w0) : 1, a = field(p + w0, w1), b = field(p + w0 + w1, w2);
        const n = index[s] + i;
        if (type === 1) this.put(n, a > 0 ? { kind: "at", offset: a, gen: b } : { kind: "free" });
        else if (type === 2) this.put(n, { kind: "in", stm: a, index: b });
        else this.put(n, { kind: "free" });
      }
    }
    return d;
  }

  // "12 0 obj ... endobj" at a byte offset. For a stream, the dictionary is
  // parsed and the data is located, not read.
  private async readObjectAt(offset: number, expect: number | null): Promise<Loaded> {
    const { out, lx } = await parseAt(this.chunks, offset, (lx) => {
      lx.skipWs();
      const num = lx.integer(); lx.skipWs();
      const gen = lx.integer(); lx.skipWs();
      if (num === null || gen === null || !lx.keyword("obj")) throw new PdfExtractError(`no object where the cross-reference table says one is (byte ${offset})`);
      lx.skipWs();
      const vs = lx.pos;
      const value = lx.value();
      const ve = lx.pos;
      lx.skipWs();
      let dataStart = -1;
      if (isDict(value) && lx.keyword("stream")) {
        // The keyword is followed by CRLF or LF; the data starts right after.
        if (lx.at(lx.pos) === 13) lx.pos++;
        if (lx.at(lx.pos) === 10) lx.pos++;
        dataStart = lx.pos;
      }
      return { num, gen, value, vs, ve, dataStart };
    });
    if (expect !== null && out.num !== expect) throw new PdfExtractError(`object ${expect} is not where the cross-reference table says it is`);
    const raw = lx.buf.slice(out.vs, out.ve);
    let stream: Loaded["stream"] = null;
    if (out.dataStart >= 0) {
      const d = out.value as PdfDict;
      let len = d.m.get("Length");
      if (isRef(len)) len = (await this.get(len.n))?.value ?? null;
      const dataStart = offset + out.dataStart;
      let length = typeof len === "number" && len >= 0 ? len : -1;
      if (length < 0 || !(await this.endsWithEndstream(dataStart + length))) length = await this.scanForEndstream(dataStart);
      stream = { dataStart, length };
    }
    return { num: out.num, gen: out.gen, value: out.value, raw, shift: out.vs, stream };
  }

  private async endsWithEndstream(pos: number): Promise<boolean> {
    if (pos > this.chunks.size) return false;
    return /^\s*endstream/.test(latin1(await this.chunks.slice(pos, pos + 32)));
  }
  // A wrong /Length: find where the data really ends.
  private async scanForEndstream(from: number): Promise<number> {
    // Short steps first: a length that is a few bytes off is the usual case,
    // and the real end is then within the first few KB.
    for (let p = from, step = 4096; p < this.chunks.size; p += step, step = Math.min(step * 4, 1024 * 1024)) {
      const s = latin1(await this.chunks.slice(p, Math.min(this.chunks.size, p + step + 16)));
      const i = s.indexOf("endstream");
      if (i >= 0) {
        let end = p + i;
        const before = await this.chunks.slice(Math.max(from, end - 2), end);
        if (before.length && before[before.length - 1] === 10) { end--; if (before.length > 1 && before[before.length - 2] === 13) end--; }
        else if (before.length && before[before.length - 1] === 13) end--;
        return end - from;
      }
    }
    throw new PdfExtractError("a stream in the file has no end");
  }

  private async objStm(n: number): Promise<{ data: Uint8Array; first: number; index: [number, number][] }> {
    const hit = this.objStms.get(n);
    if (hit) return hit;
    const e = this.xref.get(n);
    if (!e || e.kind !== "at") throw new PdfExtractError(`object stream ${n} is missing`);
    const o = await this.readObjectAt(e.offset, n);
    if (!isDict(o.value) || !o.stream) throw new PdfExtractError(`object stream ${n} is not a stream`);
    const data = decodeTableStream(o.value, await this.chunks.slice(o.stream.dataStart, o.stream.dataStart + o.stream.length));
    const count = Number(o.value.m.get("N") ?? 0), first = Number(o.value.m.get("First") ?? 0);
    const nums = latin1(data.subarray(0, first)).trim().split(/\s+/).map(Number);
    const index: [number, number][] = [];
    for (let i = 0; i < count && 2 * i + 1 < nums.length; i++) index.push([nums[2 * i], nums[2 * i + 1]]);
    const entry = { data, first, index };
    if (this.objStmBytes + data.length > OBJSTM_CACHE_MAX_BYTES) { this.objStms.clear(); this.objStmBytes = 0; }
    this.objStms.set(n, entry); this.objStmBytes += data.length;
    return entry;
  }

  // An object by number, or null when the file does not have it.
  async get(n: number): Promise<Loaded | null> {
    const hit = this.cache.get(n);
    if (hit) return hit;
    const e = this.xref.get(n);
    if (!e || e.kind === "free") return null;
    let out: Loaded;
    if (e.kind === "at") {
      out = await this.readObjectAt(e.offset, n);
    } else {
      const stm = await this.objStm(e.stm);
      let i = e.index;
      if (!stm.index[i] || stm.index[i][0] !== n) i = stm.index.findIndex((x) => x[0] === n);
      if (i < 0) return null;
      const begin = stm.first + stm.index[i][1];
      const end = i + 1 < stm.index.length ? stm.first + stm.index[i + 1][1] : stm.data.length;
      const lx = new Lexer(stm.data.subarray(begin, end), true);
      lx.skipWs();
      const vs = lx.pos;
      const value = lx.value();
      out = { num: n, gen: 0, value, raw: lx.buf.slice(vs, lx.pos), shift: vs, stream: null };
    }
    // Stream objects are not kept: their dictionaries are small but there can
    // be thousands, and each is needed once.
    if (!out.stream && this.cache.size < 20000) this.cache.set(n, out);
    return out;
  }

  async resolve(v: PdfValue | undefined): Promise<PdfValue | null> {
    for (let hops = 0; isRef(v) && hops < 20; hops++) v = (await this.get(v.n))?.value ?? null;
    return v === undefined ? null : v;
  }

  offsetOf(n: number): number {
    const e = this.xref.get(n);
    if (!e) return -1;
    if (e.kind === "at") return e.offset;
    if (e.kind === "in") { const s = this.xref.get(e.stm); return s && s.kind === "at" ? s.offset : -1; }
    return -1;
  }
}

// ── extraction ──────────────────────────────────────────────────────────────
const INHERITED = ["Resources", "MediaBox", "CropBox", "Rotate"];
// Left out of the copied page: they point at other pages or carry nothing a
// render needs.
const PAGE_DROP = new Set(["Parent", "Type", "Thumb", "B", "Metadata", "PieceInfo", "StructParents", "Tabs"]);
// Never copied: following these pulls in the rest of the document.
const SKIP_TYPES = new Set(["Page", "Pages", "Catalog", "StructTreeRoot", "StructElem"]);

function refsIn(v: PdfValue, out: number[]): void {
  if (Array.isArray(v)) { for (const x of v) refsIn(x, out); return; }
  if (isRef(v)) { out.push(v.n); return; }
  if (isDict(v)) for (const [k, x] of v.m) if (k !== "Parent") refsIn(x, out);
}

const spanOf = (o: Loaded, span: [number, number]): Uint8Array => o.raw.subarray(span[0] - o.shift, span[1] - o.shift);

const nameOut = (s: string): string =>
  "/" + [...s].map((ch) => { const c = ch.charCodeAt(0); return c < 33 || c > 126 || DELIM.has(c) || c === 35 ? "#" + c.toString(16).padStart(2, "0") : ch; }).join("");

export type PdfPages = {
  pageCount: number;
  // One page as a complete one-page PDF. Pages are 1-based.
  page: (pageNumber: number) => Promise<{ bytes: Uint8Array; objects: number }>;
  bytesFetched: () => number;
  requests: () => number;
  fetchBusyMs: () => number;
};

type PageOpts = { maxOutBytes?: number; maxFetchBytes?: number; chunkBytes?: number };

// Open once, take as many pages as needed: the cross-reference table is read
// one time and the chunks already fetched are shared between pages.
export async function openPdfPages(size: number, fetchRange: RangeRead, opts: PageOpts = {}): Promise<PdfPages> {
  if (!(size > 0)) throw new PdfExtractError("the file's size is unknown, so it cannot be read in pieces");
  const maxOut = opts.maxOutBytes ?? DEFAULT_MAX_OUT_BYTES;
  const chunks = new Chunks(size, fetchRange, opts.chunkBytes ?? EXTRACT_CHUNK_BYTES, opts.maxFetchBytes ?? DEFAULT_MAX_FETCH_BYTES);
  const file = new PdfFile(chunks);
  await file.open();

  const catObj = await file.get(file.root!.n);
  const catalog = catObj?.value;
  if (!catObj || !isDict(catalog)) throw new PdfExtractError("the file's document catalog is unreadable");
  const pagesRef = catalog.m.get("Pages");
  if (!isRef(pagesRef)) throw new PdfExtractError("the file has no page tree");
  const top = await file.get(pagesRef.n);
  if (!top || !isDict(top.value)) throw new PdfExtractError("the file's page tree is unreadable");
  const pageCount = Number(await file.resolve(top.value.m.get("Count")) ?? 0);
  return {
    pageCount,
    page: (n) => buildPage(file, chunks, catObj, pagesRef, top, pageCount, n, maxOut),
    bytesFetched: () => chunks.bytesFetched,
    requests: () => chunks.requests,
    fetchBusyMs: () => chunks.fetchBusyMs(),
  };
}

export async function extractPdfPage(size: number, fetchRange: RangeRead, pageNumber: number, opts: PageOpts = {}): Promise<ExtractedPage> {
  const pdf = await openPdfPages(size, fetchRange, opts);
  const { bytes, objects } = await pdf.page(pageNumber);
  return { bytes, pageCount: pdf.pageCount, objects, bytesFetched: pdf.bytesFetched(), requests: pdf.requests() };
}

async function buildPage(
  file: PdfFile, chunks: Chunks, catObj: Loaded, pagesRef: PdfRef, top: Loaded, pageCount: number, pageNumber: number, maxOut: number,
): Promise<{ bytes: Uint8Array; objects: number }> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || (pageCount > 0 && pageNumber > pageCount)) {
    throw new PdfExtractError(`page ${pageNumber} is out of range — the file has ${pageCount} page(s)`);
  }
  const inherited = new Map<string, { raw: Uint8Array; value: PdfValue }>();
  let node: Loaded | null = top;
  // Walk down to the page, remembering the nearest ancestor that sets each
  // inheritable attribute.
  let left = pageNumber - 1;
  const visited = new Set<number>([pagesRef.n]);
  for (let depth = 0; ; depth++) {
    if (depth > 60) throw new PdfExtractError("the file's page tree is too deep");
    const d = node!.value as PdfDict;
    const kids = await file.resolve(d.m.get("Kids"));
    if (!Array.isArray(kids)) break; // a leaf: this is the page
    for (const k of INHERITED) {
      const span = d.spans.get(k);
      if (span) inherited.set(k, { raw: spanOf(node!, span), value: d.m.get(k)! });
    }
    const kidRefs = kids.filter(isRef);
    await chunks.prefetch(kidRefs.map((r) => file.offsetOf(r.n)));
    let next: Loaded | null = null;
    for (const r of kidRefs) {
      if (visited.has(r.n)) throw new PdfExtractError("the file's page tree loops");
      const kid = await file.get(r.n);
      if (!kid || !isDict(kid.value)) continue;
      const isNode = kid.value.m.has("Kids");
      const count = isNode ? Number(await file.resolve(kid.value.m.get("Count")) ?? 0) : 1;
      if (left < count) { next = kid; visited.add(r.n); break; }
      left -= count;
    }
    if (!next) throw new PdfExtractError(`page ${pageNumber} was not found in the file's page tree`);
    node = next;
  }
  const page = node!;
  const pd = page.value as PdfDict;

  // The page dictionary, rewritten: same entries, new parent, inherited
  // attributes written out.
  const pagesNum = file.maxNum + 1, catalogNum = file.maxNum + 2;
  const pageParts: Uint8Array[] = [bytesOf(`<< /Type /Page /Parent ${pagesNum} 0 R`)];
  const roots: number[] = [];
  for (const [k, v] of pd.m) {
    if (PAGE_DROP.has(k)) continue;
    const span = pd.spans.get(k)!;
    pageParts.push(bytesOf(" " + nameOut(k) + " "), spanOf(page, span));
    refsIn(v, roots);
  }
  for (const [k, inh] of inherited) {
    if (pd.m.has(k)) continue;
    pageParts.push(bytesOf(" " + nameOut(k) + " "), inh.raw);
    refsIn(inh.value, roots);
  }
  pageParts.push(bytesOf(" >>"));

  // Everything the page refers to, breadth first.
  const out: Uint8Array[] = [];
  const offsets = new Map<number, { offset: number; gen: number }>();
  let pos = 0;
  const emit = (b: Uint8Array) => {
    pos += b.byteLength;
    if (pos > maxOut) throw new PdfExtractError(`this page alone is over ${Math.round(maxOut / 1048576)}MB`);
    out.push(b);
  };
  const begin = (n: number, gen: number) => { offsets.set(n, { offset: pos, gen }); emit(bytesOf(`${n} ${gen} obj\n`)); };
  emit(bytesOf("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n"));

  begin(page.num, page.gen);
  for (const p of pageParts) emit(p);
  emit(bytesOf("\nendobj\n"));

  const done = new Set<number>([page.num]);
  // Copy a set of objects and everything they refer to, breadth first.
  // `layersOnly`: used for the catalog's layer settings, which name every
  // layer in the document; a layer this page does not use is left dangling.
  const copy = async (start: number[], layersOnly: boolean): Promise<void> => {
    let frontier = [...new Set(start)].filter((n) => !done.has(n));
    while (frontier.length) {
      for (const n of frontier) done.add(n);
      await chunks.prefetch(frontier.map((n) => file.offsetOf(n)));
      const next: number[] = [];
      for (const n of frontier) {
        const o = await file.get(n);
        if (!o) continue; // a reference to nothing reads as null
        if (isDict(o.value)) {
          const type = o.value.m.get("Type");
          if (isName(type) && (SKIP_TYPES.has(type.v) || (layersOnly && type.v === "OCG"))) continue;
        }
        begin(o.num, o.gen);
        emit(o.raw);
        if (o.stream) {
          emit(bytesOf("\nstream\n"));
          // Copied a piece at a time so a large image is never held twice.
          for (let p = o.stream.dataStart, end = o.stream.dataStart + o.stream.length; p < end; p += 4 * 1024 * 1024) {
            emit(await chunks.slice(p, Math.min(end, p + 4 * 1024 * 1024)));
          }
          emit(bytesOf("\nendstream"));
        }
        emit(bytesOf("\nendobj\n"));
        const found: number[] = [];
        refsIn(o.value, found);
        for (const r of found) if (!done.has(r)) { done.add(r); next.push(r); }
      }
      frontier = next;
    }
  };
  await copy(roots, false);

  // Layer visibility lives in the catalog, not on the page: without it a layer
  // the drawing has switched off would render. The settings are carried over
  // as written.
  const cat = catObj.value as PdfDict;
  let layers: Uint8Array | null = null;
  const ocSpan = cat.spans.get("OCProperties");
  if (ocSpan) {
    layers = spanOf(catObj, ocSpan);
    const ocRefs: number[] = [];
    refsIn(cat.m.get("OCProperties")!, ocRefs);
    await copy(ocRefs, true);
  }

  begin(pagesNum, 0);
  emit(bytesOf(`<< /Type /Pages /Kids [${page.num} ${page.gen} R] /Count 1 >>\nendobj\n`));
  begin(catalogNum, 0);
  emit(bytesOf(`<< /Type /Catalog /Pages ${pagesNum} 0 R`));
  if (layers) { emit(bytesOf(" /OCProperties ")); emit(layers); }
  emit(bytesOf(" >>\nendobj\n"));

  // A cross-reference table with one subsection per run of object numbers.
  const nums = [...offsets.keys()].sort((a, b) => a - b);
  const xrefAt = pos;
  let table = "xref\n0 1\n0000000000 65535 f \n";
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    table += `${nums[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) {
      const e = offsets.get(nums[k])!;
      table += `${String(e.offset).padStart(10, "0")} ${String(e.gen).padStart(5, "0")} n \n`;
    }
    i = j + 1;
  }
  table += `trailer\n<< /Size ${catalogNum + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  emit(bytesOf(table));

  const bytes = new Uint8Array(pos);
  let w = 0;
  for (const b of out) { bytes.set(b, w); w += b.byteLength; }
  return { bytes, objects: offsets.size - 2 };
}
