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
  '"pms_qa_checklist?select=item_id,section,sort,text,details,automation,automation_hint,source,phases"',
  '"&enabled=eq.true&order=sort,item_id"',
  "a human signs off",
  // Ripple rules ride along from their table; a missing table never blocks.
  '"pms_qa_ripple_rules?select=parameter,ripples_to&enabled=eq.true&order=sort"',
  "rules are additive",
  // Phase gate: an item with no phases restriction applies at EVERY phase —
  // the filter must never drop unrestricted items.
  "!Array.isArray(r.phases) || r.phases.length === 0",
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

// RFI prevention items (qa-600 series, 2026-11-16): written from a real RFI
// log, phase-restricted to the sets that carry the content, and marked so the
// next project's lessons can be added and counted the same way.
{
  const rfi = readFileSync(join(here, "../../migrations/20261116180000_qa_rfi_prevention_items.sql"), "utf8");
  for (const id of ["qa-600", "qa-601", "qa-602", "qa-603"]) assert.ok(rfi.includes(`('${id}','deliverable-qa','RFI Prevention',`), `missing ${id}`);
  assert.equal(rfi.split("'rfi-lesson','qa-rfi-review-2026-11-16'").length - 1, 4);
  assert.ok(rfi.includes("on conflict (item_id) do nothing;"));
  // A schematic set has no spec book: the spec item is not asked of DD.
  assert.ok(/'qa-602'[\s\S]*?'\["CD","Permit","Bid","Addendum"\]'::jsonb,'rfi-lesson'/.test(rfi));
  // Every details value is valid JSON (a broken array would fail the insert).
  // Each sits on one line between the item text and its automation class.
  const details = [...rfi.matchAll(/\n '(\[.*\])'::jsonb,\n 'assisted'/g)].map((m) => JSON.parse(m[1].replace(/''/g, "'")));
  assert.equal(details.length, 4);
  for (const d of details) assert.ok(Array.isArray(d) && d.length >= 3);
  // The skill carries the method for each, and says where QA stops.
  const skill = readFileSync(join(here, "../../../.claude/skills/qa-coordination-review/SKILL.md"), "utf8");
  for (const id of ["qa-600", "qa-601", "qa-602", "qa-603"]) assert.ok(skill.includes(`**${id} `), `skill has no method for ${id}`);
  assert.ok(skill.includes("## What QA is for — and where it stops"));
  assert.ok(!/post-bid cost posture/i.test(skill), "the QA skill carries construction-phase guidance again");
}

// Cross-discipline items (qa-610 series, 2026-11-16): the skill's X checks on
// the checklist, so each shows in the PMS and gets a tracked result.
{
  const x = readFileSync(join(here, "../../migrations/20261116220000_qa_cross_discipline_items.sql"), "utf8");
  const ids = ["qa-610", "qa-611", "qa-612", "qa-613", "qa-614", "qa-615", "qa-616"];
  for (const id of ids) assert.ok(x.includes(`('${id}','deliverable-qa','Cross-Discipline Coordination',`), `missing ${id}`);
  assert.equal(x.split("'rfi-lesson','qa-rfi-review-2026-11-16-bpl'").length - 1, 7);
  assert.ok(x.includes("on conflict (item_id) do nothing;"));
  const details = [...x.matchAll(/\n '(\[.*\])'::jsonb,\n 'assisted'/g)].map((m) => JSON.parse(m[1].replace(/''/g, "'")));
  assert.equal(details.length, 7);
  for (const d of details) assert.ok(Array.isArray(d) && d.length >= 3);
  const skill = readFileSync(join(here, "../../../.claude/skills/qa-coordination-review/SKILL.md"), "utf8");
  for (const id of ids) assert.ok(skill.includes("`" + id + "`"), `skill does not map ${id}`);
  assert.ok(skill.includes("revise_qa_finding_action"));
}

// Bidder's eye items (qa-620 series, 2026-11-16): the set read as someone who
// has to price it. Not asked of a DD set.
{
  const b = readFileSync(join(here, "../../migrations/20261116231000_qa_bidders_eye_items.sql"), "utf8");
  const ids = ["qa-620", "qa-621", "qa-622", "qa-623", "qa-624"];
  for (const id of ids) assert.ok(b.includes(`('${id}','deliverable-qa','Bidder''s Eye',`), `missing ${id}`);
  assert.equal(b.split("'[\"CD\",\"Permit\",\"Bid\",\"Addendum\"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-tabler-bid'").length - 1, 5);
  assert.ok(b.includes("on conflict (item_id) do nothing;"));
  const details = [...b.matchAll(/\n '(\[.*\])'::jsonb,\n 'assisted'/g)].map((m) => JSON.parse(m[1].replace(/''/g, "'")));
  assert.equal(details.length, 5);
  for (const d of details) assert.ok(Array.isArray(d) && d.length >= 4);
  const skill = readFileSync(join(here, "../../../.claude/skills/qa-coordination-review/SKILL.md"), "utf8");
  for (const id of ids) assert.ok(skill.includes(`**${id} `), `skill has no method for ${id}`);
  assert.ok(skill.includes("Try to disprove each finding before it goes on the list"));
}

// RFI history items (qa-630 series, 2026-11-16): the five kinds of preventable
// RFI that matched no checklist item when 25 projects' logs were tagged.
{
  const b = readFileSync(join(here, "../../migrations/20261116240000_qa_rfi_history_items.sql"), "utf8");
  const ids = ["qa-630", "qa-631", "qa-632", "qa-633", "qa-634"];
  for (const id of ids) assert.ok(b.includes(`('${id}','deliverable-qa','RFI History',`), `missing ${id}`);
  assert.equal(b.split("::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-rfi-history'").length - 1, 5);
  assert.ok(b.includes("on conflict (item_id) do nothing;"));
  const details = [...b.matchAll(/\n '(\[.*\])'::jsonb,\n 'assisted'/g)].map((m) => JSON.parse(m[1].replace(/''/g, "'")));
  assert.equal(details.length, 5);
  for (const d of details) assert.ok(Array.isArray(d) && d.length >= 4);
  const phases = [...b.matchAll(/\n '(\[[^\n]*\])'::jsonb,'rfi-lesson'/g)].map((m) => JSON.parse(m[1]));
  assert.equal(phases.length, 5);
  for (const ph of phases) for (const x of ph) assert.ok(["DD", "CD", "Permit", "Bid", "Addendum"].includes(x), `unknown phase ${x}`);
  const skill = readFileSync(join(here, "../../../.claude/skills/qa-coordination-review/SKILL.md"), "utf8");
  for (const id of ids) assert.ok(skill.includes(`**${id} `), `skill has no method for ${id}`);
}

// Design narrative as read (Step 5b): the review writes a brief account of the
// design from the drawings alone, inside the report. The QA tab's prompt asks
// for it by name, and the design-narrative skill must not take it for an
// engineer's prior narrative.
{
  const skill = readFileSync(join(here, "../../../.claude/skills/qa-coordination-review/SKILL.md"), "utf8");
  assert.ok(skill.includes("## Step 5b — Design narrative as read from the drawings"));
  assert.ok(skill.includes("## Design as read"), "the report structure has no Design as read section");
  assert.ok(skill.includes("not stated on the drawings"));
  const pms = readFileSync(join(here, "../../../SettyPMS.html"), "utf8");
  assert.ok(pms.includes("'Design as read' section"), "the QA tab prompt does not ask for the narrative");
  const bod = readFileSync(join(here, "../../../.claude/skills/design-narrative/SKILL.md"), "utf8");
  assert.ok(bod.includes("That is NOT a prior narrative"));
}

// A skill upload is refused when the frontmatter description is over 1024
// characters (found 2026-11-16: three skills were over and could not be
// uploaded). Folded YAML: lines join with a space.
{
  const { readdirSync } = await import("node:fs");
  const dir = join(here, "../../../.claude/skills");
  for (const name of readdirSync(dir)) {
    const md = readFileSync(join(dir, name, "SKILL.md"), "utf8");
    const fm = md.split("---")[1] || "";
    const m = fm.match(/\ndescription: >\n([\s\S]*)$/);
    assert.ok(m, `${name}: no folded description`);
    const text = m[1].split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
    assert.ok(text.length <= 1024, `${name}: description is ${text.length} characters, the limit is 1024`);
    assert.ok(new RegExp(`\\nname: ${name}\\n`).test(fm), `${name}: name must match the folder`);
  }
}

console.log("qaChecklist.test.mjs: all assertions passed");
