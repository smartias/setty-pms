// Is a transmittal-register row an issued drawing/spec SET (get_current_set)?
//
// The transmittal tool logs every send as operation = 'transmittal-generated',
// and people use it to email single documents too. On BPL New Lots (Sep 2026)
// an ASHRAE 55 compliance PDF sent from "01 Project Management" became the
// newest register row, and get_current_set reported that one file as the
// project's current set, ahead of every real set under Outgoing.
//
// A row is ruled out only on POSITIVE evidence, because a wrongly dropped set
// is worse than the bug this fixes. All three must hold:
//   - it records at least one file (rows from before the sheet register carry
//     none, and nothing can be said about them);
//   - none of those files is a sheet number or a spec section;
//   - it has a folder, and that folder is not under Outgoing.
// A bulletin whose filename did not parse ("2025-04-10_TablerQ_E_Bulletin
// #1.pdf", sheetNo "") still counts: it was filed under Outgoing.
import { canonicalSheet, canonicalSpec, sheetsOf } from "./currentSet.ts";

// The folder's path segments, whether a SharePoint URL (stored decoded, so a
// literal '%' or '#' is normal) or a drive path with backslashes.
function folderSegments(row: any): string[] {
  const loc = String(row?.sp_folder_url || row?.files?.driveFolder || "").trim();
  if (!loc) return [];
  return loc.replace(/^https?:\/\/[^/]+/i, "").split(/[\\/]+/).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  }).filter(Boolean);
}

// null when the row is (or may be) a set; otherwise why it is not one.
export function notASetReason(row: any): string | null {
  const files = sheetsOf(row);
  if (!files.length) return null;
  if (files.some((s: any) => canonicalSheet(s) || canonicalSpec(s))) return null;
  const segs = folderSegments(row);
  if (!segs.length) return null;
  if (segs.some((s) => s.toLowerCase().includes("outgoing"))) return null;
  return `${files.length} file(s) sent from "${segs[segs.length - 1]}", which is not under Outgoing, and none is a drawing sheet or spec section`;
}

export const isIssuedSetRow = (row: any): boolean => notASetReason(row) === null;
