// Reading a OneNote section file (.one) from its bytes: oneNoteSection.ts.
//
// The fixture is built here, byte by byte, in the same packaged layout
// SharePoint stores (MS-ONESTORE 2.8 over MS-FSSHTTPB): no real notebook is in
// the repo. The parser was also run against three real sections (22MB, 81MB,
// 350MB) on 2026-11-23; that check needs the files, so it is not in this suite.
//
//   node --test supabase/functions/pms-mcp/oneNoteSection.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readOneNoteSection, oneNoteReadResult, parsePageList, compactPageList, cleanOneNoteText, oneNoteNotebookFolder,
} from "./oneNoteSection.ts";
import { projectNumberOfFolder } from "./azureFiles.ts";

// ── A tiny encoder for the format ───────────────────────────────────────────
const cat = (...parts) => {
  const flat = parts.flat(Infinity).map((p) => (typeof p === "number" ? Uint8Array.of(p) : p));
  const out = new Uint8Array(flat.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of flat) { out.set(p, o); o += p.length; }
  return out;
};
const le = (v, n) => { const b = new Uint8Array(n); let x = BigInt(v); for (let i = 0; i < n; i++) { b[i] = Number(x & 255n); x >>= 8n; } return b; };
const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const cu64 = (v) => {
  if (v === 0) return Uint8Array.of(0);
  for (let n = 1; n <= 7; n++) if (BigInt(v) < (1n << BigInt(7 * n))) return le((BigInt(v) << BigInt(n)) | (1n << BigInt(n - 1)), n);
  return cat(0x80, le(v, 8));
};
const guid = (n) => { const b = new Uint8Array(16); b[0] = n & 255; b[1] = n >> 8; b[15] = 0xee; return b; };
// An extended GUID in its 5-bit, 10-bit or 32-bit form, by the size of n.
const ex = (g, n) => g === null ? Uint8Array.of(0)
  : n < 32 ? cat((n << 3) | 4, g)
  : n < 1024 ? cat(le((n << 6) | 0x20, 2), g)
  : cat(0x80, le(n, 4), g);
const so = (type, compound, body) => {
  const flag = compound ? 4 : 0;
  if (type < 0x40 && body.length < 128) return cat(le((body.length << 9) | (type << 3) | flag, 2), body);
  if (body.length < 32767) return cat(le((BigInt(body.length) << 17n) | BigInt((type << 3) | flag | 2), 4), body);
  return cat(le((32767n << 17n) | BigInt((type << 3) | flag | 2), 4), cu64(body.length), body);
};
const end8 = (type) => Uint8Array.of((type << 2) | 1);
const end16 = (type) => le((type << 2) | 3, 2);
const serialNull = Uint8Array.of(0);
const serial = cat(0x80, guid(999), le(7, 8));
const dataElement = (id, kind, children) => cat(so(0x01, true, cat(id, serial, cu64(kind))), children, end8(0x01));

const DEFAULT_CTX = ex(fromHex("b9fade84a3aa0d4aa3a8520c77ac7073"), 1);
const HISTORY_CTX = ex(guid(700), 1);
const u16s = (s) => { const b = new Uint8Array(s.length * 2 + 2); for (let i = 0; i < s.length; i++) { b[2 * i] = s.charCodeAt(i) & 255; b[2 * i + 1] = s.charCodeAt(i) >> 8; } return b; };
const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const f32 = (v) => new Uint8Array(new Float32Array([v]).buffer);

// Property ids (type in the top bits).
const P = {
  elementChildren: 0x24001c20, contentChildren: 0x24001c1f, structureChildren: 0x24001d5f, childSpaces: 0x2c001d63,
  text16: 0x1c001c22, text8: 0x1c003498, title: 0x1c001cf3, created: 0x18001c65, level: 0x14001dff,
  fileName: 0x1c001d9c, imageName: 0x1c001dd7, width: 0x140034cd, height: 0x140034ce,
  styleRef: 0x2000342c, flag: 0x08001cbd,
};
// One object: its type id (partition 4) and its property set (partition 1).
// `props` is [[id, value]]; an object reference is an extended GUID (or null),
// a list of them an array.
function object(id, jcid, props) {
  const oids = [], spaces = [], refs = [], cells = [];
  const ids = [], data = [];
  for (const [pid, v] of props) {
    const type = (pid >>> 26) & 0x1f;
    ids.push(le(pid, 4));
    if (type === 7) data.push(le(v.length, 4), v);
    else if (type === 5 || type === 6) data.push(v);
    else if (type === 8) { oids.push(v ? 0x101 : 0); if (v) refs.push(v); }
    else if (type === 9) { data.push(le(v.length, 4)); for (const r of v) { oids.push(0x101); refs.push(r); } }
    else if (type === 0xb) { data.push(le(v.length, 4)); for (const r of v) { spaces.push(0x101); cells.push(cat(DEFAULT_CTX, r)); } }
    else if (type !== 2) throw new Error("fixture: property type " + type);
  }
  const stream = (list, flags) => cat(le(list.length | flags, 4), list.map((x) => le(x, 4)));
  const propSet = cat(
    spaces.length ? [stream(oids, 0), stream(spaces, 0)] : stream(oids, 0x80000000),
    le(ids.length, 2), ids, data,
  );
  return { id, jcid, refs, cells, propSet };
}
function objectGroup(id, objects) {
  const declarations = [], data = [];
  for (const o of objects) {
    declarations.push(so(0x18, false, cat(o.id, cu64(4), cu64(4), cu64(0), cu64(0))));
    data.push(so(0x16, false, cat(cu64(0), cu64(0), cu64(4), le(o.jcid, 4))));
    declarations.push(so(0x18, false, cat(o.id, cu64(1), cu64(o.propSet.length), cu64(o.refs.length), cu64(o.cells.length))));
    data.push(so(0x16, false, cat(cu64(o.refs.length), o.refs, cu64(o.cells.length), o.cells, cu64(o.propSet.length), o.propSet)));
  }
  return dataElement(id, 5, cat(so(0x1d, true, new Uint8Array(0)), declarations, end8(0x1d), so(0x1e, true, new Uint8Array(0)), data, end8(0x1e)));
}

let nextId = 1;
const oid = () => ex(guid(50), nextId++);          // object ids
const de = () => ex(guid(60), 2000 + nextId++);    // data element ids, in the 32-bit form
const rev = () => ex(guid(70), 40 + nextId++);     // revision ids, in the 10-bit form
const filetime = (iso) => le((BigInt(Date.parse(iso)) + 11644473600000n) * 10000n, 8);

// A page cell: returns the data elements and index entries for it.
function cell(context, space, revisions) {
  const parts = [], index = [];
  const cellManifest = de();
  let newer = null;
  const ids = revisions.map(() => rev());
  revisions.forEach((r, i) => {
    const group = de(), manifest = de();
    parts.push(objectGroup(group, r.objects));
    parts.push(dataElement(manifest, 4, cat(
      so(0x1a, false, cat(ids[i], i + 1 < ids.length ? ids[i + 1] : ex(null))),
      (r.roots || []).map(([role, id]) => so(0x0a, false, cat(ex(guid(80), role), id))),
      so(0x19, false, group),
    )));
    index.push(so(0x0d, false, cat(ids[i], manifest, serial)));
    newer = newer || ids[i];
  });
  parts.push(dataElement(cellManifest, 3, so(0x0b, false, newer)));
  index.push(so(0x0e, false, cat(context, space, cellManifest, serial)));
  return { parts, index };
}
const para = (text, wide) => { const t = oid(), e = oid(); return { top: e, objects: [object(e, 0x6000d, [[P.contentChildren, [t]]]), object(t, 0x6000e, [wide ? [P.text16, u16s(text)] : [P.text8, ascii(text)]])] }; };

function pageCell(space, { title, created, level, body, extraRevision, history }) {
  const manifest = oid(), page = oid(), meta = oid(), titleNode = oid(), outline = oid();
  const t = para(title, false);
  const objects = [
    object(manifest, 0x60037, [[P.contentChildren, [page]]]),
    object(meta, 0x20030, [[P.title, u16s(title)], [P.level, le(level || 1, 4)], [P.created, filetime(created)]]),
    object(page, 0x6000b, [[P.structureChildren, [titleNode]], [P.elementChildren, [outline]], [P.title, u16s(title)]]),
    object(titleNode, 0x6002c, [[P.elementChildren, [t.top]]]),
    ...t.objects,
    object(outline, 0x6000c, [[P.elementChildren, body.map((b) => b.top)]]),
    ...body.flatMap((b) => b.objects),
  ];
  const revisions = [];
  if (extraRevision) revisions.push({ objects: extraRevision, roots: [] });
  revisions.push({ objects, roots: [[1, manifest], [2, meta]] });
  const cur = cell(DEFAULT_CTX, space, revisions);
  if (history) {
    const h = cell(HISTORY_CTX, space, [{ objects: para(history, false).objects, roots: [] }]);
    cur.parts.push(...h.parts); cur.index.push(...h.index);
  }
  return cur;
}

function buildSection({ fileType, fileFormat, blobBytes = 0 } = {}) {
  nextId = 1;
  const space1 = ex(guid(90), 38), space2 = ex(guid(90), 39), rootSpace = ex(guid(91), 1), headerSpace = ex(guid(92), 1);

  // Page 1: paragraphs, a link, a nested paragraph, a table, pictures, an attached file.
  const p1 = para("Dear Mr. Lefkovitz — see ﷟HYPERLINK \"https://example.com/x\"the letter\u000Bsecond line", true);
  const p2 = para("Fee is \xa3500 caf\xe9", false);                       // single-byte text, Windows Western
  const nested = para("nested point", false);
  const parent = para("parent point", false);
  parent.objects[0] = object(parent.top, 0x6000d, [[P.contentChildren, [parent.objects[1].id]], [P.elementChildren, [nested.top]], [P.styleRef, null], [P.flag, true]]);
  const cellOf = (text) => { const c = oid(), pp = para(text, false); return { top: c, objects: [object(c, 0x60024, [[P.elementChildren, [pp.top]]]), ...pp.objects] }; };
  const c1 = cellOf("Subject"), c2 = cellOf("Notice of Backcharge");
  const row = oid(), table = oid(), tableOe = oid();
  const tableBlock = { top: tableOe, objects: [
    object(tableOe, 0x6000d, [[P.contentChildren, [table]]]), object(table, 0x60022, [[P.elementChildren, [row]]]),
    object(row, 0x60023, [[P.elementChildren, [c1.top, c2.top]]]), ...c1.objects, ...c2.objects] };
  const image = (props) => { const e = oid(), i = oid(); return { top: e, objects: [object(e, 0x6000d, [[P.contentChildren, [i]]]), object(i, 0x60011, props)] }; };
  const printout = image([[P.imageName, u16s("Setty Letter_1.pdf")], [P.width, f32(17)], [P.height, f32(22)], [P.text16, u16s("Re: Notice of Delay")]]);
  const logo = image([[P.imageName, u16s("image001.png")], [P.width, f32(0.4)], [P.height, f32(0.4)]]);
  const scan = image([[P.imageName, u16s("scan.png")], [P.width, f32(17)], [P.height, f32(22)]]);
  const fileOe = oid(), file = oid();
  const attached = { top: fileOe, objects: [object(fileOe, 0x6000d, [[P.contentChildren, [file]]]), object(file, 0x60035, [[P.fileName, u16s("A2160040-5 SETTY RESPONSE.pdf")]])] };
  const page1 = pageCell(space1, { title: "June 13 2023: Notice of Delay", created: "2024-04-03T19:33:04Z",
    body: [p1, p2, { top: parent.top, objects: [...parent.objects, ...nested.objects] }, tableBlock, printout, logo, scan, attached],
    history: "an old version of this page" });

  // Page 2: a subpage whose newest revision replaces one paragraph of the base revision.
  const kept = para("kept from the base revision", false), changed = para("before the edit", false);
  const edit = object(changed.objects[1].id, 0x6000e, [[P.text8, ascii("after the edit")]]);
  const page2 = pageCell(space2, { title: "RE: Amendment 4", created: "2024-12-04T16:21:44Z", level: 2, body: [kept, changed], extraRevision: [edit] });

  // The section root: section -> page series -> the two page cells.
  const section = oid(), series = oid(), sectionMeta = oid();
  const root = cell(DEFAULT_CTX, rootSpace, [{ roots: [[1, section], [2, sectionMeta]], objects: [
    object(section, 0x60007, [[P.elementChildren, [series]]]),
    object(series, 0x60008, [[P.childSpaces, [space1, space2]]]),
    object(sectionMeta, 0x20031, []),
  ] }]);

  const blob = blobBytes ? dataElement(de(), 10, so(0x02, false, cat(cu64(blobBytes), new Uint8Array(blobBytes).fill(0x5a)))) : [];
  const storageIndex = dataElement(de(), 1, cat(root.index, page1.index, page2.index));
  const storageManifest = dataElement(de(), 2, cat(
    so(0x0c, false, guid(1)),
    so(0x07, false, cat(ex(guid(2), 1), DEFAULT_CTX, headerSpace)),
    so(0x07, false, cat(ex(guid(2), 2), DEFAULT_CTX, rootSpace)),
  ));
  return cat(
    fileType ?? fromHex("e4525c7b8cd8a74daeb15378d02996d3"), new Uint8Array(32),
    fileFormat ?? fromHex("2fe98d63d4a6c14b9a36b3fc2511a5b7"),
    le(0, 4),
    so(0x7a, true, cat(ex(guid(3), 1), guid(4))),
    so(0x15, true, Uint8Array.of(0)),
    page1.parts, blob, storageManifest, page2.parts, blob, root.parts, storageIndex,
    end8(0x15), end16(0x7a),
  );
}

const reader = (bytes, log) => async (a, b) => { if (log) log.push([a, b]); return bytes.slice(a, b); };
const read = (bytes, log) => readOneNoteSection(bytes.length, reader(bytes, log));

// ── The section ─────────────────────────────────────────────────────────────
test("pages come out in notebook order with title, creation time and level", async () => {
  const s = await read(buildSection());
  assert.deepEqual(s.pages.map((p) => [p.title, p.created, p.level]), [
    ["June 13 2023: Notice of Delay", "2024-04-03T19:33:04Z", 1],
    ["RE: Amendment 4", "2024-12-04T16:21:44Z", 2],
  ]);
  assert.deepEqual(s.warnings, []);
});

test("page text: title first, paragraphs in order, links reduced to their visible text", async () => {
  const lines = (await read(buildSection())).pages[0].text.split("\n");
  assert.equal(lines[0], "June 13 2023: Notice of Delay");
  assert.equal(lines[1], "Dear Mr. Lefkovitz — see the letter");
  assert.equal(lines[2], "second line");                 // U+000B is a line break inside a paragraph
  assert.equal(lines[3], "Fee is £500 café");  // single-byte text decoded as Windows Western
  assert.deepEqual(lines.slice(4, 6), ["parent point", "nested point"]);
});

test("a table row is one line, cells separated by ' | '", async () => {
  assert.match((await read(buildSection())).pages[0].text, /^Subject \| Notice of Backcharge$/m);
});

test("pictures: recognised text is kept and labelled, a logo is dropped, an unread scan is counted", async () => {
  const p = (await read(buildSection())).pages[0];
  assert.match(p.text, /^\[text in image: Setty Letter_1\.pdf\] Re: Notice of Delay$/m);
  assert.match(p.text, /^\[image: scan\.png, not read\]$/m);
  assert.doesNotMatch(p.text, /image001\.png/);
  assert.equal(p.images, 3);
  assert.equal(p.imagesWithoutText, 1);
});

test("an attached file is named", async () => {
  const p = (await read(buildSection())).pages[0];
  assert.deepEqual(p.attachments, ["A2160040-5 SETTY RESPONSE.pdf"]);
  assert.match(p.text, /^\[attached file: A2160040-5 SETTY RESPONSE\.pdf\]$/m);
});

test("the newest revision wins over the revision it is based on", async () => {
  const t = (await read(buildSection())).pages[1].text;
  assert.match(t, /kept from the base revision/);
  assert.match(t, /after the edit/);
  assert.doesNotMatch(t, /before the edit/);
});

test("version history is not read as page content", async () => {
  const s = await read(buildSection());
  assert.doesNotMatch(s.pages.map((p) => p.text).join("\n"), /old version/);
});

test("pictures and printouts are jumped over, not downloaded", async () => {
  const bytes = buildSection({ blobBytes: 3 * 1024 * 1024 });
  const log = [];
  const s = await read(bytes, log);
  assert.equal(s.pages.length, 2);
  assert.match(s.pages[1].text, /after the edit/);
  assert.ok(bytes.length > 6 * 1024 * 1024);
  assert.ok(s.bytesFetched < 1024 * 1024, `fetched ${s.bytesFetched} of ${bytes.length}`);
  assert.equal(s.requests, log.length);
});

test("the same text comes out whether or not the section holds large files", async () => {
  const a = await read(buildSection()), b = await read(buildSection({ blobBytes: 200000 }));
  assert.deepEqual(a.pages, b.pages);
});

test("a short range read is an error, not a silently truncated section", async () => {
  const bytes = buildSection();
  await assert.rejects(readOneNoteSection(bytes.length, async (a, b) => bytes.slice(a, Math.min(b, a + 10))), /returned 10 bytes/);
});

test("a file cut off in the middle is an error", async () => {
  const bytes = buildSection().slice(0, 900);
  await assert.rejects(read(bytes), /OneNote section/);
});

test("files that are not a packaged section say what they are", async () => {
  await assert.rejects(read(buildSection({ fileType: fromHex("a12fff43d9ef764c9ee210ea5722765f") })), /table of contents/);
  await assert.rejects(read(buildSection({ fileFormat: fromHex("3fdd9a101b91f549a5d01791edc8aed8") })), /desktop \(revision store\) layout/);
  await assert.rejects(read(new Uint8Array(200)), /Not a OneNote section/);
});

// ── What read_document returns ──────────────────────────────────────────────
const fake = (n, chars = 100) => ({
  pages: Array.from({ length: n }, (_, i) => ({ title: "Page " + (i + 1), created: "2024-04-03T19:00:00Z", level: 1, text: ("body" + (i + 1) + " ").padEnd(chars, "x"), images: 0, imagesWithoutText: 0, attachments: [] })),
  warnings: [], bytesFetched: 0, requests: 0,
});

test("with no selection: the index of every page, and text from page 1 until the answer is full", () => {
  const r = oneNoteReadResult(fake(10, 1000), { maxChars: 3500 });
  assert.equal(r.totalPages, 10);
  assert.equal(r.pageIndex.length, 10);
  assert.equal(r.returnedPages, "1-3");
  assert.equal(r.nextPages, "4-10");
  assert.match(r.note, /pages:'4-10'/);
  assert.match(r.text, /^===== Page 1 of 10: Page 1 \(created 2024-04-03\) =====\nbody1 /);
});

test("pages:'…' returns those pages; find returns the pages that contain the term", () => {
  const s = fake(6);
  s.pages[3].text = "the Notice of Backcharge letter";
  s.pages[4].title = "Backcharge response";
  assert.equal(oneNoteReadResult(s, { pages: "2,5-6", maxChars: 50000 }).returnedPages, "2,5-6");
  const f = oneNoteReadResult(s, { find: "backcharge", maxChars: 50000 });
  assert.equal(f.matchingPages, "4-5");
  assert.equal(f.returnedPages, "4-5");
  assert.match(oneNoteReadResult(s, { find: "hydrogen", maxChars: 50000 }).note, /No page's title or text contains "hydrogen"/);
  assert.match(oneNoteReadResult(s, { pages: "40", maxChars: 50000 }).note, /has 6 page/);
});

test("a single page longer than one answer is cut and says so", () => {
  const r = oneNoteReadResult(fake(2, 9000), { pages: "2", maxChars: 2000 });
  assert.equal(r.returnedPages, "2");
  assert.match(r.text, /\[page truncated\]$/);
  assert.match(r.note, /Page 2 is longer than one answer holds/);
});

test("unread pictures and recognised picture text are both called out", () => {
  const s = fake(2);
  s.pages[0].imagesWithoutText = 2;
  s.pages[1].text = "[text in image: Letter_1.pdf] Dear Sir";
  const r = oneNoteReadResult(s, { maxChars: 50000 });
  assert.equal(r.pageIndex[0].imagesNotRead, 2);
  assert.match(r.note, /2 picture\(s\) or printout sheet\(s\) hold no text/);
  assert.match(r.note, /check a figure, date or clause/);
});

test("page lists", () => {
  assert.deepEqual(parsePageList("3", 10), [3]);
  assert.deepEqual(parsePageList("2-4, 9, 8-12", 10), [2, 3, 4, 9, 8, 10]);
  assert.deepEqual(parsePageList("7-5", 10), [5, 6, 7]);
  assert.deepEqual(parsePageList("abc, 0, 11", 10), []);
  assert.equal(compactPageList([1, 2, 3, 7, 9, 10]), "1-3,7,9-10");
  assert.equal(compactPageList([]), "");
});

test("text cleaning", () => {
  assert.equal(cleanOneNoteText("a﷟HYPERLINK \"mailto:x@y.com\"x@y.com b"), "ax@y.com b");
  assert.equal(cleanOneNoteText("one\u000Btwo three  \n"), "one\ntwo three\n");
});

// read_document gates a SharePoint file on the project its top folder names. A
// notebook's project number is one level further down; without this a section
// of a project the caller cannot see would be readable by its item id.
test("a section file is traced to its notebook folder, and so to its project", () => {
  const f = oneNoteNotebookFolder("/drives/b!x/root:/Notebooks/SAPX216004.00%20%E2%80%94%20MTA%20149th%20and%20Tremont%20St%20CA");
  assert.equal(f, "SAPX216004.00 \u2014 MTA 149th and Tremont St CA");
  assert.equal(projectNumberOfFolder(f), "SAPX216004.00");
  assert.equal(oneNoteNotebookFolder("/drives/b!x/root:/Notebooks/SAPX256014.00 — PANYNJ EWR AirTrain CFD/Meetings"), "SAPX256014.00 — PANYNJ EWR AirTrain CFD");
  assert.equal(oneNoteNotebookFolder("/drives/b!x/root:/notebooks/Setty Term Contracts"), "Setty Term Contracts");
  assert.equal(projectNumberOfFolder("Setty Term Contracts"), null);
});
test("a file outside the Notebooks folder has no notebook folder", () => {
  assert.equal(oneNoteNotebookFolder("/drives/b!x/root:/SAPX256015.00 Tabler/Notebooks/x"), "");
  assert.equal(oneNoteNotebookFolder("/drives/b!x/root:/Notebooks"), "");
  assert.equal(oneNoteNotebookFolder("/drives/b!x/root:"), "");
  assert.equal(oneNoteNotebookFolder("/drives/b!x/root:/Notebooks/%E0%A4%A"), "%E0%A4%A");
  assert.equal(oneNoteNotebookFolder(""), "");
});
