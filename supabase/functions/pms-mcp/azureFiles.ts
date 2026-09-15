// azureFiles.ts — storage seam, slice B (2026-09-14): the Azure Files
// browse-and-read provider behind every region's drive annex.
//
// The firm runs hybrid: office network drives are synced into Azure Files
// shares (Nikhil's mapping) while project records migrate into SharePoint
// region by region. A region's pms_region_shares rows carry a share_url
// (the share, optionally with a folder prefix) and sas_env, the NAME of
// the Edge Function secret holding a read-only SAS for it. This module turns
// that pair into two capabilities and nothing more:
//
//   list   — List Directories and Files (REST, XML) on a path under the share
//   read   — Get File Properties (HEAD) + Get File (GET) for one named file
//
// No search, no thumbnails, no library semantics: those stay SharePoint-only
// and the tools say so (AZURE_LIMITED_NOTE in index.ts).
//
// Everything here is pure or takes an injected fetch so azureFiles.test.mjs
// exercises the real code without a share. index.ts owns the region lookup,
// the secret read (Deno.env), caching, and the tool surfaces.
//
// Identity scheme: items on a share are addressed as `az:<TEAM>.<LABEL>:<rel/path>`
// so list_project_documents and read_document can tell them from the
// `driveId|itemId` composites SharePoint uses. TEAM names the region row,
// LABEL the share within it ('I', 'W', 'SAP' — a region may carry several
// drives, each with its own secret); the path is relative to the share
// prefix. An id without a label (`az:<TEAM>:<path>`, the 1.14.0 form) means
// the region's first share.

export type AzureShare = {
  account: string;   // storage account, e.g. filestoragesetty
  share: string;     // file share, e.g. newyorkstorage
  prefix: string;    // folder prefix inside the share, "" for the root, no leading/trailing slash
  base: string;      // https://<account>.file.core.windows.net/<share>
};

export type AzEntry = {
  name: string;
  type: "folder" | "file";
  size?: number;
  modified?: string;
};

export const AZ_ID_PREFIX = "az:";
const TEAM_RE = /^[A-Z][A-Z0-9]{1,5}$/;
const LABEL_RE = /^[A-Z0-9]{1,12}$/;
export function shareLabelClean(v: string | null | undefined): string {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}
// Service version the requests are pinned to. Anything from 2020-04-08 up
// returns timestamps in listings; 2023-11-03 is the newest widely documented.
export const AZ_API_VERSION = "2023-11-03";

// A share URL as the Admin console validates it:
//   https://<account>.file.core.windows.net/<share>[/prefix/path]
export function parseShareUrl(url: string | null | undefined): AzureShare | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.search || u.hash) return null;
  const m = /^([a-z0-9]+)\.file\.core\.windows\.net$/i.exec(u.hostname);
  if (!m) return null;
  const segs = u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  if (!segs.length) return null;
  const share = segs[0];
  const prefix = cleanRelPath(segs.slice(1).join("/"));
  if (prefix === null) return null;
  const account = m[1].toLowerCase();
  return { account, share, prefix, base: `https://${account}.file.core.windows.net/${encodeURIComponent(share)}` };
}

// Relative paths are user-controlled (they ride inside item ids). Keep them
// inside the share: no traversal, no backslashes, no control characters, no
// empty segments. Returns "" for the root, null when the path is not allowed.
export function cleanRelPath(p: string | null | undefined): string | null {
  const s = String(p ?? "").replace(/\\/g, "/").trim();
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f]/.test(s)) return null;
  const segs = s.split("/").filter((x) => x.length > 0);
  for (const seg of segs) {
    if (seg === "." || seg === ".." || seg.trim() !== seg) return null;
  }
  return segs.join("/");
}

export function joinRel(a: string, b: string): string {
  return [a, b].filter((x) => x && x.length).join("/");
}

export function encodeAzId(team: string, relPath: string, label?: string | null): string {
  const l = shareLabelClean(label);
  return AZ_ID_PREFIX + String(team).toUpperCase() + (l ? "." + l : "") + ":" + (relPath || "");
}

export function isAzId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(AZ_ID_PREFIX);
}

export function decodeAzId(id: string | null | undefined): { team: string; label: string | null; relPath: string } | null {
  if (!isAzId(id)) return null;
  const rest = String(id).slice(AZ_ID_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon < 0) return null;
  const head = rest.slice(0, colon).toUpperCase().trim();
  const dot = head.indexOf(".");
  const team = dot < 0 ? head : head.slice(0, dot);
  const label = dot < 0 ? null : head.slice(dot + 1);
  if (!TEAM_RE.test(team)) return null;
  if (label !== null && !LABEL_RE.test(label)) return null;
  const relPath = cleanRelPath(rest.slice(colon + 1));
  if (relPath === null) return null;
  return { team, label, relPath };
}

// The secret is whatever IT pasted: a bare query string, one with a leading
// "?", or (it happens) the whole share URL with the SAS attached. Reduce all
// three to the query string, or null when nothing usable is there.
export function normalizeSas(token: string | null | undefined): string | null {
  let t = String(token ?? "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    try { t = new URL(t).search; } catch { return null; }
  }
  t = t.replace(/^\?+/, "").trim();
  if (!t || !/(^|&)sig=/.test(t)) return null;
  return t;
}

// A URL on the share for one path, with the SAS and any request parameters.
// Segments are encoded one at a time so names with spaces, '#' or '%' survive.
export function azureUrl(share: AzureShare, relPath: string, sas: string, query?: Record<string, string>): string {
  const full = joinRel(share.prefix, relPath);
  const path = full ? "/" + full.split("/").map(encodeURIComponent).join("/") : "";
  const params = Object.entries(query || {}).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v));
  return share.base + path + "?" + [...params, sas].join("&");
}

// The share path without credentials, for people (it is what the mapped drive
// shows once the office prefix is stripped) — never a clickable URL.
export function sharePathOf(share: AzureShare, relPath: string): string {
  const full = joinRel(share.prefix, relPath);
  return `\\\\${share.account}.file.core.windows.net\\${share.share}` + (full ? "\\" + full.replace(/\//g, "\\") : "");
}

function xmlUnescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
}
function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? m[1] : null;
}
function nameOf(block: string): string | null {
  const m = /<Name(\s[^>]*)?>([\s\S]*?)<\/Name>/i.exec(block);
  if (!m) return null;
  const raw = xmlUnescape(m[2]);
  // Names holding characters XML cannot carry come back URL-encoded and flagged.
  if (/Encoded\s*=\s*"true"/i.test(m[1] || "")) { try { return decodeURIComponent(raw); } catch { return raw; } }
  return raw;
}

// List Directories and Files returns
//   <EnumerationResults><Entries><Directory>…</Directory><File>…</File></Entries><NextMarker/></EnumerationResults>
export function parseListXml(xml: string): { entries: AzEntry[]; nextMarker: string } {
  const entries: AzEntry[] = [];
  const body = tag(xml, "Entries") ?? "";
  const re = /<(Directory|File)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const kind = m[1].toLowerCase();
    const name = nameOf(m[2]);
    if (!name) continue;
    const props = tag(m[2], "Properties") ?? "";
    const len = tag(props, "Content-Length");
    const mod = tag(props, "Last-Modified");
    const e: AzEntry = { name, type: kind === "directory" ? "folder" : "file" };
    if (len !== null && len.trim() !== "" && !Number.isNaN(Number(len))) e.size = Number(len);
    if (mod) { const d = new Date(mod.trim()); e.modified = Number.isNaN(d.getTime()) ? mod.trim() : d.toISOString(); }
    entries.push(e);
  }
  const nextMarker = (tag(xml, "NextMarker") ?? "").trim();
  return { entries, nextMarker: xmlUnescape(nextMarker) };
}

// One honest sentence per failure class, in terms of what the person can fix.
export function describeAzureError(status: number, body: string): string {
  const code = (tag(body || "", "Code") ?? "").trim();
  if (status === 403 || /Authorization|Authentication/i.test(code)) {
    return `The share refused the read credential (HTTP ${status}${code ? " " + code : ""}): the SAS token is expired, lacks read+list permission, or the storage account's firewall does not allow the connector's traffic. IT needs to reissue the SAS or open the account.`;
  }
  if (status === 404 || /NotFound/i.test(code)) {
    return `Not found on the share (HTTP 404${code ? " " + code : ""}): the share, folder prefix, or path does not exist as spelled.`;
  }
  if (status === 400) {
    return `The share rejected the request (HTTP 400${code ? " " + code : ""}): the share URL or the SAS token is malformed. Check both in Admin → Regions and the Edge Function secret.`;
  }
  return `Azure Files returned HTTP ${status}${code ? " " + code : ""}.`;
}

export class AzureFilesError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const HEADERS = { "x-ms-version": AZ_API_VERSION, "Accept": "application/xml" };

async function failFrom(res: Response): Promise<AzureFilesError> {
  let body = "";
  try { body = (await res.text()).slice(0, 2000); } catch { /* ignore */ }
  return new AzureFilesError(res.status, describeAzureError(res.status, body));
}

// List one directory, following continuation markers up to maxPages. A folder
// with more entries than that is reported truncated rather than passed off as
// complete — the same bargain listChildren makes for SharePoint.
export async function listDirectory(
  share: AzureShare, relPath: string, sas: string,
  opts: { fetchImpl?: FetchLike; maxPages?: number; pageSize?: number } = {},
): Promise<{ entries: AzEntry[]; truncated: boolean }> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const maxPages = opts.maxPages ?? 10;
  const pageSize = String(opts.pageSize ?? 1000);
  const entries: AzEntry[] = [];
  let marker = "";
  for (let page = 0; page < maxPages; page++) {
    const q: Record<string, string> = { restype: "directory", comp: "list", include: "Timestamps", maxresults: pageSize };
    if (marker) q.marker = marker;
    const res = await fetchImpl(azureUrl(share, relPath, sas, q), { headers: HEADERS });
    if (!res.ok) throw await failFrom(res);
    const parsed = parseListXml(await res.text());
    entries.push(...parsed.entries);
    if (!parsed.nextMarker) return { entries, truncated: false };
    marker = parsed.nextMarker;
  }
  return { entries, truncated: true };
}

// Get File Properties: size and modified stamp without the bytes.
export async function fileProps(
  share: AzureShare, relPath: string, sas: string, fetchImpl: FetchLike = globalThis.fetch as FetchLike,
): Promise<{ size: number; modified: string | null; contentType: string | null }> {
  const res = await fetchImpl(azureUrl(share, relPath, sas), { method: "HEAD", headers: HEADERS });
  if (!res.ok) throw await failFrom(res);
  const size = Number(res.headers.get("content-length") ?? res.headers.get("x-ms-content-length") ?? 0);
  const lm = res.headers.get("last-modified");
  const d = lm ? new Date(lm) : null;
  return {
    size: Number.isNaN(size) ? 0 : size,
    modified: d && !Number.isNaN(d.getTime()) ? d.toISOString() : lm,
    contentType: res.headers.get("content-type"),
  };
}

// Get File: the bytes, as a Response so the caller buffers it exactly as it
// already does for Graph content.
export async function getFile(
  share: AzureShare, relPath: string, sas: string, fetchImpl: FetchLike = globalThis.fetch as FetchLike,
): Promise<Response> {
  const res = await fetchImpl(azureUrl(share, relPath, sas), { headers: HEADERS });
  if (!res.ok) throw await failFrom(res);
  return res;
}

// The project folder on a share is found the way it is found in SharePoint:
// a folder at the root whose name STARTS WITH the project number, case-
// insensitively (folders are "<number> <name>" on the NY drive too).
export function findProjectFolderName(entries: AzEntry[], numPrefix: string): string | null {
  const num = String(numPrefix || "").toLowerCase().trim();
  if (!num) return null;
  const hit = entries.find((e) => e.type === "folder" && e.name.toLowerCase().startsWith(num));
  return hit ? hit.name : null;
}

// The reverse of findProjectFolderName: which registered project does a
// folder name belong to? The LONGEST project number that prefixes the name
// wins, so "SAPX256015.00 Tabler" resolves to SAPX256015.00 even when a
// SAPX256015 exists. Null when no project claims the folder — and a folder
// no project claims has no visibility basis, so it is not served.
export function projectForFolderName<T extends { projectNumber?: string | null }>(folderName: string, projects: T[]): T | null {
  const lower = String(folderName || "").toLowerCase().trim();
  if (!lower) return null;
  let best: T | null = null, bestLen = 0;
  for (const p of projects) {
    const num = String(p?.projectNumber || "").toLowerCase().trim();
    if (num && lower.startsWith(num) && num.length > bestLen) { best = p; bestLen = num.length; }
  }
  return best;
}

// ── Drive layouts that differ from the NY standard ─────────────────────────
// DC files projects under a YEAR folder (I:\2026\SIPX262012.00), and its
// subfolders carry a numbered prefix ("99-SIPX262012.00_OUTGOING" where NY
// has "Outgoing"). Both are recognised here so the tools keep speaking the
// standard vocabulary ("Outgoing", "Emails", "Photos") on every drive.

// Grouping folders that may sit between the share root and a project folder:
// a YEAR (DC: I:\2026\…) or an ENTITY code then a year (the N: drive:
// N:\SAP\2025\SAPQ256919.01, with SAIG and SAG beside SAP). A project folder
// never looks like either (its name starts with a 10+ character number).
export const YEAR_SEG_RE = /^(19|20)\d{2}$/;
export const ENTITY_SEG_RE = /^[A-Z]{2,5}$/i;
export function isGroupingSegment(s: string): boolean { return YEAR_SEG_RE.test(s) || ENTITY_SEG_RE.test(s); }
// How well an entity folder name prefixes a project number: SAP → SAPQ256919
// scores 3, SAIG scores 2, SAG scores 2. Used to try the likeliest first.
export function entityPrefixScore(entity: string, num: string): number {
  const a = String(entity || "").toUpperCase(), b = String(num || "").toUpperCase();
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
// Project numbers encode the year in digits 5-6: SIPX262012.00 → 2026.
export function yearOfProjectNumber(num: string | null | undefined): string | null {
  const m = /^[A-Z]{4}(\d{2})\d{4}/i.exec(String(num || "").trim());
  return m ? "20" + m[1] : null;
}
// The plain name behind a DC-style "NN-<number>_NAME" folder; other names
// pass through untouched.
export function standardFolderName(name: string): string {
  const s = String(name || "").replace(/^\d{2}-[A-Z]{4}\d{6}\.\d{2}[_ -]*/i, "").trim();
  return s || String(name || "");
}
// What people (and the SharePoint tools) call each standard subfolder, and
// the names it goes by on the drives.
const FOLDER_ALIASES: Record<string, string[]> = {
  outgoing: ["outgoing", "out"],
  emails: ["emails", "email", "incoming", "in"],
  incoming: ["incoming", "emails", "email", "in"],
  photos: ["photos", "photo", "pictures"],
  pm: ["pm", "project management", "project mgmt"],
  reports: ["reports", "report", "narratives"],
  "qa-qc": ["qa-qc", "qaqc", "qa qc", "qa/qc", "qa"],
  ca: ["ca", "construction administration", "construction admin", "constr admin"],
};
function norm(s: string): string { return String(s || "").toLowerCase().replace(/[_\s]+/g, " ").trim(); }
// Which child folder a caller means by `wanted`: the exact name first, then
// the same name behind a DC prefix, then a known alias, then a unique
// contains-match. Null when nothing fits (the caller then reports 404).
export function resolveChildFolder(entries: AzEntry[], wanted: string): string | null {
  const w = norm(wanted);
  if (!w) return null;
  const folders = entries.filter((e) => e.type === "folder");
  const exact = folders.find((e) => norm(e.name) === w);
  if (exact) return exact.name;
  const std = folders.find((e) => norm(standardFolderName(e.name)) === w);
  if (std) return std.name;
  // Any spelling in a group finds a folder carrying any other spelling in it.
  const group = Object.values(FOLDER_ALIASES).find((g) => g.includes(w)) ?? [];
  const byAlias = folders.find((e) => group.includes(norm(standardFolderName(e.name))));
  if (byAlias) return byAlias.name;
  // Contains-match on WORD boundaries: "ca" must not find "Load Forecasting"
  // (it did, on a 2026 DC job with no CA folder yet).
  const wordRe = new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)");
  const contains = folders.filter((e) => wordRe.test(norm(standardFolderName(e.name))));
  return contains.length === 1 ? contains[0].name : null;
}

// ── Construction administration on a drive ──────────────────────────────────
// Layout (NY N: and DC alike): <project>/70-<number>_CA/ holds numbered
// subfolders ("8. RFIs", "9. Submittals", older jobs also a bare "RFI"); under
// the RFI and submittal folders a folder per discipline (E, FA, FP, M, P,
// Misc) and under those a folder per item. Some jobs skip the discipline
// level, so a non-discipline folder directly under the kind folder is an item.
// The kind word must END the name: "9. Submittals" is the folder, "4.
// Submittal Schedule" and "Submittal Response.doc" are not.
const CA_KIND_RE: Record<"rfi" | "submittal", RegExp> = { rfi: /(^|[^a-z])rfis?\s*$/i, submittal: /(^|[^a-z])submittals?\s*$/i };
export function caKindFolders(entries: AzEntry[], kind: "rfi" | "submittal"): string[] {
  return entries.filter((e) => e.type === "folder" && CA_KIND_RE[kind].test(e.name.replace(/^\d+[.)\-\s]+/, ""))).map((e) => e.name);
}
const DISCIPLINE_FOLDER_RE = /^(e|fa|fp|m|p|t|asc|misc|arch|s|c|gen|general)$/i;
export function isDisciplineFolder(name: string): boolean { return DISCIPLINE_FOLDER_RE.test(String(name || "").trim()); }
// Does an item folder's name carry this RFI / submittal number? Compared on
// the alphanumerics only, and with leading zeros dropped from each numeric
// run, so "RFI 004", "RFI-4" and "004_Duct sizes" all match number "004", and
// "260513-001-0 VAV boxes" matches "260513-001-0".
const alnum = (v: string) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dropZeros = (v: string) => v.replace(/\b0+(\d)/g, "$1");
export function folderMentionsNumber(folderName: string, number: string): boolean {
  const num = dropZeros(alnum(number)); if (!num || num.length < 1) return false;
  const name = dropZeros(alnum(folderName));
  const compact = num.replace(/\s+/g, "");
  if (compact.length >= 3 && name.replace(/\s+/g, "").includes(compact)) return true;
  return new RegExp("(^|\\s)" + num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)").test(name);
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

// ── Discovery: project folders that have no PMS record ─────────────────────
// A project folder is named by its number, optionally followed by a name
// ("SAPQ256918.06", "SAPX256015.00 Tabler"). Inside, the first standard
// subfolder carries the project name on the drives that use numbered
// prefixes: "00-SAPQ256918.06 NYCSCA K328 Energy Model" (NY N:, DC I:/W:).
export const PROJECT_FOLDER_RE = /^([A-Z]{4}\d{6}(?:\.\d{2})?)(?![A-Za-z0-9.])/i;
export function projectNumberOfFolder(name: string): string | null {
  const m = PROJECT_FOLDER_RE.exec(String(name || "").trim());
  return m ? m[1].toUpperCase() : null;
}
// What is left of a folder name once the number (and the separator after it)
// is removed; "" when the folder is the bare number.
export function folderNameRemainder(name: string, num: string): string {
  const s = String(name || "").trim();
  if (!num || !s.toUpperCase().startsWith(num.toUpperCase())) return "";
  return s.slice(num.length).replace(/^[\s_\-–:.]+/, "").trim();
}
// The project name as the drive states it: the "00-<number> <NAME>" child
// folder first, then whatever follows the number on the project folder
// itself; null when neither carries a name (DC's bare "00-<number>" folders).
export function projectNameFromFolders(projectFolder: string, num: string, children: AzEntry[]): string | null {
  const zero = children.find((e) => e.type === "folder" && /^00[-_ ]/.test(e.name));
  if (zero) {
    const stripped = standardFolderName(zero.name);
    const rem = stripped === zero.name ? folderNameRemainder(zero.name.replace(/^00[-_ ]+/, ""), num) : stripped;
    if (rem && !/^\d{2}-/.test(rem)) return rem;
  }
  const own = folderNameRemainder(projectFolder, num);
  return own || null;
}
