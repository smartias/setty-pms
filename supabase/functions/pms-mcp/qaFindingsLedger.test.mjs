// Drift anchors for the QA findings ledger (record/list/update_qa_finding).
//
//   node supabase/functions/pms-mcp/qaFindingsLedger.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf8");
const migration = readFileSync(join(here, "../../migrations/20260907140000_qa_findings_ledger.sql"), "utf8");

for (const anchor of [
  'mcp.tool("record_qa_findings"',
  'mcp.tool("list_qa_findings"',
  'mcp.tool("update_qa_finding"',
  // Ledger writes need a person: the shared-secret lane cannot write.
  "function qaLedgerCaller",
  'c.kind === "service" || !c.email',
  // Terminal states carry a reason, always.
  `'${"closed"}' requires a note`.replace("closed", "${status}"),
  // The default read is the working set: open + ready_to_backcheck.
  '"&status=in.(open,ready_to_backcheck)"',
  // External closes are flagged back to the caller.
  "External-source finding closed",
  // Every row is stamped.
  "created_by: who.email",
  "status_by: who.email",
] ) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}

for (const anchor of [
  "create table if not exists public.pms_qa_reviews",
  "create table if not exists public.pms_qa_findings",
  "check (status in ('open','ready_to_backcheck','closed','dismissed'))",
  "check (source in ('qa','ripple','drchecks','owner','architect','agency','other'))",
  "using (is_pms_admin()) with check (is_pms_admin())",
  "for select to authenticated using (true)",
] ) {
  assert.ok(migration.includes(anchor), `migration lost anchor: ${anchor}`);
}

// The tool and the table agree on vocabularies.
const srcSources = src.match(/QA_FINDING_SOURCES = \[([^\]]+)\]/)[1].replace(/["\s]/g, "");
assert.equal(srcSources, "qa,ripple,drchecks,owner,architect,agency,other");
const srcStatuses = src.match(/QA_FINDING_STATUSES = \[([^\]]+)\]/)[1].replace(/["\s]/g, "");
assert.equal(srcStatuses, "open,ready_to_backcheck,closed,dismissed");
const srcSeverities = src.match(/QA_FINDING_SEVERITIES = \[([^\]]+)\]/)[1].replace(/["\s]/g, "");
assert.equal(srcSeverities, "life-safety,agency,cost,rfi-bait,polish");

// Priority order: worst severity first; external reviewer comments outrank
// internal findings at the same severity (copy of qaFindingRank).
const QA_SEVERITY_RANK = { "life-safety": 0, "agency": 1, "cost": 2, "rfi-bait": 3, "polish": 4 };
const QA_EXTERNAL_SOURCES = new Set(["drchecks", "owner", "architect", "agency"]);
const qaFindingRank = (r) => (QA_SEVERITY_RANK[r.severity ?? ""] ?? 5) * 2 + (QA_EXTERNAL_SOURCES.has(r.source ?? "") ? 0 : 1);
const sorted = [
  { severity: "polish", source: "qa" },
  { severity: "cost", source: "qa" },
  { severity: "agency", source: "drchecks" },
  { severity: "agency", source: "qa" },
  { severity: "cost", source: "owner" },
  { severity: null, source: "qa" },
].sort((a, b) => qaFindingRank(a) - qaFindingRank(b));
assert.deepEqual(sorted.map((r) => `${r.severity}/${r.source}`),
  ["agency/drchecks", "agency/qa", "cost/owner", "cost/qa", "polish/qa", "null/qa"]);
assert.ok(src.includes("const qaFindingRank"), "index.ts lost qaFindingRank");
const cost = readFileSync(join(here, "../../migrations/20260907150000_qa_severity_cost.sql"), "utf8");
assert.ok(cost.includes("check (severity in ('life-safety','agency','cost','rfi-bait','polish'))"), "cost migration lost the vocabulary");

console.log("qaFindingsLedger.test.mjs: all assertions passed");
