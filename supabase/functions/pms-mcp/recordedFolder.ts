// A project's SharePoint folder, found through the PMS RECORD when its name
// does not start with the project number (2026-11-13).
//
// Every file tool finds a project's folder by scanning the drive root for a
// name that starts with the number. That fails when the folder was created
// under a different number than the one the project carries now: Q126 is
// SAPQ236917.01 in the PMS and its folder is still "SAPX236917.01 - Q126 Reso
// A Science Lab". The folder exists, the record's projectFolderUrl points at
// it, and list_project_documents / search_drawings reported the project as
// having no files at all.
//
// Renaming the folder is not the fix: its path is stored in the transmittal
// register, on every CA record's spFolderUrl and in saved review links. So
// the lookup falls back to the folder the record names. Pure; see the tests.

// The folder's own name from a SharePoint folder URL: the last path segment,
// decoded, trailing slash stripped. A library "view" link carries the real
// path in ?id= (or ?RootFolder=) instead; that wins when present.
export function folderNameFromUrl(url: string | null | undefined): string | null {
  const raw = String(url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const viewPath = u.searchParams.get("id") || u.searchParams.get("RootFolder");
  const path = viewPath && viewPath.includes("/") ? viewPath : u.pathname;
  const segs = path.split("/").filter(Boolean);
  if (!segs.length) return null;
  let last = segs[segs.length - 1];
  // searchParams values arrive decoded; a pathname does not.
  if (path === u.pathname) { try { last = decodeURIComponent(last); } catch { /* keep the raw segment */ } }
  last = last.trim();
  // A page, not a folder (AllItems.aspx with no ?id=).
  if (!last || /\.aspx$/i.test(last)) return null;
  return last;
}

// Which project a number means: exact first, then the first whose number
// starts with it. The same rule pickTeam uses, so the folder and the region
// are always resolved for the same project.
export function pickRecordedFolderName(
  rows: Array<{ projectNumber?: string | null; projectFolderUrl?: string | null }>, num: string,
): string | null {
  const n = String(num || "").toLowerCase().trim();
  if (!n || !Array.isArray(rows)) return null;
  const p = rows.find((x) => String(x?.projectNumber || "").toLowerCase() === n) ??
    rows.find((x) => String(x?.projectNumber || "").toLowerCase().startsWith(n));
  return folderNameFromUrl(p?.projectFolderUrl);
}

// The drive-root folder with exactly that name (case-insensitive, as
// SharePoint compares names). Exact, never a prefix: the record names one
// folder, and a near miss must stay a miss.
export function matchRecordedFolder<T extends { name?: string; folder?: unknown }>(items: T[], name: string | null): T | null {
  const want = String(name || "").toLowerCase().trim();
  if (!want) return null;
  return (items || []).find((it) => it?.folder && String(it.name || "").toLowerCase().trim() === want) ?? null;
}
