// Off-site backup: the connector's half.
//
// The nightly GitHub Actions job (.github/workflows/backup.yml) dumps the
// database and uploads the files to a SharePoint folder. It holds no Microsoft
// credentials: for each file it asks the connector for a Graph upload session
// (POST /pms-mcp/admin/backup/upload-session) and PUTs the bytes straight to
// the pre-authenticated uploadUrl that comes back. This module is the part of
// that route that decides WHAT may be written and WHERE:
//
//   - only under the folder named by the BACKUP_FOLDER_URL secret;
//   - only these names, so a leaked token cannot write anything else:
//       core/YYYY-MM-DD/<name>       a new folder per night; never overwritten
//       emails/emails-YYYY-MM.csv.gz  replaced in place (SharePoint keeps the
//       history/history-YYYY-MM.csv.gz  previous copy as a version)
//
// Pure apart from the injected `graph` calls, so backupExport.test.mjs can
// drive it with stubs. See docs/RESTORE.md for what the files are.

export type GraphResult = { status: number; json: any };
export type BackupGraph = {
  get(path: string): Promise<GraphResult>;
  post(path: string, body: unknown): Promise<GraphResult>;
};
export type BackupRoot = { driveId: string; itemId: string; webUrl?: string | null };

export const BACKUP_LIST_FOLDERS = ["core", "emails", "history"] as const;

const CORE_FILE = /^core\/(\d{4})-(\d{2})-(\d{2})\/([a-z0-9][a-z0-9._-]{0,80})$/;
const MONTHLY_FILE = /^(emails|history)\/(emails|history)-(\d{4})-(\d{2})\.csv\.gz$/;

export type BackupPath =
  | { ok: true; folders: string[]; name: string; conflict: "fail" | "replace" }
  | { ok: false; reason: string };

/** Is this a file the backup job may write, and may it replace an existing one? */
export function checkBackupPath(path: unknown): BackupPath {
  const p = String(path ?? "");
  const core = CORE_FILE.exec(p);
  if (core) {
    const [, y, m, d, name] = core;
    if (!validDate(+y, +m, +d)) return { ok: false, reason: `not a real date: ${y}-${m}-${d}` };
    if (name.includes("..")) return { ok: false, reason: "file name may not contain '..'" };
    return { ok: true, folders: ["core", `${y}-${m}-${d}`], name, conflict: "fail" };
  }
  const monthly = MONTHLY_FILE.exec(p);
  if (monthly) {
    const [, folder, prefix, y, m] = monthly;
    if (folder !== prefix) return { ok: false, reason: `${prefix}-*.csv.gz files belong in ${prefix}/` };
    if (+m < 1 || +m > 12 || +y < 2000) return { ok: false, reason: `not a real month: ${y}-${m}` };
    return { ok: true, folders: [folder], name: `${prefix}-${y}-${m}.csv.gz`, conflict: "replace" };
  }
  return {
    ok: false,
    reason: "path must be core/YYYY-MM-DD/<name>, emails/emails-YYYY-MM.csv.gz or history/history-YYYY-MM.csv.gz",
  };
}

function validDate(y: number, m: number, d: number): boolean {
  if (y < 2000 || m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Graph's /shares token for a sharing link or folder URL. */
export function shareToken(url: string): string {
  const b64 = btoa(unescape(encodeURIComponent(url)));
  return "u!" + b64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** The backup folder, from the BACKUP_FOLDER_URL secret. Must be a folder. */
export async function resolveBackupRoot(graph: BackupGraph, folderUrl: string | null | undefined): Promise<BackupRoot> {
  const url = String(folderUrl ?? "").trim();
  if (!url) {
    throw new Error("BACKUP_FOLDER_URL is not set: add the SharePoint folder's link as an Edge Function secret.");
  }
  const r = await graph.get(`/shares/${shareToken(url)}/driveItem?$select=id,name,folder,webUrl,parentReference`);
  if (r.status === 404 || r.status === 403) {
    throw new Error(`BACKUP_FOLDER_URL could not be opened by the connector (Graph ${r.status}). ` +
      "Check the link, and that the connector's app registration can write to that site.");
  }
  if (r.status !== 200) throw new Error(`Graph ${r.status} resolving BACKUP_FOLDER_URL: ${JSON.stringify(r.json).slice(0, 200)}`);
  const item = r.json || {};
  if (!item.folder) throw new Error("BACKUP_FOLDER_URL points at a file, not a folder.");
  const driveId = String(item.parentReference?.driveId || "");
  if (!driveId || !item.id) throw new Error("Graph returned no drive id for BACKUP_FOLDER_URL.");
  return { driveId, itemId: String(item.id), webUrl: item.webUrl ?? null };
}

const enc = (s: string) => encodeURIComponent(s);

/**
 * Walk (and create where missing) the folders under the backup root.
 * GET first; create with conflictBehavior "fail" and re-read on a clash, never
 * "replace" (on current Graph that can delete and recreate a folder with its
 * contents — see CLAUDE.md).
 */
export async function ensureFolders(graph: BackupGraph, root: BackupRoot, folders: string[]): Promise<string> {
  let parent = root.itemId;
  for (const name of folders) {
    const found = await graph.get(`/drives/${root.driveId}/items/${parent}:/${enc(name)}?$select=id,folder`);
    if (found.status === 200 && found.json?.id) {
      if (!found.json.folder) throw new Error(`'${name}' exists in the backup folder but is a file, not a folder.`);
      parent = String(found.json.id);
      continue;
    }
    if (found.status !== 404) throw new Error(`Graph ${found.status} looking up backup folder '${name}'.`);
    const made = await graph.post(`/drives/${root.driveId}/items/${parent}/children`,
      { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
    if ((made.status === 200 || made.status === 201) && made.json?.id) {
      parent = String(made.json.id);
      continue;
    }
    if (made.status === 409) { // created by a concurrent run between our GET and POST
      const again = await graph.get(`/drives/${root.driveId}/items/${parent}:/${enc(name)}?$select=id,folder`);
      if (again.status === 200 && again.json?.id && again.json.folder) { parent = String(again.json.id); continue; }
    }
    throw new Error(`Could not create backup folder '${name}' (Graph ${made.status}): ${JSON.stringify(made.json).slice(0, 200)}`);
  }
  return parent;
}

/** An upload session for one backup file. The caller PUTs the bytes to uploadUrl. */
export async function createBackupUploadSession(
  graph: BackupGraph, root: BackupRoot, path: unknown, size: unknown,
): Promise<{ uploadUrl: string; expirationDateTime: string | null; conflict: "fail" | "replace" }> {
  const chk = checkBackupPath(path);
  if (!chk.ok) throw new BackupRequestError(chk.reason);
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > 200 * 1024 ** 3) {
    throw new BackupRequestError("size must be the file's byte count (1 byte to 200 GB)");
  }
  const parent = await ensureFolders(graph, root, chk.folders);
  const r = await graph.post(`/drives/${root.driveId}/items/${parent}:/${enc(chk.name)}:/createUploadSession`, {
    item: { "@microsoft.graph.conflictBehavior": chk.conflict, name: chk.name },
  });
  if (r.status === 409) {
    throw new BackupRequestError(`${String(path)} already exists; core/ files are never overwritten.`);
  }
  if (r.status !== 200 || !r.json?.uploadUrl) {
    throw new Error(`Graph ${r.status} creating an upload session for ${String(path)}: ${JSON.stringify(r.json).slice(0, 200)}`);
  }
  return { uploadUrl: String(r.json.uploadUrl), expirationDateTime: r.json.expirationDateTime ?? null, conflict: chk.conflict };
}

/** Files in one of the backup subfolders; [] when it does not exist yet. */
export async function listBackupFolder(graph: BackupGraph, root: BackupRoot, folder: unknown) {
  const f = String(folder ?? "");
  if (!(BACKUP_LIST_FOLDERS as readonly string[]).includes(f)) {
    throw new BackupRequestError(`folder must be one of ${BACKUP_LIST_FOLDERS.join(", ")}`);
  }
  const out: { name: string; size: number; lastModified: string | null; isFolder: boolean }[] = [];
  let next: string | null =
    `/drives/${root.driveId}/items/${root.itemId}:/${f}:/children?$select=name,size,lastModifiedDateTime,folder&$top=999`;
  while (next) {
    const r = await graph.get(next);
    if (r.status === 404) return out;
    if (r.status !== 200) throw new Error(`Graph ${r.status} listing backup folder '${f}'.`);
    for (const it of r.json?.value || []) {
      out.push({ name: String(it.name), size: Number(it.size) || 0, lastModified: it.lastModifiedDateTime ?? null, isFolder: !!it.folder });
    }
    const link: string | undefined = r.json?.["@odata.nextLink"];
    next = link ? link.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, "") : null;
  }
  return out;
}

/** A refusal caused by the request itself (answer 400), not by Graph or config (500). */
export class BackupRequestError extends Error {}
