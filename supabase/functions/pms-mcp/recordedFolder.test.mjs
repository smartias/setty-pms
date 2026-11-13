// Tests for recordedFolder.ts — a project folder found through the PMS
// record when its name does not start with the project number (2026-11-13).
//
// Live repro: Q126 is SAPQ236917.01 in the PMS; its SharePoint folder is
// "SAPX236917.01 - Q126 Reso A Science Lab". list_project_documents answered
// "Nothing for this project in SharePoint yet" and search_drawings answered
// "No Outgoing folder was found", while the folder held four issued sets.
//
//   node supabase/functions/pms-mcp/recordedFolder.test.mjs
//
// The module is pure, so this imports the real Edge source (Node strips the
// types). The wiring in index.ts is pinned by the drift checks at the bottom.

import { readFileSync } from "node:fs";
import { folderNameFromUrl, pickRecordedFolderName, matchRecordedFolder } from "./recordedFolder.ts";

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };
const eq = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);

const Q126_URL = "https://setty.sharepoint.com/sites/NYCProjects/Project%20Document%20Library/SAPX236917.01%20-%20Q126%20Reso%20A%20Science%20Lab";
const Q126_NAME = "SAPX236917.01 - Q126 Reso A Science Lab";

// ── 1. folderNameFromUrl ────────────────────────────────────────────────────
eq(folderNameFromUrl(Q126_URL), Q126_NAME, "last segment, decoded");
eq(folderNameFromUrl(Q126_URL + "/"), Q126_NAME, "a trailing slash is ignored");
eq(folderNameFromUrl("  " + Q126_URL + "  "), Q126_NAME, "surrounding whitespace is ignored");
eq(folderNameFromUrl(Q126_URL + "?csf=1&web=1"), Q126_NAME, "share-link query noise is ignored");
eq(folderNameFromUrl(
  "https://setty.sharepoint.com/sites/NYCProjects/Project%20Document%20Library/Forms/AllItems.aspx" +
  "?id=%2Fsites%2FNYCProjects%2FProject%20Document%20Library%2FSAPX236917%2E01%20%2D%20Q126%20Reso%20A%20Science%20Lab&viewid=abc"),
  Q126_NAME, "a library view link carries the folder in ?id=");
eq(folderNameFromUrl("https://setty.sharepoint.com/sites/NYCProjects/Project%20Document%20Library/Forms/AllItems.aspx"),
  null, "a library page with no folder is not a folder name");
eq(folderNameFromUrl("https://setty.sharepoint.com/sites/X/Lib/100%25%20CD%20-%20Job"), "100% CD - Job", "an encoded percent sign survives");
eq(folderNameFromUrl("https://setty.sharepoint.com/sites/X/Lib/100%ZZ"), "100%ZZ", "a malformed escape falls back to the raw segment");
eq(folderNameFromUrl(""), null, "empty");
eq(folderNameFromUrl(null), null, "null");
eq(folderNameFromUrl("SAPX236917.01 - Q126"), null, "a bare name is not a URL");
eq(folderNameFromUrl("https://setty.sharepoint.com"), null, "a site root has no folder");

// ── 2. pickRecordedFolderName: same project pickTeam would choose ───────────
const ROWS = [
  { projectNumber: "SAPQ236917.00", projectFolderUrl: "https://setty.sharepoint.com/sites/NYCProjects/Project%20Document%20Library/SAPQ236917.00%20-%20SCA%20MEP%20IDIQ%20Master" },
  { projectNumber: "SAPQ236917.01", projectFolderUrl: Q126_URL },
  { projectNumber: "SAPQ236917.02", projectFolderUrl: null },
];
eq(pickRecordedFolderName(ROWS, "sapq236917.01"), Q126_NAME, "exact number wins");
eq(pickRecordedFolderName(ROWS, " SAPQ236917.01 "), Q126_NAME, "case and whitespace do not matter");
eq(pickRecordedFolderName(ROWS, "sapq236917"), "SAPQ236917.00 - SCA MEP IDIQ Master", "a bare number resolves to the first phase, as pickTeam does");
eq(pickRecordedFolderName(ROWS, "sapq236917.02"), null, "a project with no folder URL has no recorded folder");
eq(pickRecordedFolderName(ROWS, "sapx999999.00"), null, "an unknown number has none");
eq(pickRecordedFolderName([], "sapq236917.01"), null, "no rows");
eq(pickRecordedFolderName(ROWS, ""), null, "no number");

// ── 3. matchRecordedFolder: exact name, folders only ────────────────────────
const ROOT = [
  { id: "a", name: "SAPX236917.01 - Q126 Reso A Science Lab", folder: {} },
  { id: "b", name: "SAPX236917.01 - Q126 Reso A Science Lab (old)", folder: {} },
  { id: "c", name: "SAPQ236917.00 - SCA MEP IDIQ Master", folder: {} },
  { id: "d", name: "Readme.txt" },
];
eq(matchRecordedFolder(ROOT, Q126_NAME)?.id, "a", "the recorded folder is found by its exact name");
eq(matchRecordedFolder(ROOT, Q126_NAME.toUpperCase())?.id, "a", "SharePoint names compare case-insensitively");
eq(matchRecordedFolder(ROOT, "SAPX236917.01"), null, "a prefix is NOT a match: the record names one folder");
eq(matchRecordedFolder(ROOT, "Readme.txt"), null, "a file with that name is not a folder");
eq(matchRecordedFolder(ROOT, null), null, "no recorded name, no match");
eq(matchRecordedFolder([], Q126_NAME), null, "empty drive");

// ── 4. Drift checks against the shipped wiring ──────────────────────────────
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED`);
has('import { pickRecordedFolderName, matchRecordedFolder } from "./recordedFolder.ts";', "the module is imported");
has("const recorded = matchRecordedFolder(seen, await recordedFolderName(numPrefix));",
  "findProjectFolderInDrive falls back to the recorded folder");
has("_projFolder.set(key, { item: recorded, at: Date.now() });", "the fallback result is memoized like any other");
has("return matchRecordedFolder(seen, await recordedFolderName(num));", "projectFolder falls back to the recorded folder");
has('"pms_projects?select=projectNumber:project->>projectNumber,projectFolderUrl:project->>projectFolderUrl"',
  "the record lookup reads one row's folder URL, not the portfolio");
// The number match must still win: the fallback runs only after the scan.
const fn = shipped.slice(shipped.indexOf("async function findProjectFolderInDrive("), shipped.indexOf("async function listChildren("));
check(fn.indexOf("numberPrefixMatches(it.name, numPrefix)") < fn.indexOf("matchRecordedFolder("),
  "the number-named folder is tried before the recorded one");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);
