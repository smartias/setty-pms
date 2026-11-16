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
  // Tabler Quad feedback (2026-09-08): every ingested reviewer comment
  // traces to its comment log, and machine backcheck notes are marked so
  // the app renders them as automated evidence, not a person's note.
  "kind:'comment-log' requires sourceDoc",
  '"Auto-backcheck: " + note.trim()',
] ) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}

// The RPC migration relaxes the note requirement ONLY for the human
// confirm-close of an already-backchecked row, and an empty note preserves
// the recorded evidence rather than wiping it.
const rpc = readFileSync(join(here, "../../migrations/20260908120000_qa_tabler_quad_feedback.sql"), "utf8");
for (const anchor of [
  "v_prev.status <> 'ready_to_backcheck'",
  "a note is required to mark a finding dismissed",
  "when p_status = 'closed' and v_note is null then v_prev.status_note",
  "where item_id in ('qa-006','qa-009','qa-023','qa-024','qa-031','qa-033','qa-085','qa-086')",
] ) {
  assert.ok(rpc.includes(anchor), `feedback migration lost anchor: ${anchor}`);
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
assert.equal(srcSources, "qa,ripple,drchecks,owner,architect,agency,other,submittal,rfi");
// The CA-review flow (2026-09-09) widened the source vocabulary so submittal/
// RFI cost flags share the ledger; the widening migration must keep the DB
// CHECK constraint in step with the tool constant above.
const caMigration = readFileSync(join(here, "../../migrations/20260909000000_qa_ca_review_sources.sql"), "utf8");
assert.ok(
  caMigration.includes("check (source in ('qa','ripple','drchecks','owner','architect','agency','other','submittal','rfi'))"),
  "CA-review migration lost the widened source constraint",
);
assert.ok(
  caMigration.includes("check (kind in ('review','backcheck','comment-log','ca-review'))"),
  "CA-review migration lost the widened kind constraint",
);
// save_ca_review keys the ledger on the item's CANONICAL logged number
// (findCaItem accepts number OR id, so keying on the raw input would let one
// item accumulate two external_ref spellings and defeat the re-review
// supersede filter). Both the insert and the supersede filter must use it.
assert.ok(src.includes("external_ref: itemNumber"), "save_ca_review ledger insert lost the canonical item number");
assert.ok(src.includes('"&source=eq." + type + "&external_ref=eq." + encodeURIComponent(itemNumber)'), "save_ca_review supersede filter lost the canonical item number");
assert.ok(!src.includes("external_ref: number,"), "a ledger write regressed to the raw number/id input as external_ref");
// Pull-reply capture depends on merge mode: a merge must preserve the existing
// aiReview and must not touch the ledger when redFlags were not re-evaluated.
assert.ok(/merge:\s*z\.boolean\(\)/.test(src), "save_ca_review lost its merge mode");
assert.ok(src.includes("merge && item.aiReview ? { ...item.aiReview, ...providedOnly }"), "merge mode no longer preserves the existing aiReview");
assert.ok(src.includes("if (merge && redFlags === undefined)"), "merge without redFlags no longer skips the ledger reconciliation");
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

// Punch list (2026-11-16): findings carry the responsible discipline, a
// re-run does not double the list, a cut-off read says so, and a filed
// report is linked from its review row.
for (const anchor of [
  "function qaNormalizeDiscipline",
  "...(discipline ? { discipline } : {})",
  "skippedDuplicates.push({ title: f.title, existingId: dup })",
  "allowDuplicates: z.boolean().optional()",
  '"&order=created_at.desc&limit=" + (lim + 1)',
  "truncated: true,",
  "reviewIds: z.array(z.number()).max(10).optional()",
  "body: JSON.stringify({ report_url: dated.webUrl })",
  // The link write is scoped to the project's own review rows.
  "&project=eq.${encodeURIComponent(String(project))}",
]) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}
// A review that found nothing new can still be recorded: no .min(1).
assert.ok(!/externalRef:[\s\S]{0,900}\}\)\)\.min\(1\)/.test(src), "record_qa_findings requires at least one finding again");
const punch = readFileSync(join(here, "../../migrations/20261116120000_qa_findings_discipline_assignee.sql"), "utf8");
for (const anchor of [
  "add column if not exists discipline  text",
  "add column if not exists assignee    text",
  "add column if not exists report_url text",
  "create or replace function public.pms_qa_finding_set_assignment(p_id bigint, p_discipline text, p_assignee text)",
  "sign-in required: the ledger records who assigned each row",
  "grant execute on function public.pms_qa_finding_set_assignment(bigint, text, text) to authenticated;",
  "revoke all on function public.pms_qa_finding_set_assignment(bigint, text, text) from anon;",
]) {
  assert.ok(punch.includes(anchor), `punch-list migration lost anchor: ${anchor}`);
}
// Copies of the two pure helpers, exercised.
const ALIASES = Object.fromEntries([...src.match(/const QA_DISCIPLINE_ALIASES: Record<string, string> = \{([\s\S]*?)\n\};/)[1]
  .matchAll(/(?:"([^"]+)"|([a-z]+)):\s*"([^"]+)"/g)].map((m) => [m[1] ?? m[2], m[3]]));
const normDisc = (v) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t ? (ALIASES[t.toLowerCase()] ?? t.slice(0, 80)) : null; };
assert.equal(normDisc(" m "), "Mechanical");
assert.equal(normDisc("FP"), "Fire Protection");
assert.equal(normDisc("pm"), "PM / Project");
assert.equal(normDisc("Landscape"), "Landscape");
assert.equal(normDisc("  "), null);
const titleKey = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
assert.equal(titleKey("EF-7:  1 HP -> 2 HP (M-601)."), titleKey("ef 7 1 hp 2 hp m 601"));
assert.notEqual(titleKey("EF-7 upsized"), titleKey("EF-8 upsized"));

console.log("qaFindingsLedger.test.mjs: all assertions passed");
