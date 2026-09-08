// Drift anchors for file_qa_report - the connector's ONE scoped SharePoint
// write (Design Reports and Narratives dated folders only).
//
//   node supabase/functions/pms-mcp/fileQaReport.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf8");

for (const anchor of [
  'mcp.tool("file_qa_report"',
  'const QA_REPORTS_FOLDER = "Design Reports and Narratives";',
  // Simple-upload cap under Graph's 4MB hard limit.
  "const QA_REPORT_MAX_FILE_BYTES = 3_500_000;",
  // Signed-in callers only - the same gate as the ledger writes.
  "const who = qaLedgerCaller();",
  // Everything validates BEFORE any write: a bad payload files nothing.
  "Decode + validate all files BEFORE any write",
  // A 403 is surfaced as the admin-consent ask, never swallowed.
  "Files.ReadWrite.All or Sites.ReadWrite.All",
  // Find-or-create reuses provisioned folders (numbering/emoji prefixes):
  // exact match wins, contains-match reuses "02 ... Design Reports and
  // Narratives" instead of duplicating it.
  "folders.find((k: any) => String(k.name).toLowerCase() === want)",
  ".includes(want)",
  // The dated-folder convention matches Outgoing sets.
  "`${day}_${clean(title)}`",
] ) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}
// The write surface stays scoped: graphSend appears only as its definition,
// ensureChildFolder's folder-create, and file_qa_report's upload. The QAQC
// backfill writes only through ensureChildFolder with one fixed name.
assert.equal(src.split("graphSend(").length - 1, 3, "graphSend call sites changed - audit the write surface");
for (const anchor of [
  'mcp.tool("ensure_qaqc_folders"',
  'const QAQC_FOLDER_NAME = "09 \u2705 QAQC";'.replace('\u2705', String.fromCodePoint(0x2705)),
  // Idempotent: any existing folder containing QAQC is left alone.
  'String(k.name).toLowerCase().includes("qaqc")',
]) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}

console.log("fileQaReport.test.mjs: all assertions passed");
