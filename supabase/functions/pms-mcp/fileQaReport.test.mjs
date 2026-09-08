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
  // Find-or-create reuses a hand-made folder instead of duplicating it.
  "String(k.name).toLowerCase() === name.toLowerCase()",
  // The dated-folder convention matches Outgoing sets.
  "`${day}_${clean(title)}`",
] ) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}
// Exactly ONE graphSend write helper and its only tool callers are the
// filing tool's folder-create and upload - the write surface stays scoped.
assert.equal(src.split("graphSend(").length - 1, 3, "graphSend call sites changed - audit the write surface");

console.log("fileQaReport.test.mjs: all assertions passed");
