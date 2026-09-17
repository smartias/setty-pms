// Tests for view_drawing's pure helpers in index.ts (Drawing Intelligence phase 4).
//
//   node supabase/functions/pms-mcp/viewDrawing.test.mjs
//
// The helpers are COPIED below (index.ts boots a server at import). Drift
// anchors at the bottom fail if the shipped source stops matching what these
// tests pin.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── copies from index.ts ────────────────────────────────────────────────────
const VIEW_DRAWING_TARGET_EDGE = 1600;
const VIEW_DRAWING_MAX_PIXELS = 24_000_000;
const VIEW_DRAWING_REGION_OVERLAP = 0.06;

const normSheetToken = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function sheetLoosePattern(s) {
  const chars = normSheetToken(s).split("");
  return chars.length ? "%" + chars.join("%") + "%" : "";
}

function drawingRegionBox(region) {
  const half = 0.5 + VIEW_DRAWING_REGION_OVERLAP;
  switch (region) {
    case "top-left": return { fx: 0, fy: 0, fw: half, fh: half };
    case "top-right": return { fx: 1 - half, fy: 0, fw: half, fh: half };
    case "bottom-left": return { fx: 0, fy: 1 - half, fw: half, fh: half };
    case "bottom-right": return { fx: 1 - half, fy: 1 - half, fw: half, fh: half };
    case "center": return { fx: 0.22, fy: 0.22, fw: 0.56, fh: 0.56 };
    default: return { fx: 0, fy: 0, fw: 1, fh: 1 };
  }
}

function drawingRenderScale(wPt, hPt, box) {
  const longEdgePt = Math.max(wPt * box.fw, hPt * box.fh);
  const target = longEdgePt > 0 ? VIEW_DRAWING_TARGET_EDGE / longEdgePt : 1;
  const cap = wPt * hPt > 0 ? Math.sqrt(VIEW_DRAWING_MAX_PIXELS / (wPt * hPt)) : 1;
  return Math.min(target, cap);
}

function dedupeRevs(revs) {
  const seen = new Set();
  return revs.filter((r) => { const k = `${r.revision ?? ""}|${r.set}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── normSheetToken / sheetLoosePattern ──────────────────────────────────────
// Sheet numbers arrive as E-211, E 2.11, E211, e-211 and must all be the
// same sheet; the loose pattern must catch every stored spelling.
assert.equal(normSheetToken("E-211"), "e211");
assert.equal(normSheetToken("E 2.11"), "e211");
assert.equal(normSheetToken("FP-102"), "fp102");
assert.equal(normSheetToken(null), "");
assert.equal(normSheetToken("M501.1"), "m5011");
assert.equal(sheetLoosePattern("E211"), "%e%2%1%1%");
assert.equal(sheetLoosePattern("--"), "");
// The pattern is deliberately loose (EP-211 also matches "%e%2%1%1%"); the
// client-side norm-equality re-check is what makes the final answer exact.
assert.equal(normSheetToken("EP-211") === normSheetToken("E211"), false);

// ── region boxes ────────────────────────────────────────────────────────────
assert.deepEqual(drawingRegionBox("full"), { fx: 0, fy: 0, fw: 1, fh: 1 });
assert.deepEqual(drawingRegionBox("top-left"), { fx: 0, fy: 0, fw: 0.56, fh: 0.56 });
const br = drawingRegionBox("bottom-right");
assert.ok(Math.abs(br.fx - 0.44) < 1e-9 && Math.abs(br.fy - 0.44) < 1e-9);
// Quadrants overlap: adjacent boxes share a 12%-wide strip so seam content
// appears in both.
const tl = drawingRegionBox("top-left"), tr = drawingRegionBox("top-right");
assert.ok(tl.fx + tl.fw > tr.fx);
assert.deepEqual(drawingRegionBox("center"), { fx: 0.22, fy: 0.22, fw: 0.56, fh: 0.56 });

// ── render scale ────────────────────────────────────────────────────────────
// 30x42 sheet = 2160x3024pt. Full sheet targets 1600px on the long edge.
const full = drawingRenderScale(2160, 3024, drawingRegionBox("full"));
assert.ok(Math.abs(full * 3024 - VIEW_DRAWING_TARGET_EDGE) < 1);
// A quadrant renders the page at ~1.8x the full-sheet scale: same target
// edge, but the region is 0.56 of the page.
const quad = drawingRenderScale(2160, 3024, drawingRegionBox("top-left"));
assert.ok(quad > full * 1.7 && quad < full * 1.9);
// The pixel cap wins over the target: the FULL page is rendered before the
// crop, so page pixels at the chosen scale never exceed the cap.
const capped = drawingRenderScale(10000, 14000, drawingRegionBox("top-left"));
assert.ok(10000 * 14000 * capped * capped <= VIEW_DRAWING_MAX_PIXELS + 1);
// Degenerate page sizes do not divide by zero.
assert.equal(drawingRenderScale(0, 0, drawingRegionBox("full")), 1);

// ── dedupeRevs ──────────────────────────────────────────────────────────────
const revs = dedupeRevs([
  { revision: "2", revisionDate: "04/17/26", revisionDescription: null, set: "2026-04-17_Bulletin #13" },
  { revision: "2", revisionDate: "04/17/26", revisionDescription: null, set: "2026-04-17_Bulletin #13" },
  { revision: null, revisionDate: null, revisionDescription: null, set: "2019-11-22_Final CD Submission" },
]);
assert.equal(revs.length, 2);

// ── PDF byte cache (copy of pdfCacheGet/pdfCachePut) ────────────────────────
// TTL bounds staleness; the byte-budget LRU evicts oldest-first; a hit is an
// LRU touch; an over-budget file is never cached at all.
const PDF_CACHE_TTL_MS = 5 * 60 * 1000;
const PDF_CACHE_MAX_BYTES = 48 * 1024 * 1024;
const pdfByteCache = new Map();
let _now = 1_000_000;
const now = () => _now;
function pdfCacheGet(key) {
  const hit = pdfByteCache.get(key);
  if (!hit) return null;
  if (now() - hit.at > PDF_CACHE_TTL_MS) { pdfByteCache.delete(key); return null; }
  pdfByteCache.delete(key); pdfByteCache.set(key, hit);
  return hit.bytes;
}
function pdfCachePut(key, bytes) {
  if (bytes.byteLength > PDF_CACHE_MAX_BYTES) return;
  pdfByteCache.delete(key);
  pdfByteCache.set(key, { bytes, at: now() });
  let total = 0;
  for (const v of pdfByteCache.values()) total += v.bytes.byteLength;
  for (const k of pdfByteCache.keys()) {
    if (total <= PDF_CACHE_MAX_BYTES) break;
    total -= pdfByteCache.get(k).bytes.byteLength;
    pdfByteCache.delete(k);
  }
}
const MB = 1024 * 1024;
const fake = (mb) => ({ byteLength: mb * MB });
pdfCachePut("a", fake(20));
pdfCachePut("b", fake(20));
assert.equal(pdfCacheGet("a")?.byteLength, 20 * MB);      // hit
assert.equal(pdfCacheGet("a")?.byteLength, 20 * MB);      // hit touches, not evicts
pdfCachePut("c", fake(20));                               // 60MB > 48MB: evict LRU = b
assert.equal(pdfCacheGet("b"), null);
assert.equal(pdfCacheGet("a")?.byteLength, 20 * MB);      // the touched entry survived
_now += PDF_CACHE_TTL_MS + 1;
assert.equal(pdfCacheGet("a"), null);                     // TTL expiry
pdfCachePut("big", fake(49));                             // over budget: never stored
assert.equal(pdfCacheGet("big"), null);
assert.ok(!pdfByteCache.has("big"));

// ── PDF text cache (copy of pdfPageTexts/pdfPageTextPut/pdfTextCacheDrop) ───
// Codex P2 on #259: file count alone doesn't bound extracted text — a find:
// scan can retain an 800-page manual's full text. The char budget evicts
// oldest files, and a single file that busts the budget alone is DETACHED:
// the in-flight call keeps its memo, the cache forgets it and stops counting.
const PDF_TEXT_CACHE_MAX_FILES = 8;
const PDF_TEXT_CACHE_MAX_CHARS = 6_000_000;
let pdfTextCacheChars = 0;
const pdfTextCache = new Map();
function pdfTextCacheDrop(key) {
  const v = pdfTextCache.get(key);
  if (!v) return;
  pdfTextCacheChars -= v.chars;
  v.chars = 0;
  v.detached = true;
  pdfTextCache.delete(key);
}
function pdfPageTexts(key) {
  const hit = pdfTextCache.get(key);
  if (hit && now() - hit.at <= PDF_CACHE_TTL_MS) {
    pdfTextCache.delete(key); pdfTextCache.set(key, hit);
    return hit;
  }
  pdfTextCacheDrop(key);
  const fresh = { at: now(), chars: 0, detached: false, pages: new Map() };
  pdfTextCache.set(key, fresh);
  while (pdfTextCache.size > PDF_TEXT_CACHE_MAX_FILES) {
    pdfTextCacheDrop(pdfTextCache.keys().next().value);
  }
  return fresh;
}
function pdfPageTextPut(entry, page, text) {
  if (entry.pages.has(page)) return;
  entry.pages.set(page, text);
  if (entry.detached) return;
  entry.chars += text.length;
  pdfTextCacheChars += text.length;
  while (pdfTextCacheChars > PDF_TEXT_CACHE_MAX_CHARS) {
    const oldestKey = pdfTextCache.keys().next().value;
    if (oldestKey === undefined) break;
    if (pdfTextCache.get(oldestKey) === entry) {
      pdfTextCacheChars -= entry.chars;
      entry.chars = 0;
      entry.detached = true;
      pdfTextCache.delete(oldestKey);
      break;
    }
    pdfTextCacheDrop(oldestKey);
  }
}
const page = (chars) => "x".repeat(chars);
// Two files fill most of the budget; a third pushes past it and evicts the oldest.
const tA = pdfPageTexts("specA");
pdfPageTextPut(tA, 1, page(2_500_000));
const tB = pdfPageTexts("specB");
pdfPageTextPut(tB, 1, page(2_500_000));
const tC = pdfPageTexts("specC");
pdfPageTextPut(tC, 1, page(2_500_000));                    // 7.5M > 6M: A evicted
assert.ok(!pdfTextCache.has("specA"));
assert.ok(tA.detached && tA.chars === 0);                  // A's in-flight memo detached
assert.equal(pdfTextCacheChars, 5_000_000);
assert.ok(pdfTextCache.has("specB") && pdfTextCache.has("specC"));
// A single file that alone busts the budget detaches itself but keeps serving.
pdfTextCacheDrop("specB"); pdfTextCacheDrop("specC");
const tHuge = pdfPageTexts("huge");
pdfPageTextPut(tHuge, 1, page(4_000_000));
pdfPageTextPut(tHuge, 2, page(4_000_000));                 // 8M alone: detach, not loop
assert.ok(tHuge.detached);
assert.ok(!pdfTextCache.has("huge"));
assert.equal(pdfTextCacheChars, 0);
assert.equal(tHuge.pages.size, 2);                         // the call still has its memo
pdfPageTextPut(tHuge, 3, page(1000));                      // detached puts stop counting
assert.equal(pdfTextCacheChars, 0);
// Same-page double put is idempotent on the counter.
const tD = pdfPageTexts("d");
pdfPageTextPut(tD, 1, page(100));
pdfPageTextPut(tD, 1, page(100));
assert.equal(pdfTextCacheChars, 100);
pdfTextCacheDrop("d");

// ── drift anchors: the shipped source still matches what these tests pin ────
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf8");
const denoJson = readFileSync(join(here, "deno.json"), "utf8");
for (const anchor of [
  'mcp.tool("view_drawing"',
  "const VIEW_DRAWING_TARGET_EDGE = 1600;",
  "const VIEW_DRAWING_MAX_PIXELS = 24_000_000;",
  "const VIEW_DRAWING_REGION_OVERLAP = 0.06;",
  // 1-based index pages meet 0-based PDFium here; off-by-one renders the
  // wrong sheet in a combined book.
  "doc.getPage(pageInFile - 1)",
  // PNG that would blow the response re-encodes as JPEG.
  "bytes = await img.encodeJPEG(80); mimeType = \"image/jpeg\";",
  // The exactness re-check behind the loose SQL pattern.
  "normSheetToken(r.sheet_no) === sheetNorm",
  // Azure-region gate runs in sheet mode (on the EFFECTIVE storage kind since
  // 1.19.1: a refused SharePoint site with drive shares reads as azure_files).
  "const st = await storageFor(project);\n    const onDrive = st.kind !== \"sharepoint\";",
  // b64FromBuffer accepts the encoder's Uint8Array directly.
  "function b64FromBuffer(buf: ArrayBuffer | Uint8Array): string",
  // Review-speed caches (2026-09-14): the download cache fronts fetchDrawingPdf
  // (view_drawing, read_drawing_schedule) and read_document, PDFium boots once
  // per isolate, and consumers hand pdf.js a COPY so the cached bytes survive
  // its buffer-ownership games.
  "function pdfCacheGet",
  "function pdfCachePut",
  "function pdfPageTexts",
  "function pdfPageTextPut",
  "function pdfTextCacheDrop",
  "const PDF_TEXT_CACHE_MAX_CHARS = 6_000_000;",
  // 1.16.0: the download cache now fronts loadPdfBytes, the one loader for
  // SharePoint and drive files alike.
  "if (useCache) { const c = pdfCacheGet(itemId); if (c) return c; }",
  "if (useCache) pdfCachePut(itemId, bytes);",
  "function pdfiumLibrary",
  "const library = await pdfiumLibrary();",
  "getDocumentProxy(bytes.slice())",
  "getDocumentProxy(pdfBytes.slice())",
] ) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}
// A failed PDFium init must not be memoized, and the render teardown must not
// destroy the shared library (that would kill every later render in the
// isolate).
assert.ok(src.includes("_pdfiumLib = null;"), "a failed PDFium init would be cached forever");
assert.ok(!src.includes("library.destroy"), "renderDrawingPage went back to destroying the shared PDFium library");
// 1.18.2: @hyzyla/pdfium page objects are single-use (render() closes the
// page), so the size is read without rendering and a page is rendered at most
// once; a re-render after the 1x probe must use a FRESH page object. The
// package is pinned because 2.1.11+ changed the size accessor and turned the
// probe-and-re-render path into the default, which failed every render.
for (const anchor of [
  "function drawingPageSize",
  "function renderDrawingPageOnce",
  "const PDFIUM_RUNTIME_FAILURE = ",
  "doc.getPage(pageInFile - 1).render({ scale: s, render: \"bitmap\" })",
  "const RENDER_PROBE_PDF_B64 = ",
  'c.req.query("probe") === "render"',
]) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}
assert.ok(!/rendered = await pg\.render\([^;]*;\s*const s = drawingRenderScale[^;]*;\s*if \([^)]*\) rendered = await pg\.render/.test(src),
  "renderDrawingPage renders twice on the same page object again (PDFium closes the page after render)");
for (const anchor of ['"@hyzyla/pdfium": "npm:@hyzyla/pdfium@2.1.9"', '"imagescript": "https://deno.land/x/imagescript@1.2.17/mod.ts"']) {
  assert.ok(denoJson.includes(anchor), `deno.json lost anchor: ${anchor}`);
}
const denoLock = readFileSync(join(here, "deno.lock"), "utf8");
assert.ok(denoLock.includes('"npm:@hyzyla/pdfium@2.1.9": "2.1.9"'), "deno.lock does not pin @hyzyla/pdfium");

// drawingPageSize copy: 2.1.9 (public getSize), 2.1.11+ (getOriginalSize,
// getSize private and throwing), and a page that answers neither.
function drawingPageSize(pg) {
  try {
    const o = pg?.getOriginalSize?.();
    const w = Number(o?.originalWidth ?? o?.width ?? 0), h = Number(o?.originalHeight ?? o?.height ?? 0);
    if (w > 0 && h > 0) return { wPt: w, hPt: h };
  } catch { /* not this build of the lib */ }
  try {
    const sz = pg?.getSize?.();
    const w = Number(sz?.width ?? 0), h = Number(sz?.height ?? 0);
    if (w > 0 && h > 0) return { wPt: w, hPt: h };
  } catch { /* 2.1.11+: getSize is private and throws without render options */ }
  return { wPt: 0, hPt: 0 };
}
assert.deepStrictEqual(drawingPageSize({ getSize: () => ({ width: 2160, height: 3024 }) }), { wPt: 2160, hPt: 3024 }, "2.1.9 page size");
assert.deepStrictEqual(drawingPageSize({ getOriginalSize: () => ({ originalWidth: 612, originalHeight: 792 }), getSize: () => { throw new Error("Cannot destructure property 'scale'"); } }), { wPt: 612, hPt: 792 }, "2.1.13 page size");
assert.deepStrictEqual(drawingPageSize({ getSize: () => { throw new Error("null function"); } }), { wPt: 0, hPt: 0 }, "unknown size falls back to the 1x probe");
assert.deepStrictEqual(drawingPageSize({}), { wPt: 0, hPt: 0 }, "no accessors at all");
const PDFIUM_RUNTIME_FAILURE = /null function|signature mismatch|memory access out of bounds|unreachable|RuntimeError|table index is out of bounds/i;
assert.ok(PDFIUM_RUNTIME_FAILURE.test("null function or function signature mismatch"), "prod wording triggers the retry");
assert.ok(PDFIUM_RUNTIME_FAILURE.test("RuntimeError: null function"), "local wording triggers the retry");
assert.ok(!PDFIUM_RUNTIME_FAILURE.test("page 3 is out of range — the file has 1 page(s)"), "an ordinary error does not rebuild the library");
// The copies above match the shipped implementations.
for (const fn of ["function sheetLoosePattern", "function drawingRegionBox", "function drawingRenderScale", "function dedupeRevs"]) {
  assert.ok(src.includes(fn), `index.ts lost helper: ${fn}`);
}

console.log("viewDrawing.test.mjs: all assertions passed");
