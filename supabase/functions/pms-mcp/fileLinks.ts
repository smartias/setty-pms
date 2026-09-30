// Signed, short-lived, single-file links for the connector's raw-bytes path
// (download_document / upload_document, 1.19.0).
//
// Why this exists: every MCP tool result is text on the way into the model, so
// an .xlsx read through read_document arrives as rows and its formulas,
// dropdowns and formatting are gone. Editing a workbook and handing back the
// same working file needs the ORIGINAL BYTES in and the edited bytes out. The
// model's sandbox (or the person's browser) can fetch a URL, so the tool mints
// a URL the connector itself serves: GET streams the file, PUT writes it back.
//
// The token IS the credential. No bearer travels with the fetch (the sandbox
// has no sign-in), so the token must be unforgeable, expire soon, and name
// exactly one file and one operation. It carries the minting caller, so the
// visibility gate re-runs AS THAT PERSON when the bytes are served. HMAC-SHA256
// over a base64url JSON payload; the key never leaves the Edge Function.
//
// Pure + WebCrypto only, so fileLinks.test.mjs exercises it under Node.

export type GetTokenPayload = {
  k: "get";
  id: string;            // list_project_documents item id (driveId|itemId or az:…)
  n: string;             // file name, for Content-Disposition
  by: string | null;     // minting caller's email (null = shared-secret lane)
  exp: number;           // unix seconds
};
export type PutTokenPayload = {
  k: "put";
  drive: string;         // Graph drive id
  parent: string;        // Graph folder item id the file lands in
  name: string;          // final file name
  item: string | null;   // existing item id when replacing in place (a new SharePoint version)
  by: string;            // minting caller's email — writes always have a person behind them
  exp: number;
  max: number;           // byte cap the PUT enforces
};
export type FileTokenPayload = GetTokenPayload | PutTokenPayload;

export const FILE_TOKEN_TTL_DEFAULT_MIN = 30;
export const FILE_TOKEN_TTL_MAX_MIN = 240;

export function clampTtlMinutes(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : FILE_TOKEN_TTL_DEFAULT_MIN;
  return Math.min(FILE_TOKEN_TTL_MAX_MIN, Math.max(5, n));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? enc.encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
export function b64urlDecode(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(norm), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// token = base64url(payload JSON) + "." + base64url(HMAC-SHA256(payload part))
export async function mintFileToken(payload: FileTokenPayload, secret: string): Promise<string> {
  if (!secret || secret.length < 16) throw new Error("file-link secret too short");
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return body + "." + b64urlEncode(sig);
}

// null on any defect: bad shape, bad signature, expired. Never throws for a
// malformed token — the route turns null into one 403.
export async function verifyFileToken(token: string, secret: string, nowSec: number = Date.now() / 1000): Promise<FileTokenPayload | null> {
  try {
    if (!secret || typeof token !== "string") return null;
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) return null;
    const body = token.slice(0, dot);
    const sig = b64urlDecode(token.slice(dot + 1));
    // subtle.verify is constant-time; never compare signature strings by hand.
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig as BufferSource, enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(body)));
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
    if (payload.k === "get") {
      if (typeof payload.id !== "string" || !payload.id || typeof payload.n !== "string") return null;
      return payload as GetTokenPayload;
    }
    if (payload.k === "put") {
      if (typeof payload.drive !== "string" || typeof payload.parent !== "string" || typeof payload.name !== "string" ||
        typeof payload.by !== "string" || !payload.by || typeof payload.max !== "number") return null;
      return payload as PutTokenPayload;
    }
    return null;
  } catch { return null; }
}

// Content types for the streamed download; the browser and the sandbox both
// key off this to save the file under the right kind.
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  csv: "text/csv", txt: "text/plain", md: "text/markdown", json: "application/json", xml: "application/xml",
  html: "text/html", htm: "text/html",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  zip: "application/zip", dwg: "application/acad", rvt: "application/octet-stream",
};
export function mimeFor(name: string): string {
  const ext = String(name || "").split(".").pop()?.toLowerCase() || "";
  return MIME[ext] || "application/octet-stream";
}

// RFC 6266 attachment header; the ASCII fallback keeps curl/-J and old
// clients happy, filename* carries the real (possibly non-ASCII) name.
export function contentDisposition(name: string): string {
  const safe = String(name || "file").replace(/[\r\n"\\]/g, "_");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

// What upload_document may write. Office documents and text formats — the
// things the model edits and hands back. Never executables, never drawings
// (the issued set is written only by the transmittal tool).
const WRITABLE_EXT = new Set(["xlsx", "xlsm", "docx", "pptx", "pdf", "csv", "txt", "md", "json", "xml", "html", "htm"]);
export function isWritableName(name: string): boolean {
  const n = String(name || "").trim();
  if (!n || n.length > 200) return false;
  if (/[\\/:*?"<>|#%]/.test(n) || n.startsWith(".") || n.startsWith("~$")) return false;
  const ext = n.split(".").pop()?.toLowerCase() || "";
  return n.includes(".") && WRITABLE_EXT.has(ext);
}

// Outgoing (issued sets) is off limits to every connector write. A Graph
// parentReference.path looks like "/drives/<id>/root:/<project>/<...>"; DC
// folders synced into SharePoint keep the "99-<number>_OUTGOING" spelling.
export function isOutgoingPath(path: string | null | undefined): boolean {
  const p = String(path || "");
  const rel = p.includes("root:") ? p.slice(p.indexOf("root:") + 5) : p;
  return rel.split("/").some((seg) => {
    let s = seg;
    try { s = decodeURIComponent(seg); } catch { /* keep raw */ }
    return /(^|[\s_\-.])outgoing([\s_\-.]|$)/i.test(s) || /^outgoing$/i.test(s.trim());
  });
}

// Graph large-file upload sessions want every chunk (but the last) to be a
// multiple of 320 KiB; 12 of them is comfortably under the 60 MiB ceiling.
export const UPLOAD_CHUNK_BYTES = 12 * 327_680;
export function chunkRanges(total: number, chunk: number = UPLOAD_CHUNK_BYTES): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < total; start += chunk) out.push({ start, end: Math.min(total, start + chunk) - 1 });
  return out;
}
