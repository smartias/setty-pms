// Tests for the 2026-09-24 drive-photos feature in index.ts: DC and BT have
// no SharePoint index at all for field photos (the Field Photos app only
// ever uploads to SharePoint), so real photos sitting on the office network
// drive — confirmed live on SIPX258014.00 (DC), 7 dated folders, 26+ real
// JPEGs in the newest one alone — were completely invisible to
// search_field_photos and unviewable by view_photos. This adds:
//   - driveFieldPhotoRows(): walks a drive project's Photos/01-Pictures
//     folder and synthesizes a session row per dated subfolder with photos.
//   - view_photos: folderId (an az: drive folder) and an az: itemId, viewed
//     via downscaleForView() instead of SharePoint's Graph thumbnail API.
//
//   node supabase/functions/pms-mcp/driveFieldPhotos.test.mjs
//
// The functions are COPIED below, same reason as the other pms-mcp tests:
// index.ts boots a server at import. Drift checks at the bottom.

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };
const eq = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);

// ── copies from index.ts ────────────────────────────────────────────────────
const DRIVE_PHOTO_SESSION_RE = /^(\d{4}-\d{2}-\d{2})[\s_-]*(.*)$/;
function parseDriveSessionFolderName(name) {
  const m = DRIVE_PHOTO_SESSION_RE.exec(String(name || ""));
  return { date: m ? m[1] : null, label: (m ? m[2] : name).trim() || null };
}

// ── 1. parseDriveSessionFolderName: real folder names seen live on DC ──────
eq(parseDriveSessionFolderName("2026-01-06 Sam's Photos"), { date: "2026-01-06", label: "Sam's Photos" },
  "space-separated date + label");
eq(parseDriveSessionFolderName("2026-01-06_Ameen"), { date: "2026-01-06", label: "Ameen" },
  "underscore-separated date + label");
eq(parseDriveSessionFolderName("2026-08-27_Varun"), { date: "2026-08-27", label: "Varun" },
  "another underscore case (the folder with 26 real photos)");
eq(parseDriveSessionFolderName("2026-01-06"), { date: "2026-01-06", label: null },
  "a bare date with no label at all");
eq(parseDriveSessionFolderName("Site Visit Photos"), { date: null, label: "Site Visit Photos" },
  "no leading date — the whole name becomes the label, not a parse failure");
eq(parseDriveSessionFolderName(""), { date: null, label: null }, "empty name is safe");
eq(parseDriveSessionFolderName("2026-13-40 Bad Date"), { date: "2026-13-40", label: "Bad Date" },
  "an out-of-range date-shaped prefix (month 13) still matches \\d{2} — this function does not validate calendar correctness, only shape");

// ── 2. search_field_photos result mapping: drive rows carry folderId, not folderUrl ─
function mapSessionRow(r) {
  return {
    project: r.project_number ? `${r.project_number} — ${r.project_name}` : r.project_name,
    date: r.photo_date, phase: r.phase, system: r.system, location: r.location,
    photos: r.photo_count, source: r.source,
    ...(r.source === "drive" ? { folderId: r.folder_id } : { folderUrl: r.folder_url }),
  };
}
const driveRow = mapSessionRow({ project_number: "SIPX258014.00", project_name: "IAD UA ACMX BreakRm Reno",
  photo_date: "2026-08-27", phase: null, system: null, location: "Varun", photo_count: 26, source: "drive",
  folder_id: "az:DC.I:2025/SIPX258014.00/05-SIPX258014.00_PHOTOS/01-Pictures/2026-08-27_Varun" });
check(driveRow.folderId && !("folderUrl" in driveRow), "a drive session exposes folderId, never folderUrl");
const spRow = mapSessionRow({ project_number: "SAPX266021.00", project_name: "St. Nicholas", photo_date: "2026-07-07",
  phase: "Existing Conditions", system: "Mechanical/HVAC", location: "Roof", photo_count: 6, source: "field-photo-app",
  folder_url: "https://setty.sharepoint.com/.../Photos/2026-07-07" });
check(spRow.folderUrl && !("folderId" in spRow), "a SharePoint session still exposes folderUrl, never folderId");

// ── 3. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has("const DRIVE_PHOTO_SESSION_RE = /^(\\d{4}-\\d{2}-\\d{2})[\\s_-]*(.*)$/;", "the session-folder regex");
has("function parseDriveSessionFolderName(name: string): { date: string | null; label: string | null } {",
  "parseDriveSessionFolderName is defined");
has("async function driveFieldPhotoRows(projectQuery: string): Promise<any[]> {", "driveFieldPhotoRows is defined");
has('if (region.kind === "sharepoint") return [];', "driveFieldPhotoRows skips SharePoint regions (Supabase already covers those)");
has('const picturesName = resolveChildFolder(photosDir.entries, "Pictures");', "the Pictures subfolder is found via the same alias resolver every other drive tool uses, not a bespoke regex");
has("if (!photoCount) continue; // an empty scaffold folder is not a session", "empty session folders are skipped, not surfaced as zero-photo sessions");
has('...(r.source === "drive" ? { folderId: r.folder_id } : { folderUrl: r.folder_url }),',
  "search_field_photos exposes folderId for drive rows, folderUrl otherwise");
has("async function downscaleForView(bytes: Uint8Array): Promise<{ data: string; mimeType: string } | null> {",
  "downscaleForView is defined");
has('const { Image } = await import("imagescript") as any;', "downscaleForView reuses the pinned imagescript dependency");
has("type PhotoFile =", "view_photos' file union type distinguishes sharepoint vs. drive sources");
has("if (isAzId(raw)) {", "view_photos' itemId branch accepts an az: drive file id, not just a SharePoint composite");
has("} else if (folderId?.trim()) {", "view_photos gained a folderId (drive folder) input mode");
has("const gate = await azurePathProject(dec.team, dec.relPath);", "the az: gate runs before any drive read (shared literal, count asserted in regionRouting.test.mjs)");
has('failed.push({ file: f.name, reason: "could not decode this image for preview (unsupported format) — open the original from the drive" });',
  "an undecodable drive image fails closed with a clear reason, never a bogus fallback mimeType");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);
