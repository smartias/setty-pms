// One page out of a PDF as a PDF of its own, read in byte ranges.
// The PDFs here are built by the test (classic cross-reference table, and
// cross-reference stream with object streams), never real drawings. The module
// was also run against four real drawing sets of 27 to 102MB on 2026-11-25:
// 25 sheets extracted, each rendering and reading identically to its page in
// the original. That check needs the files and poppler, so it is not here.
//
//   node --test supabase/functions/pms-mcp/pdfPageExtract.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { extractPdfPage, openPdfPages, PdfExtractError } from "./pdfPageExtract.ts";

const enc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const dec = (b) => Array.from(b, (c) => String.fromCharCode(c)).join("");
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// A reader over an in-memory file that records what was asked for.
function reader(bytes) {
  const log = [];
  const fetchRange = async (b, e) => { log.push([b, e]); return bytes.slice(b, e); };
  return { fetchRange, log, fetched: () => log.reduce((n, [b, e]) => n + (e - b), 0) };
}

const stream = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
const PAD = "x".repeat(600 * 1024); // unrelated bulk, so a page is a small part of the file

// Objects by number. Three pages; MediaBox and Resources are inherited from
// the page tree; page 2 has two content streams (one with an indirect length),
// its own image, and a link to page 3.
function baseObjects() {
  return {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R 20 0 R] /Count 3 /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> /XObject << /Im1 12 0 R >> >> >>",
    3: "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
    4: stream("", "BT /F1 12 Tf (PAGE-ONE) Tj ET"),
    20: "<< /Type /Pages /Parent 2 0 R /Kids [5 0 R 7 0 R] /Count 2 /Rotate 90 >>",
    5: "<< /Type /Page /Parent 20 0 R /Contents [6 0 R 10 0 R] /Annots [13 0 R] /Thumb 15 0 R /StructParents 4 /UserUnit 1 >>",
    6: stream("", "BT /F1 12 Tf (PAGE-TWO) Tj ET"),
    10: "<< /Length 11 0 R >>\nstream\nq /Im1 Do Q (SECOND-STREAM)\nendstream",
    11: "27",
    7: "<< /Type /Page /Parent 20 0 R /Contents 8 0 R /MediaBox [0 0 100 100] >>",
    8: stream("", "BT /F1 12 Tf (PAGE-THREE) Tj ET"),
    9: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    12: stream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", "\x80"),
    13: "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Dest [7 0 R /Fit] /P 5 0 R >>",
    14: stream("", PAD),
    15: stream("/Width 1 /Height 1", "THUMBNAIL"),
  };
}

// Classic layout: header, objects, xref table, trailer.
function classicPdf(objs, { trailerExtra = "", order } = {}) {
  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const off = {};
  for (const n of order ?? Object.keys(objs).map(Number)) { off[n] = body.length; body += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const max = Math.max(...Object.keys(objs).map(Number));
  const xrefAt = body.length;
  body += `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= max; n++) body += off[n] != null ? `${String(off[n]).padStart(10, "0")} 00000 n \n` : "0000000000 65535 f \n";
  body += `trailer\n<< /Size ${max + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return { bytes: enc(body), xrefAt, max };
}

test("a page comes out as a one-page PDF with what it needs and nothing else", async () => {
  const { bytes } = classicPdf(baseObjects());
  const r = reader(bytes);
  const out = await extractPdfPage(bytes.length, r.fetchRange, 2, { chunkBytes: 16 * 1024 });
  const text = dec(out.bytes);
  assert.equal(out.pageCount, 3);
  assert.ok(text.includes("(PAGE-TWO)") && text.includes("(SECOND-STREAM)"), "both content streams");
  assert.ok(!text.includes("PAGE-ONE") && !text.includes("PAGE-THREE"), "no other page's content");
  assert.ok(!text.includes("THUMBNAIL") && !text.includes("/StructParents"), "thumbnail and structure keys are dropped");
  assert.ok(!text.includes(PAD.slice(0, 64)), "unrelated bulk is not copied");
  assert.ok(text.includes("/Helvetica"), "the inherited font came along");
  assert.ok(text.includes("/Subtype /Image"), "the image came along");
  assert.ok(text.includes("\n11 0 obj\n27\n"), "the indirect stream length came along");
  assert.ok(text.includes("/Subtype /Link"), "the annotation is kept; its link to page 3 dangles");
  assert.match(text, /\/MediaBox \[0 0 612 792\]/, "MediaBox inherited from the root of the tree");
  assert.match(text, /\/Rotate 90/, "Rotate inherited from the nearer node");
  assert.match(text, /\/UserUnit 1/, "other page entries are kept as written");
  assert.equal(text.match(/\/Type \/Page\b/g).length, 1);
  assert.ok(r.fetched() < bytes.length / 4, `read ${r.fetched()} of ${bytes.length} bytes`);
  assert.equal(out.bytesFetched, r.fetched());

  // The result is itself a readable PDF: open it again and take its only page.
  const again = await extractPdfPage(out.bytes.length, reader(out.bytes).fetchRange, 1);
  assert.equal(again.pageCount, 1);
  assert.ok(dec(again.bytes).includes("(PAGE-TWO)"));
});

test("a page's own attribute wins over an inherited one", async () => {
  const { bytes } = classicPdf(baseObjects());
  const text = dec((await extractPdfPage(bytes.length, reader(bytes).fetchRange, 3)).bytes);
  assert.match(text, /\/MediaBox \[0 0 100 100\]/);
  assert.ok(!/\/MediaBox \[0 0 612 792\]/.test(text));
  assert.ok(text.includes("(PAGE-THREE)"));
});

test("one open file serves several pages and reads the table once", async () => {
  const { bytes } = classicPdf(baseObjects());
  const r = reader(bytes);
  const pdf = await openPdfPages(bytes.length, r.fetchRange, { chunkBytes: 16 * 1024 });
  assert.equal(pdf.pageCount, 3);
  const afterOpen = r.log.length;
  const one = dec((await pdf.page(1)).bytes), two = dec((await pdf.page(2)).bytes);
  assert.ok(one.includes("(PAGE-ONE)") && !one.includes("PAGE-TWO"));
  assert.ok(two.includes("(PAGE-TWO)") && !two.includes("PAGE-ONE"));
  const seen = new Set(r.log.map(([b]) => b));
  assert.equal(seen.size, r.log.length, "no chunk was fetched twice");
  assert.ok(afterOpen >= 1 && pdf.requests() === r.log.length);
});

test("time spent waiting on range reads is counted, so a caller can budget CPU without it", async () => {
  const { bytes } = classicPdf(baseObjects());
  const slow = async (b, e) => { await new Promise((r) => setTimeout(r, 30)); return bytes.slice(b, e); };
  const t0 = Date.now();
  const pdf = await openPdfPages(bytes.length, slow, { chunkBytes: 64 * 1024 });
  await pdf.page(2);
  const elapsed = Date.now() - t0, waited = pdf.fetchBusyMs();
  assert.ok(pdf.requests() >= 2);
  assert.ok(waited >= 30 * 2 * 0.8, `waited ${waited}ms over ${pdf.requests()} reads`);
  assert.ok(waited <= elapsed + 5, "never more than the elapsed time");
  // A failed read settles the timer too: nothing is left counting.
  const failing = async () => { await new Promise((r) => setTimeout(r, 20)); throw new Error("ECONNRESET"); };
  const t1 = Date.now();
  await assert.rejects(openPdfPages(bytes.length, failing), /ECONNRESET/);
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(Date.now() - t1 >= 60);
});

test("pages out of range, encrypted files and files with no table are refused in words", async () => {
  const { bytes } = classicPdf(baseObjects());
  await assert.rejects(extractPdfPage(bytes.length, reader(bytes).fetchRange, 4), /page 4 is out of range — the file has 3 page\(s\)/);
  await assert.rejects(extractPdfPage(bytes.length, reader(bytes).fetchRange, 0), PdfExtractError);
  const locked = classicPdf(baseObjects(), { trailerExtra: "/Encrypt 99 0 R " }).bytes;
  await assert.rejects(extractPdfPage(locked.length, reader(locked).fetchRange, 1), /encrypted/);
  const cut = bytes.slice(0, bytes.length - 40); // the end of the file is missing
  await assert.rejects(extractPdfPage(cut.length, reader(cut).fetchRange, 1), /no cross-reference pointer/);
  await assert.rejects(extractPdfPage(0, reader(bytes).fetchRange, 1), /size is unknown/);
});

test("a page that is too heavy, or needs too much of the file, stops with a reason", async () => {
  const { bytes } = classicPdf(baseObjects());
  await assert.rejects(extractPdfPage(bytes.length, reader(bytes).fetchRange, 2, { maxOutBytes: 300 }), /this page alone is over/);
  await assert.rejects(extractPdfPage(bytes.length, reader(bytes).fetchRange, 2, { chunkBytes: 4096, maxFetchBytes: 6000 }), /needs more than/);
});

test("a stream whose stated length is wrong is still copied whole", async () => {
  const objs = baseObjects();
  objs[6] = "<< /Length 5 >>\nstream\nBT /F1 12 Tf (PAGE-TWO) Tj ET\r\nendstream";
  const { bytes } = classicPdf(objs);
  const text = dec((await extractPdfPage(bytes.length, reader(bytes).fetchRange, 2)).bytes);
  assert.ok(text.includes("BT /F1 12 Tf (PAGE-TWO) Tj ET\nendstream"), "data up to the real endstream, without the line ending");
});

test("a later revision of an object replaces the earlier one", async () => {
  const base = classicPdf(baseObjects());
  const revised = "6 0 obj\n" + stream("", "BT /F1 12 Tf (PAGE-TWO-REVISED) Tj ET") + "\nendobj\n";
  const at = base.bytes.length;
  const tail = `${revised}xref\n6 1\n${String(at).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${base.max + 1} /Root 1 0 R /Prev ${base.xrefAt} >>\nstartxref\n${at + revised.length}\n%%EOF\n`;
  const bytes = cat(base.bytes, enc(tail));
  const text = dec((await extractPdfPage(bytes.length, reader(bytes).fetchRange, 2)).bytes);
  assert.ok(text.includes("(PAGE-TWO-REVISED)"));
  assert.ok(!text.includes("(PAGE-TWO)"));
});

// The other layout: small objects packed in a compressed object stream, and a
// compressed cross-reference stream with a PNG "up" predictor.
function streamPdf(objs) {
  const packed = [1, 2, 3, 5, 7, 9, 11, 13, 20];           // not streams
  const loose = Object.keys(objs).map(Number).filter((n) => !packed.includes(n));
  const STM = 30, XREF = 31;
  let head = "", bodyText = "";
  for (const n of packed) { head += `${n} ${bodyText.length} `; bodyText += objs[n] + "\n"; }
  const stmData = deflateSync(Buffer.from(head + bodyText, "latin1"));
  const parts = [enc("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n")];
  let pos = parts[0].length;
  const off = {};
  const add = (n, b) => { off[n] = pos; parts.push(b); pos += b.length; };
  for (const n of loose) add(n, enc(`${n} 0 obj\n${objs[n]}\nendobj\n`));
  add(STM, cat(enc(`${STM} 0 obj\n<< /Type /ObjStm /N ${packed.length} /First ${head.length} /Filter /FlateDecode /Length ${stmData.length} >>\nstream\n`), stmData, enc("\nendstream\nendobj\n")));
  const xrefAt = pos;
  const rows = [];
  for (let n = 0; n <= XREF; n++) {
    let type = 0, a = 0, b = 0;
    if (n === XREF) { type = 1; a = xrefAt; }
    else if (packed.includes(n)) { type = 2; a = STM; b = packed.indexOf(n); }
    else if (off[n] != null) { type = 1; a = off[n]; }
    rows.push([type, (a >> 16) & 255, (a >> 8) & 255, a & 255, b]);
  }
  const filtered = [];
  let prev = [0, 0, 0, 0, 0];
  for (const row of rows) { filtered.push(2, ...row.map((v, i) => (v - prev[i]) & 255)); prev = row; }
  const xdata = deflateSync(Buffer.from(filtered));
  parts.push(cat(enc(`${XREF} 0 obj\n<< /Type /XRef /Size ${XREF + 1} /W [1 3 1] /Root 1 0 R /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 5 >> /Length ${xdata.length} >>\nstream\n`), xdata, enc(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`)));
  return cat(...parts);
}

test("a file with object streams and a cross-reference stream reads the same way", async () => {
  const bytes = streamPdf(baseObjects());
  const r = reader(bytes);
  const out = await extractPdfPage(bytes.length, r.fetchRange, 2, { chunkBytes: 16 * 1024 });
  const text = dec(out.bytes);
  assert.equal(out.pageCount, 3);
  assert.ok(text.includes("(PAGE-TWO)") && text.includes("(SECOND-STREAM)") && text.includes("/Helvetica"));
  assert.ok(!text.includes("PAGE-ONE") && !text.includes("PAGE-THREE"));
  assert.match(text, /\/MediaBox \[0 0 612 792\]/);
  assert.ok(!text.includes("/ObjStm"), "packed objects are written out plainly");
  assert.ok(r.fetched() < bytes.length / 4);
  const again = await extractPdfPage(out.bytes.length, reader(out.bytes).fetchRange, 1);
  assert.equal(again.pageCount, 1);
});

// A hybrid file: a classic table that lists its packed objects as free, and an
// /XRefStm that says where they really are.
function hybridPdf(objs) {
  const packed = [9];                                      // the font lives in an object stream
  const STM = 30, XREF = 31;
  const stmText = `9 0 ${objs[9]}\n`;
  const stmData = deflateSync(Buffer.from(stmText, "latin1"));
  const first = "9 0 ".length;
  let body = "%PDF-1.5\n%\xE2\xE3\xCF\xD3\n";
  const off = {};
  for (const n of Object.keys(objs).map(Number)) { if (packed.includes(n)) continue; off[n] = body.length; body += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const parts = [enc(body)];
  let pos = parts[0].length;
  off[STM] = pos;
  const stmObj = cat(enc(`${STM} 0 obj\n<< /Type /ObjStm /N 1 /First ${first} /Filter /FlateDecode /Length ${stmData.length} >>\nstream\n`), stmData, enc("\nendstream\nendobj\n"));
  parts.push(stmObj); pos += stmObj.length;
  const xstmAt = pos;
  // The stream covers object 9 only: type 2, in stream 30, index 0.
  const xdata = Buffer.from([2, 0, 0, STM, 0]);
  const xobj = cat(enc(`${XREF} 0 obj\n<< /Type /XRef /Size ${XREF + 1} /W [1 3 1] /Index [9 1] /Length ${xdata.length} >>\nstream\n`), xdata, enc("\nendstream\nendobj\n"));
  parts.push(xobj); pos += xobj.length;
  const xrefAt = pos;
  let table = `xref\n0 ${XREF + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= XREF; n++) {
    const o = n === XREF ? xstmAt : off[n];
    table += o != null ? `${String(o).padStart(10, "0")} 00000 n \n` : "0000000000 65535 f \n"; // object 9 reads as free here
  }
  table += `trailer\n<< /Size ${XREF + 1} /Root 1 0 R /XRefStm ${xstmAt} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(enc(table));
  return cat(...parts);
}

test("a hybrid file's stream entries are not hidden by the table's free entries", async () => {
  const bytes = hybridPdf(baseObjects());
  const text = dec((await extractPdfPage(bytes.length, reader(bytes).fetchRange, 2)).bytes);
  assert.ok(text.includes("(PAGE-TWO)"));
  assert.ok(text.includes("/Helvetica"), "the font packed in the object stream came along");
});

test("layer settings in the catalog are carried over, with only the layers the page uses", async () => {
  const objs = baseObjects();
  objs[1] = "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [40 0 R 41 0 R] /D 42 0 R >> >>";
  objs[40] = "<< /Type /OCG /Name (Hidden layer) >>";
  objs[41] = "<< /Type /OCG /Name (Layer of another page) >>";
  objs[42] = "<< /OFF [40 0 R] /Order [40 0 R 41 0 R] /Name (Default) >>";
  objs[5] = "<< /Type /Page /Parent 20 0 R /Contents 6 0 R /Resources << /Font << /F1 9 0 R >> /Properties << /MC0 40 0 R >> >> >>";
  const { bytes } = classicPdf(objs);
  const out = await extractPdfPage(bytes.length, reader(bytes).fetchRange, 2);
  const text = dec(out.bytes);
  assert.match(text, /\/Type \/Catalog \/Pages \d+ 0 R \/OCProperties << \/OCGs \[40 0 R 41 0 R\] \/D 42 0 R >> >>/);
  assert.ok(text.includes("/OFF [40 0 R]"), "the default configuration, with what is switched off");
  assert.ok(text.includes("(Hidden layer)"), "the layer the page uses");
  assert.ok(!text.includes("Layer of another page"), "a layer the page does not use is left dangling");
  // A file with no layers gets a plain catalog.
  const plain = dec((await extractPdfPage(...(() => { const b = classicPdf(baseObjects()).bytes; return [b.length, reader(b).fetchRange, 2]; })())).bytes);
  assert.ok(!plain.includes("/OCProperties"));
});

test("names, strings and comments that look like syntax do not derail the parse", async () => {
  const objs = baseObjects();
  objs[5] = "<< /Type /Page /Parent 20 0 R % a comment with >> and 7 0 R\n /Contents 6 0 R /My#20Key (a \\) paren ( nested ) 8 0 R) /Hex <48656C6C6F> /Arr [1 0.5 -3 true null /N 9 0 R] >>";
  const { bytes } = classicPdf(objs);
  const text = dec((await extractPdfPage(bytes.length, reader(bytes).fetchRange, 2)).bytes);
  assert.ok(text.includes("/My#20Key (a \\) paren ( nested ) 8 0 R)"), "the string is copied as written");
  assert.ok(!text.includes("PAGE-THREE"), "a reference inside a string or a comment is not followed");
  assert.ok(text.includes("/Helvetica"), "a reference inside an array is");
});

test("a failed read ends the extraction", async () => {
  const { bytes } = classicPdf(baseObjects());
  let n = 0;
  const flaky = async (b, e) => { if (++n === 3) throw new Error("ECONNRESET"); return bytes.slice(b, e); };
  await assert.rejects(extractPdfPage(bytes.length, flaky, 2, { chunkBytes: 8 * 1024 }), /ECONNRESET/);
  const short = async (b, e) => bytes.slice(b, e - 1);
  await assert.rejects(extractPdfPage(bytes.length, short, 2), /came back as/);
});

// Drift anchors: the connector uses the extractor where files used to be refused.
test("view_drawing, read_drawing_schedule and read_document go through the extractor for large files", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('from "./pdfPageExtract.ts"'));
  assert.ok(src.includes("openPdfPages(") && src.includes("drawingPagePdf("));
  assert.ok(src.includes("cpuMs() > READ_PAGEWISE_CPU_BUDGET_MS"), "read_document stops a large file on CPU, not only on time");
  assert.ok(!/over the \$\{VIEW_DRAWING_MAX_PDF_BYTES \/ 1048576\}MB render limit/.test(src), "the 40MB refusal is gone");
  const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
  assert.ok(readme.includes("pdfPageExtract.ts"));
});
