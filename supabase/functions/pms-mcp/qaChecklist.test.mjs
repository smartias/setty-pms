// Tests pinning the QA-checklist-as-content seam (get_qa_checklist).
//
//   node supabase/functions/pms-mcp/qaChecklist.test.mjs
//
// The checklist itself lives in the pms_qa_checklist table (seeded from
// SettyPMS.html's CHECKLIST_TEMPLATES with the same item ids). These are
// drift anchors: the migration, the tool, and the app template must keep
// agreeing on the contract.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf8");
const migration = readFileSync(join(here, "../../migrations/20260907120000_qa_checklist_content.sql"), "utf8");
const app = readFileSync(join(here, "../../../SettyPMS.html"), "utf8");

// The tool exists, reads only enabled rows in section order, and never
// claims completion authority.
for (const anchor of [
  'mcp.tool("get_qa_checklist"',
  '"pms_qa_checklist?select=item_id,section,sort,text,details,automation,automation_hint,source"',
  '"&enabled=eq.true&order=sort,item_id"',
  "a human signs off",
] ) {
  assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
}

// The migration carries the three-class automation contract, admin-only
// writes, authenticated reads, and provenance for lesson-sourced rows.
for (const anchor of [
  "create table if not exists public.pms_qa_checklist",
  "check (automation in ('auto','assisted','manual'))",
  "create policy qa_checklist_read on public.pms_qa_checklist for select to authenticated",
  "using (is_pms_admin()) with check (is_pms_admin())",
  "source          text not null default 'seed'",
  "on conflict (item_id) do nothing;",
] ) {
  assert.ok(migration.includes(anchor), `migration lost anchor: ${anchor}`);
}

// Every item id in the app's code template is present in the seed — the ids
// are the join key to per-project check-off state (project.checklists), so
// the seed may grow but must never lose one the app knows.
const appIds = [...app.matchAll(/id: "(qa-\d+)"/g)].map((m) => m[1]);
assert.ok(appIds.length >= 120, `app template looks truncated: ${appIds.length} ids`);
const seedIds = new Set([...migration.matchAll(/\('(qa-\d+)','deliverable-qa'/g)].map((m) => m[1]));
for (const id of appIds) assert.ok(seedIds.has(id), `seed is missing app checklist item ${id}`);
assert.equal(seedIds.size, new Set(appIds).size, "seed and app template disagree on item count");

// The seed's automation classes stay within the contract, and the mechanical
// tier names real tools.
const autoHints = [...migration.matchAll(/,'auto','([^']+)'\)/g)].map((m) => m[1]);
assert.ok(autoHints.length >= 15, `auto tier shrank to ${autoHints.length}`);
for (const hint of autoHints) {
  assert.ok(/search_drawings|read_drawing_schedule|find_equipment|extract_sheet_index|pms_drawing_text|read_document|drawing index/.test(hint),
    `auto hint names no tool: ${hint}`);
}

console.log("qaChecklist.test.mjs: all assertions passed");
