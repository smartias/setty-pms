// Reading a PDF in byte ranges: the retry, timeout and failure plumbing.
// (The pdf.js side was measured on real 47MB and 124MB drawing sets; that test
// needs the files and unpdf installed, so it is not in this suite.)
//
//   node --test supabase/functions/pms-mcp/pdfRanged.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { retryingRange, httpRange, openRangedPdf } from "./pdfRanged.ts";

const bytes = (n) => new Uint8Array(n);

test("a range that fails once is retried and succeeds", async () => {
  let calls = 0;
  const f = retryingRange(async (a, b) => { if (++calls === 1) throw new Error("ECONNRESET"); return bytes(b - a); }, { backoffMs: 1 });
  assert.equal((await f(0, 100)).byteLength, 100);
  assert.equal(calls, 2);
});

test("a short read is an error, not a truncated chunk", async () => {
  const f = retryingRange(async () => bytes(10), { retries: 1, backoffMs: 1 });
  await assert.rejects(f(0, 100), /returned 10 bytes, expected 100/);
});

test("a range that never answers times out instead of hanging", async () => {
  let aborted = 0;
  const f = retryingRange((a, b, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => { aborted++; rej(signal.reason); })), { retries: 1, timeoutMs: 20, backoffMs: 1 });
  await assert.rejects(f(0, 5), /timed out after 20ms/);
  assert.equal(aborted, 2);
});

test("httpRange asks for the inclusive byte range and insists on 206", async () => {
  let seen;
  const ok = async (url, init) => { seen = init.headers.Range; return new Response(bytes(4), { status: 206 }); };
  assert.equal((await httpRange("https://x/f.pdf", 8, 12, new AbortController().signal, {}, ok)).byteLength, 4);
  assert.equal(seen, "bytes=8-11");
  const whole = async () => new Response(bytes(4), { status: 200 });
  await assert.rejects(httpRange("https://x/f.pdf", 0, 4, new AbortController().signal, {}, whole), /ignored the Range header/);
  const gone = async () => new Response("", { status: 404 });
  await assert.rejects(httpRange("https://x/f.pdf", 0, 4, new AbortController().signal, {}, gone), /HTTP 404/);
});

// A stand-in for pdf.js: it asks the transport for a range when opened and
// resolves once the chunk arrives, which is the behaviour that used to hang.
function fakePdfjs(log) {
  class PDFDataRangeTransport { constructor(length) { this.length = length; } onDataRange(begin, chunk) { this._got?.(begin, chunk); } }
  return {
    PDFDataRangeTransport,
    getDocument({ range, length }) {
      let destroyed = false;
      const promise = new Promise((res) => {
        range._got = (begin, chunk) => { log.push([begin, chunk.byteLength]); res({ numPages: 3 }); };
        range.requestDataRange(length - 10, length + 50); // past the end, as pdf.js does for the trailer
      });
      return { promise, destroy: async () => { destroyed = true; log.push("destroyed"); }, get destroyed() { return destroyed; } };
    },
  };
}

test("the document opens from ranges, clamps to the file size and counts bytes", async () => {
  const log = [];
  const r = await openRangedPdf(fakePdfjs(log), 1000, async (a, b) => bytes(b - a));
  assert.equal(r.pdf.numPages, 3);
  assert.deepEqual(log[0], [990, 10]);
  assert.equal(r.bytesFetched(), 10);
  assert.equal(r.requests(), 1);
  await r.destroy();
});

test("a range that cannot be fetched ends the read instead of hanging it", async () => {
  const log = [];
  await assert.rejects(openRangedPdf(fakePdfjs(log), 1000, async () => { throw new Error("could not read bytes"); }), /could not read bytes/);
  assert.ok(log.includes("destroyed"));
  await assert.rejects(openRangedPdf(fakePdfjs([]), 0, async () => bytes(1)), /size is unknown/);
});

test("the index uses ranged reading for files over the whole-download cap", () => {
  const here = new URL(".", import.meta.url);
  const src = readFileSync(new URL("index.ts", here), "utf8");
  assert.match(src, /from "\.\/pdfRanged\.ts"/);
  assert.match(src, /DRAWING_INDEX_RANGED_MAX_BYTES/);
  assert.match(src, /async function rangedPdfSource\(/);
  assert.match(readFileSync(new URL("azureFiles.ts", here), "utf8"), /export async function getFileRange\(/);
  assert.match(readFileSync(new URL("README.md", here), "utf8"), /pdfRanged\.ts/);
});
