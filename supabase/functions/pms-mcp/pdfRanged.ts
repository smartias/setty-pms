// Reading a large PDF in pieces instead of downloading it whole.
//
// The drawing index used to skip any PDF over 20MB: the edge function fetched
// the whole file, and a 42MB book timed out. Architects' compiled sets are
// routinely 50 to 150MB, so the sheets the cross-discipline QA checks need
// most were the ones that never got indexed. pdf.js can open a PDF from byte
// ranges: it reads the cross-reference table, then only the objects each page
// needs. Measured on a real 124MB, 138-page architectural set (2026-11-16):
// opening cost 10MB and 0.1s, five pages 26MB and 0.7s, 40 pages 53MB and 9s.
// One sheet of a 47MB sprinkler set needed 33MB by itself, so the cost per
// page is not bounded and callers must budget by bytes and time, not pages.
//
// Two things the transport API does not give and this module adds:
//   - a failed range request must END the read. pdf.js waits forever for a
//     chunk that never arrives, so a dropped connection would hang the request
//     until the platform kills it. Each range is retried, timed out, and on
//     final failure the document is destroyed and `failed` rejects.
//   - a count of bytes fetched, so a caller can stop a window before memory
//     runs out (pdf.js keeps every chunk it has fetched).
// Pure of any storage: the caller supplies `fetchRange`. See its tests.

export type RangeFetch = (begin: number, endExclusive: number, signal: AbortSignal) => Promise<Uint8Array>;

export type RangedPdf = {
  pdf: any;                       // pdf.js PDFDocumentProxy
  failed: Promise<never>;         // rejects when a range could not be fetched; race page work against it
  bytesFetched: () => number;
  requests: () => number;
  destroy: () => Promise<void>;
};

export const RANGE_CHUNK_BYTES = 1024 * 1024;

// One range, with a per-attempt timeout and retries. A short read is an error:
// handing pdf.js a truncated chunk corrupts the parse instead of failing it.
export function retryingRange(
  fetchOnce: RangeFetch,
  opts: { retries?: number; timeoutMs?: number; backoffMs?: number } = {},
): (begin: number, endExclusive: number) => Promise<Uint8Array> {
  const retries = opts.retries ?? 2, timeoutMs = opts.timeoutMs ?? 15000, backoffMs = opts.backoffMs ?? 300;
  return async (begin, endExclusive) => {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new Error(`range ${begin}-${endExclusive} timed out after ${timeoutMs}ms`)), timeoutMs);
      try {
        const chunk = await fetchOnce(begin, endExclusive, ctl.signal);
        if (chunk.byteLength !== endExclusive - begin) {
          throw new Error(`range ${begin}-${endExclusive} returned ${chunk.byteLength} bytes, expected ${endExclusive - begin}`);
        }
        return chunk;
      } catch (e) {
        last = ctl.signal.aborted ? (ctl.signal.reason ?? e) : e;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < retries) await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
    }
    throw new Error(`could not read bytes ${begin}-${endExclusive}: ${String((last as any)?.message ?? last)}`);
  };
}

// An HTTP range GET against a URL that honours Range (a SharePoint download
// URL, an Azure Files SAS URL). 206 is required: a 200 means the server
// ignored the header and is sending the whole file.
export async function httpRange(
  url: string, begin: number, endExclusive: number, signal: AbortSignal,
  headers: Record<string, string> = {}, fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const res = await fetchImpl(url, { headers: { ...headers, Range: `bytes=${begin}-${endExclusive - 1}` }, signal });
  if (res.status !== 206) {
    try { await res.body?.cancel(); } catch { /* nothing to release */ }
    throw new Error(res.status === 200 ? "the server ignored the Range header" : `HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function openRangedPdf(
  pdfjs: any, size: number, fetchRange: (begin: number, endExclusive: number) => Promise<Uint8Array>,
  opts: { chunkBytes?: number } = {},
): Promise<RangedPdf> {
  if (!(size > 0)) throw new Error("the file's size is unknown, so it cannot be read in ranges");
  let bytes = 0, requests = 0, dead: Error | null = null;
  let rejectFailed!: (e: Error) => void;
  const failed = new Promise<never>((_, rej) => { rejectFailed = rej; });
  failed.catch(() => { /* observed by whoever races it; never an unhandled rejection */ });
  let task: any = null;
  const fail = (e: unknown) => {
    if (dead) return;
    dead = e instanceof Error ? e : new Error(String(e));
    rejectFailed(dead);
    try { task?.destroy(); } catch { /* already gone */ }
  };
  class Transport extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      if (dead) return;
      const stop = Math.min(end, size);
      requests++;
      fetchRange(begin, stop).then((chunk) => {
        if (dead) return;
        bytes += chunk.byteLength;
        (this as any).onDataRange(begin, chunk);
      }, fail);
    }
    abort() { /* nothing is streaming; ranges in flight finish or time out */ }
  }
  task = pdfjs.getDocument({
    range: new Transport(size, null), length: size, rangeChunkSize: opts.chunkBytes ?? RANGE_CHUNK_BYTES,
    disableAutoFetch: true, disableStream: true, isEvalSupported: false, useSystemFonts: true,
  });
  const pdf = await Promise.race([task.promise, failed]);
  return {
    pdf, failed, bytesFetched: () => bytes, requests: () => requests,
    destroy: async () => { dead = dead ?? new Error("closed"); try { await task.destroy(); } catch { /* already gone */ } },
  };
}
