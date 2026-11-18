// OCR fallback for PDF pages that have no text layer.
//
// read_document and the drawing index read text layers only. A sheet saved as
// an image (a scan, or a "print to image" export) therefore came back empty,
// which is what happened to E-651.00 on the Homeport submittal review: the
// sheet could not be checked against spec 26 51 19 at all. A blank page is
// rendered (the same PDFium path view_drawing uses) and Claude transcribes it.
//
// Pure of any storage or network: the caller supplies `renderRegion` and
// `transcribe`, so the decisions here are unit-tested (ocrPages.test.mjs).

export const OCR_MIN_CHARS = 50;         // below this a page is treated as having no text layer
export const OCR_MAX_PAGES_PER_CALL = 6; // each page is 4 image tiles plus a model call
export const OCR_REGIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

export type OcrImage = { b64: string; mimeType: string };

export function needsOcr(text: string | null | undefined): boolean {
  return String(text ?? "").replace(/\s+/g, "").length < OCR_MIN_CHARS;
}

export const OCR_SYSTEM_PROMPT =
  "You transcribe one page of a construction drawing or specification that has no text layer. " +
  "You are given overlapping tiles of the page (top-left, top-right, bottom-left, bottom-right, in that order). " +
  "Output ONLY the text printed on the page: sheet number and title from the title block, general notes, " +
  "keynotes, schedules (one row per line, cells separated by ' | '), equipment tags, and any specification " +
  "section numbers cited. Tiles overlap, so do not repeat text that appears in two tiles. " +
  "Do not describe the drawing, do not interpret it, and do not invent text. " +
  "Mark anything illegible as [illegible]. If the page has no text at all, output [no text].";

// Render the tiles one at a time (memory: each is a full-page PDFium render)
// and transcribe them in one model call. "[no text]" comes back as "".
export async function ocrPage(
  renderRegion: (region: typeof OCR_REGIONS[number]) => Promise<OcrImage>,
  transcribe: (images: OcrImage[]) => Promise<string>,
): Promise<string> {
  const images: OcrImage[] = [];
  for (const r of OCR_REGIONS) images.push(await renderRegion(r));
  const out = (await transcribe(images)).trim();
  return out === "[no text]" ? "" : out;
}

// What read_document tells the caller about its OCR use.
export function ocrNote(ocrPages: number[], skippedBlank: number, failed: string | null): string | null {
  const parts: string[] = [];
  if (ocrPages.length) parts.push(`Page(s) ${ocrPages.join(", ")} had no text layer and were read by OCR (marked [OCR]). Verify values that matter against the sheet itself (view_drawing).`);
  if (skippedBlank) parts.push(`${skippedBlank} more page(s) have no text layer and were not OCR'd (limit ${OCR_MAX_PAGES_PER_CALL} per call): narrow with pages:"X-Y" to read them.`);
  if (failed) parts.push(`OCR was unavailable: ${failed}`);
  return parts.length ? parts.join(" ") : null;
}
