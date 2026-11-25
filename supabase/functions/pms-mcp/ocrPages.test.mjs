// Tests for ocrPages.ts (OCR fallback for PDF pages with no text layer).
//
//   node --test supabase/functions/pms-mcp/ocrPages.test.mjs
//
// The module is plain TypeScript with erasable types only, so it is loaded by
// stripping types with a regex-free route: Node 22+ can import .ts directly
// with --experimental-strip-types; to stay runnable everywhere the source is
// transpiled here by removing the few annotations it uses.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "ocrPages.ts"), "utf8")
  .replace(/export type OcrImage = \{[^}]+\};\n/, "")
  .replace(/\(text: string \| null \| undefined\): boolean/, "(text)")
  .replace(/ as const;/, ";")
  .replace(/renderRegion: \(region: typeof OCR_REGIONS\[number\]\) => Promise<OcrImage>,/, "renderRegion,")
  .replace(/transcribe: \(images: OcrImage\[\]\) => Promise<string>,/, "transcribe,")
  .replace(/\): Promise<string> \{/, ") {")
  .replace(/const images: OcrImage\[\] = \[\];/, "const images = [];")
  .replace(/\(ocrPages: number\[\], skippedBlank: number, failed: string \| null\): string \| null/, "(ocrPages, skippedBlank, failed)")
  .replace(/const parts: string\[\] = \[\];/, "const parts = [];");
const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
const { needsOcr, ocrPage, ocrNote, OCR_REGIONS, OCR_MAX_PAGES_PER_CALL, OCR_SYSTEM_PROMPT } = mod;

test("needsOcr: blank and near-blank pages, not real text", () => {
  assert.equal(needsOcr(""), true);
  assert.equal(needsOcr(null), true);
  assert.equal(needsOcr("  E-651.00  \n "), true);
  assert.equal(needsOcr("PANELBOARD SCHEDULE NOTES: 1. PROVIDE SPD PER SPECIFICATION 26 51 19"), false);
});

test("ocrPage renders every tile in order, transcribes once, maps [no text] to empty", async () => {
  const seen = [];
  let calls = 0;
  const text = await ocrPage(
    async (r) => { seen.push(r); return { b64: r, mimeType: "image/png" }; },
    async (imgs) => { calls++; assert.deepEqual(imgs.map((i) => i.b64), OCR_REGIONS); return "  SHEET E-651.00  "; },
  );
  assert.deepEqual(seen, ["top-left", "top-right", "bottom-left", "bottom-right"]);
  assert.equal(calls, 1);
  assert.equal(text, "SHEET E-651.00");
  assert.equal(await ocrPage(async (r) => ({ b64: r, mimeType: "image/png" }), async () => "[no text]"), "");
});

test("ocrPage: a failed render or model call rejects instead of returning partial text", async () => {
  await assert.rejects(ocrPage(async () => { throw new Error("render boom"); }, async () => "x"), /render boom/);
  await assert.rejects(ocrPage(async (r) => ({ b64: r, mimeType: "image/png" }), async () => { throw new Error("model boom"); }), /model boom/);
});

test("ocrNote reports OCR'd pages, the per-call limit and an outage; null when nothing happened", () => {
  assert.equal(ocrNote([], 0, null), null);
  assert.match(ocrNote([3, 4], 0, null), /Page\(s\) 3, 4 .*OCR/);
  assert.match(ocrNote([], 2, null), new RegExp(`2 more page.*limit ${OCR_MAX_PAGES_PER_CALL}`));
  assert.match(ocrNote([], 1, "ANTHROPIC_API_KEY not configured"), /OCR was unavailable: ANTHROPIC_API_KEY/);
});

test("the prompt forbids invention", () => {
  assert.match(OCR_SYSTEM_PROMPT, /do not invent text/);
});

test("drift: index.ts wires the OCR fallback into read_document", () => {
  const idx = readFileSync(join(here, "index.ts"), "utf8");
  assert.match(idx, /from "\.\/ocrPages\.ts"/);
  assert.match(idx, /needsOcr\(t\)/);
  assert.match(idx, /ocrPdfPage\(pdfBytes!, i\)/);
  // BUILD names the deployed copy (buildLabel.ts); it is not a hand-written slug.
  assert.match(idx, /const BUILD = buildLabel\(/);
  assert.match(idx, /ocrPdfPage\(buf, i\)/);
});
