// Reading a OneNote section file (.one) straight from its bytes.
//
// Why this exists: the connector signs in to Graph as an app, and Microsoft
// retired app-only access to the OneNote API (March 2025), so page content
// cannot be asked for the normal way. But a notebook stored in SharePoint is a
// folder of ordinary files, one .one file per section, and the connector can
// already download those. This module reads the page text out of that file.
//
// The format: SharePoint and OneDrive store a section in the "alternative
// packaging" form of MS-ONESTORE (section 2.8): a 64-byte header, then one
// MS-FSSHTTPB data element package. The package holds
//   - a storage index      (which cell and which revision live where),
//   - a storage manifest   (which cell is the section root),
//   - cell manifests       (the current revision of each cell),
//   - revision manifests   (root objects, object groups, base revision),
//   - object groups        (the objects: a type id and a property set each),
//   - object data BLOBs    (pictures, printouts, attached files).
// A page is its own cell. Its text sits in "rich text" objects reached from the
// page's root object through child-node properties (MS-ONE). The desktop
// "revision store" form of .one (a file saved by OneNote 2016 to a local disk)
// is a different layout and is NOT read here: the caller gets an error that
// says so.
//
// Size: a section with printouts is routinely 100MB+ (the BLOBs), while all of
// its text is a few MB. The file is therefore read through byte ranges and the
// large BLOBs are jumped over, never downloaded. Measured 2026-11-23 on real
// sections of 22MB, 81MB and 350MB: 0.6MB, 1.6MB and 2.5MB of object data,
// read in 13, 29 and 80 range requests.
//
// What comes out is TEXT: paragraphs, table rows, the names of attached files,
// and the text OneNote itself recognised in a picture. A PDF "printed" into a
// page is one picture per sheet, and OneNote usually has recognised text for
// it, marked "[text in image: <file>]". That recognition is OneNote's own and
// can be partial, so a figure or clause taken from it wants a check against
// the original. A picture of real size with no recognised text prints as
// "[image..., not read]" and is counted in `imagesWithoutText`, so a reader
// knows something on the page was not read.
//
// Pure of any storage: the caller supplies `fetchRange`. See the tests.

export type RangeRead = (begin: number, endExclusive: number) => Promise<Uint8Array>;

export type OneNotePage = {
  title: string;
  created: string | null;       // ISO, from the page's creation timestamp
  level: number;                // 1 = page, 2+ = subpage
  text: string;
  images: number;
  imagesWithoutText: number;    // pictures OneNote holds no recognised text for
  attachments: string[];        // names of files attached to the page
};

export type OneNoteSection = {
  pages: OneNotePage[];
  warnings: string[];
  bytesFetched: number;
  requests: number;
};

const GUID_ONE = "e4525c7b8cd8a74daeb15378d02996d3";       // {7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}, a section
const GUID_ONETOC2 = "a12fff43d9ef764c9ee210ea5722765f";   // {43FF2FA1-EFD9-4C76-9EE2-10EA5722765F}, a notebook's table of contents
const GUID_PACKAGE = "2fe98d63d4a6c14b9a36b3fc2511a5b7";   // {638DE92F-A6D4-4BC1-9A36-B3FC2511A5B7}, the packaging form

// The context every current page lives in; other contexts are version history.
const DEFAULT_CONTEXT = "b9fade84a3aa0d4aa3a8520c77ac7073:1";  // {84DEFAB9-AAA3-4A0D-A3A8-520C77AC7073},1

// Stream object types (MS-FSSHTTPB 2.2.1.5).
const T_DATA_ELEMENT = 0x01, T_PACKAGE = 0x15, T_PACKAGING_START = 0x7a;
const T_SI_CELL = 0x0e, T_SI_REVISION = 0x0d, T_SM_ROOT = 0x07, T_CELL_CURRENT = 0x0b;
const T_REVISION = 0x1a, T_REVISION_ROOT = 0x0a, T_REVISION_GROUP = 0x19;
const T_GROUP_DECLARATIONS = 0x1d, T_GROUP_DATA = 0x1e, T_DECLARE = 0x18, T_DECLARE_BLOB = 0x05, T_OBJECT_DATA = 0x16;
// Data element types.
const DE_STORAGE_INDEX = 1, DE_STORAGE_MANIFEST = 2, DE_CELL_MANIFEST = 3, DE_REVISION_MANIFEST = 4, DE_OBJECT_GROUP = 5;

// Object types (MS-ONE 2.2).
const JCID_IMAGE = 0x00060011, JCID_TABLE_ROW = 0x00060023, JCID_TABLE_CELL = 0x00060024, JCID_EMBEDDED_FILE = 0x00060035;
// Properties (MS-ONE 2.1.12). The top 6 bits are the value type, the rest the id.
const P_ELEMENT_CHILDREN = 0x24001c20, P_CONTENT_CHILDREN = 0x24001c1f, P_STRUCTURE_CHILDREN = 0x24001d5f;
const P_CHILD_SPACES = 0x2c001d63;
const P_TEXT_UNICODE = 0x1c001c22, P_TEXT_ASCII = 0x1c003498;
const P_CACHED_TITLE = 0x1c001cf3, P_CREATED = 0x18001c65, P_PAGE_LEVEL = 0x14001dff;
const P_EMBEDDED_FILE_NAME = 0x1c001d9c, P_IMAGE_FILE_NAME = 0x1c001dd7, P_IMAGE_ALT_TEXT = 0x1c001e58;
const P_PICTURE_WIDTH = 0x140034cd, P_PICTURE_HEIGHT = 0x140034ce;   // float32, in half-inches

// A picture under an inch on either side is a logo, an icon or a signature
// banner from a pasted email. Without recognised text it says nothing, so it
// is neither printed nor counted as "not read".
const SMALL_PICTURE = 2;

// No single object, header or reference list in a real section comes near
// this; a length beyond it means the bytes are not what the parser thinks.
const MAX_OBJECT_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 80;

const hex = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; };

// ── Bytes in hand ───────────────────────────────────────────────────────────
// A cursor over a byte array. Everything in the format is little-endian.
class Cur {
  b: Uint8Array; p: number;
  constructor(b: Uint8Array, p = 0) { this.b = b; this.p = p; }
  private has(n: number) { if (this.p + n > this.b.length) throw new Error("OneNote section: unexpected end of data"); }
  u8() { this.has(1); return this.b[this.p++]; }
  u16() { this.has(2); const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
  u32() { this.has(4); const b = this.b, p = this.p; this.p += 4; return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }
  bytes(n: number) { this.has(n); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  // "Compact unsigned 64-bit integer": the count of trailing zero bits in the
  // first byte says how many bytes the value takes.
  cu64(): number {
    this.has(1);
    const first = this.b[this.p];
    if (first === 0) { this.p++; return 0; }
    if (first === 0x80) { this.p++; const lo = this.u32(), hi = this.u32(); return hi * 4294967296 + lo; }
    let n = 1;
    while (n < 8 && (first & ((1 << n) - 1)) !== (1 << (n - 1))) n++;
    this.has(n);
    let v = 0;
    for (let i = n - 1; i >= 0; i--) v = v * 256 + this.b[this.p + i];
    this.p += n;
    return Math.floor(v / 2 ** n);
  }
  // "Extended GUID": a GUID plus a number, in one of four widths. "" is null.
  exguid(): string {
    this.has(1);
    const first = this.b[this.p];
    if (first === 0) { this.p++; return ""; }
    let n: number;
    if ((first & 0x07) === 0x04) { n = first >> 3; this.p += 1; }
    else if ((first & 0x3f) === 0x20) { n = this.u16() >> 6; }
    else if ((first & 0x7f) === 0x40) { this.has(3); n = (this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16)) >> 7; this.p += 3; }
    else if (first === 0x80) { this.p += 1; n = this.u32(); }
    else throw new Error("OneNote section: unreadable extended GUID");
    return hex(this.bytes(16)) + ":" + n;
  }
  cellId(): string { const a = this.exguid(); return a + "|" + this.exguid(); }
  serial() { const t = this.u8(); if (t === 0x80) this.p += 24; else if (t !== 0) throw new Error("OneNote section: unreadable serial number"); }
  exguidArray(): string[] { const n = this.count(); const out: string[] = []; for (let i = 0; i < n; i++) out.push(this.exguid()); return out; }
  cellIdArray(): string[] { const n = this.count(); const out: string[] = []; for (let i = 0; i < n; i++) out.push(this.cellId()); return out; }
  private count() { const n = this.cu64(); if (n > this.b.length) throw new Error("OneNote section: unreadable list length"); return n; }
}

// ── Bytes over the wire ─────────────────────────────────────────────────────
// Sequential reads with jumps. After a jump (a BLOB skipped) the next fetch is
// the minimum size, because often only the next header is wanted before the
// next jump; while reads stay sequential the fetch size grows, so an object
// group is read in a few large requests. The minimum is a trade: a request
// costs far more time than the bytes in it, so a larger minimum swallows small
// BLOBs whole instead of jumping each one. On the real 350MB section, 32KB
// took 123 requests for 10MB and 256KB took 80 requests for 24MB.
const CHUNK_MIN = 256 * 1024, CHUNK_MAX = 1024 * 1024;
class Ranged {
  pos = 0; bytesFetched = 0; requests = 0;
  private buf = new Uint8Array(0); private bufAt = 0; private chunk = CHUNK_MIN;
  size: number; private fetchRange: RangeRead;
  constructor(size: number, fetchRange: RangeRead) { this.size = size; this.fetchRange = fetchRange; }
  // Bytes [pos, pos+n) as one array, fetched if not in hand. Does not move pos.
  async peek(n: number): Promise<Uint8Array> {
    if (n > MAX_OBJECT_BYTES) throw new Error("OneNote section: an object claims an implausible size");
    const end = Math.min(this.pos + n, this.size);
    const bufEnd = this.bufAt + this.buf.length;
    if (this.pos >= this.bufAt && end <= bufEnd) return this.buf.subarray(this.pos - this.bufAt, end - this.bufAt);
    const sequential = this.buf.length > 0 && this.pos >= this.bufAt && this.pos <= bufEnd;
    this.chunk = sequential ? Math.min(this.chunk * 4, CHUNK_MAX) : CHUNK_MIN;
    const from = sequential ? bufEnd : this.pos;
    const to = Math.min(Math.max(end, from + this.chunk), this.size);
    const got = to > from ? await this.fetchRange(from, to) : new Uint8Array(0);
    if (got.byteLength !== to - from) throw new Error(`OneNote section: range ${from}-${to} returned ${got.byteLength} bytes`);
    this.requests++; this.bytesFetched += got.byteLength;
    if (sequential) {
      const keep = this.buf.subarray(this.pos - this.bufAt);
      const joined = new Uint8Array(keep.length + got.length);
      joined.set(keep, 0); joined.set(got, keep.length);
      this.buf = joined;
    } else this.buf = got;
    this.bufAt = this.pos;
    return this.buf.subarray(0, end - this.pos);
  }
  async take(n: number): Promise<Uint8Array> {
    const b = await this.peek(n);
    if (b.length < n) throw new Error("OneNote section: the file ends in the middle of an object");
    this.pos += n;
    return b;
  }
  skip(n: number) { this.pos += n; }
}

type Header = { end: boolean; type: number; compound: boolean; length: number };
// A stream object header: the low two bits say which of the four forms it is.
async function readHeader(r: Ranged): Promise<Header> {
  const b = await r.peek(13);
  if (!b.length) throw new Error("OneNote section: the file ends before its package does");
  const c = new Cur(b);
  const kind = b[0] & 3;
  let h: Header;
  if (kind === 0) { const v = c.u16(); h = { end: false, type: (v >> 3) & 0x3f, compound: !!(v & 4), length: v >> 9 }; }
  else if (kind === 2) {
    const v = c.u32(); let length = v >>> 17;
    if (length === 32767) length = c.cu64();
    h = { end: false, type: (v >>> 3) & 0x3fff, compound: !!(v & 4), length };
  }
  else if (kind === 1) h = { end: true, type: c.u8() >> 2, compound: false, length: 0 };
  else h = { end: true, type: c.u16() >> 2, compound: false, length: 0 };
  r.skip(c.p);
  return h;
}
// Step over the rest of a compound object whose children are not wanted.
async function drain(r: Ranged, depth = 0): Promise<void> {
  if (depth > 16) throw new Error("OneNote section: stream objects nested too deep");
  for (;;) {
    const h = await readHeader(r);
    if (h.end) return;
    r.skip(h.length);
    if (h.compound) await drain(r, depth + 1);
  }
}

// ── The package ─────────────────────────────────────────────────────────────
type ObjData = { refs: string[]; cells: string[]; bytes: Uint8Array };
type Obj = { jcid?: number; data?: ObjData };
type Revision = { base: string; roots: Array<[number, string]>; groups: string[] };
type Package = {
  cellManifestOf: Map<string, string>;       // cell id -> cell manifest data element
  revisionManifestOf: Map<string, string>;   // revision id -> revision manifest data element
  currentRevision: Map<string, string>;      // cell manifest data element -> revision id
  revisions: Map<string, Revision>;          // revision manifest data element -> its content
  groups: Map<string, Map<string, Obj>>;     // object group data element -> objects by id
  roots: Array<[number, string]>;            // storage manifest roots: [number, cell id]
};

async function readPackage(r: Ranged): Promise<Package> {
  const head = await r.take(68);
  const fileType = hex(head.subarray(0, 16)), fileFormat = hex(head.subarray(48, 64));
  if (fileType === GUID_ONETOC2) throw new Error("This is a notebook's table of contents (.onetoc2), which holds no pages. Read the .one section files beside it.");
  if (fileType !== GUID_ONE) throw new Error("Not a OneNote section file (.one).");
  if (fileFormat !== GUID_PACKAGE) throw new Error("This .one file is in OneNote's desktop (revision store) layout, which the connector does not read. Sections stored in SharePoint or OneDrive use the layout it does read; for this file, export the section to PDF or Word.");
  let h = await readHeader(r);
  if (h.end || h.type !== T_PACKAGING_START) throw new Error("OneNote section: packaging header not found");
  r.skip(h.length);
  h = await readHeader(r);
  if (h.end || h.type !== T_PACKAGE) throw new Error("OneNote section: data element package not found");
  r.skip(h.length);

  const pkg: Package = { cellManifestOf: new Map(), revisionManifestOf: new Map(), currentRevision: new Map(), revisions: new Map(), groups: new Map(), roots: [] };
  for (;;) {
    h = await readHeader(r);
    if (h.end) break;
    if (h.type !== T_DATA_ELEMENT) throw new Error("OneNote section: unexpected object where a data element should start");
    const start = new Cur(await r.take(h.length));
    const id = start.exguid(); start.serial(); const kind = start.cu64();

    if (kind === DE_OBJECT_GROUP) { pkg.groups.set(id, await readObjectGroup(r)); continue; }
    const revision: Revision = { base: "", roots: [], groups: [] };
    for (;;) {
      const c = await readHeader(r);
      if (c.end) break;
      const wanted =
        (kind === DE_STORAGE_INDEX && (c.type === T_SI_CELL || c.type === T_SI_REVISION)) ||
        (kind === DE_STORAGE_MANIFEST && c.type === T_SM_ROOT) ||
        (kind === DE_CELL_MANIFEST && c.type === T_CELL_CURRENT) ||
        (kind === DE_REVISION_MANIFEST && (c.type === T_REVISION || c.type === T_REVISION_ROOT || c.type === T_REVISION_GROUP));
      // Anything else, a picture's or printout's BLOB above all, is stepped
      // over without being downloaded.
      if (!wanted) { r.skip(c.length); if (c.compound) await drain(r); continue; }
      const q = new Cur(await r.take(c.length));
      if (c.type === T_SI_CELL) { const cell = q.cellId(); pkg.cellManifestOf.set(cell, q.exguid()); }
      else if (c.type === T_SI_REVISION) { const rev = q.exguid(); pkg.revisionManifestOf.set(rev, q.exguid()); }
      else if (c.type === T_SM_ROOT) { const root = q.exguid(); pkg.roots.push([Number(root.split(":")[1] || 0), q.cellId()]); }
      else if (c.type === T_CELL_CURRENT) pkg.currentRevision.set(id, q.exguid());
      else if (c.type === T_REVISION) { q.exguid(); revision.base = q.exguid(); }
      else if (c.type === T_REVISION_ROOT) { const role = q.exguid(); revision.roots.push([Number(role.split(":")[1] || 0), q.exguid()]); }
      else if (c.type === T_REVISION_GROUP) revision.groups.push(q.exguid());
      if (c.compound) await drain(r);
    }
    if (kind === DE_REVISION_MANIFEST) pkg.revisions.set(id, revision);
  }
  return pkg;
}

// An object group: a list of declarations, then the data in the same order.
// Each OneNote object appears twice: partition 4 holds its type id (JCID),
// partition 1 its property set. Other partitions (file data) are not read.
async function readObjectGroup(r: Ranged): Promise<Map<string, Obj>> {
  const objects = new Map<string, Obj>();
  const declared: Array<{ id: string; partition: number }> = [];
  let dataIndex = 0;
  for (;;) {
    const h = await readHeader(r);
    if (h.end) break;
    if (h.type === T_GROUP_DECLARATIONS) {
      r.skip(h.length);
      for (;;) {
        const d = await readHeader(r);
        if (d.end) break;
        const q = new Cur(await r.take(d.length));
        if (d.type === T_DECLARE) { const id = q.exguid(); declared.push({ id, partition: q.cu64() }); }
        else if (d.type === T_DECLARE_BLOB) { const id = q.exguid(); q.exguid(); declared.push({ id, partition: q.cu64() }); }
        else declared.push({ id: "", partition: -1 });
        if (d.compound) await drain(r);
      }
    } else if (h.type === T_GROUP_DATA) {
      r.skip(h.length);
      for (;;) {
        const d = await readHeader(r);
        if (d.end) break;
        const decl = declared[dataIndex++];
        if (!decl) throw new Error("OneNote section: an object group holds more data than it declares");
        if (d.type !== T_OBJECT_DATA || (decl.partition !== 1 && decl.partition !== 4)) { r.skip(d.length); if (d.compound) await drain(r); continue; }
        const q = new Cur(await r.take(d.length));
        const refs = q.exguidArray(), cells = q.cellIdArray();
        // The slice is copied: the reader's buffer is reused for later ranges.
        const bytes = q.bytes(q.cu64()).slice();
        let o = objects.get(decl.id);
        if (!o) { o = {}; objects.set(decl.id, o); }
        if (decl.partition === 4) o.jcid = bytes.length >= 4 ? new Cur(bytes).u32() : 0;
        else o.data = { refs, cells, bytes };
        if (d.compound) await drain(r);
      }
    } else { r.skip(h.length); if (h.compound) await drain(r); }
  }
  return objects;
}

// A cell's objects: those of its current revision, then of each revision that
// one is based on, newest first, so an object changed since the base revision
// is read in its changed form.
type Space = { roots: Map<number, string>; objects: Map<string, Obj> };
function openSpace(pkg: Package, cell: string): Space | null {
  const manifest = pkg.cellManifestOf.get(cell);
  let rev = manifest ? pkg.currentRevision.get(manifest) || "" : "";
  if (!rev) return null;
  const space: Space = { roots: new Map(), objects: new Map() };
  const seen = new Set<string>();
  while (rev && !seen.has(rev)) {
    seen.add(rev);
    const m = pkg.revisions.get(pkg.revisionManifestOf.get(rev) || "");
    if (!m) break;
    for (const [role, id] of m.roots) if (!space.roots.has(role)) space.roots.set(role, id);
    for (const g of m.groups) {
      for (const [id, o] of pkg.groups.get(g) || []) {
        const have = space.objects.get(id);
        if (!have) space.objects.set(id, { jcid: o.jcid, data: o.data });
        else { if (have.jcid === undefined) have.jcid = o.jcid; if (!have.data) have.data = o.data; }
      }
    }
    rev = m.base;
  }
  return space;
}

// ── Property sets ───────────────────────────────────────────────────────────
// (MS-ONESTORE 2.6.1, 2.6.7.) A property set stores numbers and strings
// in-line; a reference to another object, cell or context is stored as the
// next entry of one of three id lists that sit in front of the set. In the
// packaged form those lists hold placeholders, and the real ids are the
// object's reference lists, in the same order with nulls left out.
type Props = Map<number, unknown>;
type RefStreams = { objects: string[]; spaces: string[]; contexts: string[] };

function idStream(q: Cur): { ids: number[]; extended: boolean; noSpaces: boolean } {
  const head = q.u32();
  const n = head & 0xffffff;
  if (n * 4 > q.b.length - q.p) throw new Error("OneNote section: unreadable id list");
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(q.u32());
  return { ids, extended: !!(head & 0x40000000), noSpaces: !!(head & 0x80000000) };
}

function readProps(data: ObjData): Props {
  const q = new Cur(data.bytes);
  const o = idStream(q);
  let spaceIds: number[] = [], contextIds: number[] = [];
  if (!o.noSpaces) {
    const s = idStream(q); spaceIds = s.ids;
    if (s.extended) contextIds = idStream(q).ids;
  }
  const refs = data.refs.slice(), cells = data.cells.slice();
  const streams: RefStreams = {
    objects: o.ids.map((id) => (id ? refs.shift() ?? "" : "")),
    spaces: spaceIds.map((id) => (id ? (cells.shift() ?? "").split("|")[1] ?? "" : "")),
    contexts: contextIds.map((id) => (id ? cells.shift() ?? "" : "")),
  };
  return propertySet(q, streams, 0);
}

function propertySet(q: Cur, s: RefStreams, depth: number): Props {
  if (depth > 8) throw new Error("OneNote section: property sets nested too deep");
  const n = q.u16();
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(q.u32());
  const out: Props = new Map();
  const many = (from: string[]) => { const c = q.u32(); return from.splice(0, c); };
  for (const id of ids) {
    const type = (id >>> 26) & 0x1f;
    let v: unknown;
    switch (type) {
      case 0x1: v = null; break;
      case 0x2: v = id >>> 31 === 1; break;
      case 0x3: v = q.bytes(1); break;
      case 0x4: v = q.bytes(2); break;
      case 0x5: v = q.bytes(4); break;
      case 0x6: v = q.bytes(8); break;
      case 0x7: v = q.bytes(q.u32()); break;
      case 0x8: v = s.objects.shift() ?? ""; break;
      case 0x9: v = many(s.objects); break;
      case 0xa: v = s.spaces.shift() ?? ""; break;
      case 0xb: v = many(s.spaces); break;
      case 0xc: v = s.contexts.shift() ?? ""; break;
      case 0xd: v = many(s.contexts); break;
      case 0x10: {
        const c = q.u32(); const sets: Props[] = [];
        if (c) { q.u32(); for (let i = 0; i < c; i++) sets.push(propertySet(q, s, depth + 1)); }
        v = sets; break;
      }
      case 0x11: v = propertySet(q, s, depth + 1); break;
      default: throw new Error("OneNote section: unknown property type 0x" + type.toString(16));
    }
    out.set((id & 0x7fffffff) >>> 0, v);
  }
  return out;
}

// ── Text ────────────────────────────────────────────────────────────────────
const utf16 = new TextDecoder("utf-16le");
let _cp1252: TextDecoder | null = null;
function latin(b: Uint8Array): string {
  // "TextExtendedAscii" is single-byte text in the Windows Western code page.
  try { _cp1252 = _cp1252 || new TextDecoder("windows-1252"); return _cp1252.decode(b); }
  catch { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; }
}
const str16 = (v: unknown) => (v instanceof Uint8Array ? utf16.decode(v).replace(/\u0000+$/, "") : "");
// A link is stored as a field code in front of the visible text
// (U+FDDF HYPERLINK "target"): the target goes, the visible text stays.
// U+000B is a line break inside a paragraph.
export function cleanOneNoteText(t: string): string {
  return t
    .replace(/﷟HYPERLINK\s+"[^"]*"/g, "")
    .replace(/﷟/g, "")
    .replace(/\u000B/g, "\n")
    .replace(/ /g, " ")
    .replace(/[\u0000-\u0008\u000C\u000E-\u001F￼]/g, "")
    .replace(/[ \t]+$/gm, "");
}
function float32(v: unknown): number | null {
  if (!(v instanceof Uint8Array) || v.length !== 4) return null;
  const f = new DataView(v.buffer, v.byteOffset, 4).getFloat32(0, true);
  return Number.isFinite(f) ? f : null;
}
function filetimeIso(v: unknown): string | null {
  if (!(v instanceof Uint8Array) || v.length !== 8) return null;
  const c = new Cur(v); const lo = c.u32(), hi = c.u32();
  const ms = (hi * 4294967296 + lo) / 10000 - 11644473600000;
  if (!(ms > 0) || ms > 4102444800000) return null;
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}

function pageOf(space: Space, warnings: string[]): OneNotePage {
  const cache = new Map<string, Props | null>();
  const props = (id: string): Props | null => {
    if (cache.has(id)) return cache.get(id)!;
    const o = space.objects.get(id);
    let p: Props | null = null;
    if (o?.data) { try { p = readProps(o.data); } catch (e) { warnings.push(String((e as Error)?.message ?? e)); } }
    cache.set(id, p);
    return p;
  };
  const page: OneNotePage = { title: "", created: null, level: 1, text: "", images: 0, imagesWithoutText: 0, attachments: [] };
  const meta = props(space.roots.get(2) || "");
  if (meta) {
    page.title = cleanOneNoteText(str16(meta.get(P_CACHED_TITLE))).trim();
    page.created = filetimeIso(meta.get(P_CREATED));
    const lv = meta.get(P_PAGE_LEVEL);
    if (lv instanceof Uint8Array && lv.length === 4) page.level = Math.max(1, new Cur(lv).u32());
  }

  let lines: string[] = [];
  const onPath = new Set<string>();
  const childrenOf = (p: Props) => {
    const out: string[] = [];
    for (const key of [P_CONTENT_CHILDREN, P_STRUCTURE_CHILDREN, P_ELEMENT_CHILDREN]) {
      const v = p.get(key);
      if (Array.isArray(v)) for (const id of v) if (typeof id === "string" && id) out.push(id);
    }
    return out;
  };
  const walk = (id: string, depth: number) => {
    if (!id || depth > MAX_DEPTH || onPath.has(id)) return;
    const p = props(id);
    if (!p) return;
    const jcid = space.objects.get(id)?.jcid;
    onPath.add(id);
    const raw = p.has(P_TEXT_UNICODE) ? str16(p.get(P_TEXT_UNICODE))
      : p.get(P_TEXT_ASCII) instanceof Uint8Array ? latin(p.get(P_TEXT_ASCII) as Uint8Array) : "";
    const text = cleanOneNoteText(raw);
    if (jcid === JCID_IMAGE) {
      // On a picture the text property is what OneNote recognised in it.
      page.images++;
      const name = str16(p.get(P_IMAGE_FILE_NAME)).trim();
      const alt = cleanOneNoteText(str16(p.get(P_IMAGE_ALT_TEXT))).replace(/\s+/g, " ").trim();
      const w = float32(p.get(P_PICTURE_WIDTH)), h = float32(p.get(P_PICTURE_HEIGHT));
      const small = w !== null && h !== null && (w < SMALL_PICTURE || h < SMALL_PICTURE);
      if (text.trim()) lines.push("[text in image" + (name ? ": " + name : "") + "] " + text.trim());
      else if (!small) { lines.push("[image" + (name ? ": " + name : "") + (alt ? " (" + alt + ")" : "") + ", not read]"); page.imagesWithoutText++; }
    } else if (text.trim()) lines.push(text);
    if (jcid === JCID_EMBEDDED_FILE) {
      const name = str16(p.get(P_EMBEDDED_FILE_NAME)).trim();
      if (name) page.attachments.push(name);
      lines.push("[attached file" + (name ? ": " + name : "") + "]");
    }
    if (jcid === JCID_TABLE_ROW || jcid === JCID_TABLE_CELL) {
      // A row is one line, its cells separated by " | ".
      const outer = lines; lines = [];
      for (const c of childrenOf(p)) walk(c, depth + 1);
      const inner = lines.map((x) => x.trim()).filter(Boolean); lines = outer;
      lines.push(inner.join(jcid === JCID_TABLE_ROW ? " | " : " / "));
    } else for (const c of childrenOf(p)) walk(c, depth + 1);
    onPath.delete(id);
  };
  // The page's root lists the page itself first; anything after it is a
  // conflict copy OneNote kept, which is not the page as it reads today.
  const manifest = props(space.roots.get(1) || "");
  const tops = manifest ? childrenOf(manifest) : [];
  if (tops.length) walk(tops[0], 0);
  if (tops.length > 1) warnings.push(`"${page.title || "Untitled page"}" has ${tops.length - 1} conflict copy(ies) that were not read.`);
  page.text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return page;
}

export async function readOneNoteSection(size: number, fetchRange: RangeRead): Promise<OneNoteSection> {
  const r = new Ranged(size, fetchRange);
  const pkg = await readPackage(r);
  const warnings: string[] = [];
  const pages: OneNotePage[] = [];
  const rootCell = pkg.roots.find(([n]) => n === 2)?.[1];
  const root = rootCell ? openSpace(pkg, rootCell) : null;
  if (!root) throw new Error("OneNote section: the section's root was not found in the file");
  const rootProps = (id: string): Props | null => {
    const o = root.objects.get(id);
    if (!o?.data) return null;
    try { return readProps(o.data); } catch (e) { warnings.push(String((e as Error)?.message ?? e)); return null; }
  };
  // Section -> page series -> the cell of each page, in the order OneNote shows them.
  const section = rootProps(root.roots.get(1) || "");
  const seriesIds = section?.get(P_ELEMENT_CHILDREN);
  for (const seriesId of Array.isArray(seriesIds) ? seriesIds : []) {
    const series = typeof seriesId === "string" ? rootProps(seriesId) : null;
    const spaces = series?.get(P_CHILD_SPACES);
    for (const spaceId of Array.isArray(spaces) ? spaces : []) {
      if (typeof spaceId !== "string" || !spaceId) continue;
      const space = openSpace(pkg, DEFAULT_CONTEXT + "|" + spaceId);
      if (!space) { warnings.push("A page listed in the section has no content in the file."); continue; }
      pages.push(pageOf(space, warnings));
    }
  }
  return { pages, warnings: [...new Set(warnings)].slice(0, 20), bytesFetched: r.bytesFetched, requests: r.requests };
}

// ── What read_document returns ──────────────────────────────────────────────
// "3", "2-5", "1,4,7-9" -> page numbers, in order, within 1..total.
export function parsePageList(spec: string, total: number): number[] {
  const out: number[] = [];
  for (const part of String(spec || "").split(",")) {
    const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let i = Math.max(1, Math.min(a, b)); i <= Math.min(total, Math.max(a, b)); i++) if (!out.includes(i)) out.push(i);
  }
  return out;
}

// The index of every page is always returned (it is short), then as much page
// text as fits `maxChars`. With neither `find` nor `pages`, text starts at
// page 1; `nextPages` says what to ask for to continue.
export function oneNoteReadResult(
  section: OneNoteSection,
  opts: { find?: string; pages?: string; maxChars: number },
): Record<string, unknown> {
  const total = section.pages.length;
  const index = section.pages.map((p, i) => ({
    page: i + 1, title: p.title || "(untitled)", created: p.created, chars: p.text.length,
    ...(p.level > 1 ? { subpage: true } : {}),
    ...(p.attachments.length ? { attachments: p.attachments } : {}),
    ...(p.imagesWithoutText ? { imagesNotRead: p.imagesWithoutText } : {}),
  }));
  const term = String(opts.find || "").trim().toLowerCase();
  let wanted: number[];
  let mode: string;
  if (term) {
    wanted = [];
    section.pages.forEach((p, i) => { if ((p.title + "\n" + p.text).toLowerCase().includes(term)) wanted.push(i + 1); });
    mode = "find";
  } else if (opts.pages && String(opts.pages).trim()) { wanted = parsePageList(opts.pages, total); mode = "pages"; }
  else { wanted = section.pages.map((_, i) => i + 1); mode = "all"; }

  const parts: string[] = []; const returned: number[] = []; let used = 0; let truncatedPage: number | null = null;
  for (const n of wanted) {
    const p = section.pages[n - 1];
    const head = `===== Page ${n} of ${total}: ${p.title || "(untitled)"}${p.created ? " (created " + p.created.slice(0, 10) + ")" : ""} =====\n`;
    const room = opts.maxChars - used;
    if (returned.length && head.length + p.text.length > room) break;
    let body = p.text;
    if (head.length + body.length > room) { body = body.slice(0, Math.max(0, room - head.length)) + "\n…[page truncated]"; truncatedPage = n; }
    parts.push(head + body); returned.push(n); used += head.length + body.length + 2;
    if (truncatedPage) break;
  }
  const rest = wanted.filter((n) => !returned.includes(n));
  const unread = section.pages.reduce((a, p) => a + p.imagesWithoutText, 0);
  const notes: string[] = [];
  if (mode === "find" && !wanted.length) notes.push(`No page's title or text contains "${opts.find}".`);
  if (mode === "pages" && !wanted.length) notes.push(`No such page: the section has ${total} page(s).`);
  if (rest.length) notes.push(`Not all requested pages fit in one answer. Call again with pages:'${compactPageList(rest)}'.`);
  if (truncatedPage) notes.push(`Page ${truncatedPage} is longer than one answer holds and was cut; use find:'keyword' to check it for a specific term, or open it in OneNote.`);
  if (unread) notes.push(`${unread} picture(s) or printout sheet(s) hold no text OneNote recognised, so their content is NOT in this text (pageIndex shows which pages, as imagesNotRead). Open those pages in OneNote, or read the original file if it is filed elsewhere.`);
  if (parts.some((t) => t.includes("[text in image"))) notes.push("Lines marked [text in image] are OneNote's own recognition of a picture or printed PDF sheet and can be partial or misread: check a figure, date or clause taken from one against the original document.");
  return {
    type: "onenote-section",
    totalPages: total,
    pageIndex: index,
    returnedPages: compactPageList(returned),
    ...(rest.length ? { nextPages: compactPageList(rest) } : {}),
    ...(mode === "find" ? { find: opts.find, matchingPages: compactPageList(wanted) } : {}),
    text: parts.join("\n\n"),
    ...(notes.length ? { note: notes.join(" ") } : {}),
    ...(section.warnings.length ? { warnings: section.warnings } : {}),
  };
}

// [1,2,3,7,9,10] -> "1-3,7,9-10"
export function compactPageList(nums: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]));
    i = j;
  }
  return out.join(",");
}

// ── Where a notebook's files sit ────────────────────────────────────────────
// A notebook made on a SharePoint site is a folder in the library's Notebooks
// folder, "Notebooks/<number> — <name>/<section>.one". Given a file's
// `parentReference.path` from Graph ("/drives/<id>/root:/Notebooks/<folder>…",
// percent-encoded or not), this returns that notebook folder's name, or ""
// when the file is not inside a notebook. The connector uses it to gate a
// section on its project the way the project's own folder is gated.
export function oneNoteNotebookFolder(parentPath: string): string {
  const path = String(parentPath || "");
  const i = path.indexOf("/root:/");
  if (i < 0) return "";
  const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  const seg = path.slice(i + 7).split("/");
  if (!/^notebooks$/i.test(decode(seg[0] || ""))) return "";
  return decode(seg[1] || "");
}
