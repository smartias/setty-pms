// Tests for revisionCarried.js (check_revision_carried, qa-634). Rows are
// shaped as pms_set_tag_changes returns them; the first case is what Tabler's
// Addendum #1 returned on 2026-11-24.
//
//   node --test supabase/functions/pms-mcp/revisionCarried.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { revisionCarried } from "./revisionCarried.js";

const row = (sheet, change, prefix, num, inSet, elsewhere) => ({
  sheet_no: sheet, change, tag_prefix: prefix, tag_num: num, in_set_sheets: inSet || null, elsewhere_sheets: elsewhere || null,
  previous_set: "2024-10-24_Revised 100% CD Submission", sheets_in_set: 58, sheets_with_previous: 56, set_date: "2025-01-21",
});

test("Tabler Addendum 1: a tag removed in the set that sheets not re-issued still show", () => {
  const r = revisionCarried([
    row("FP111", "removed", "BFP", 3, null, ["FP601", "P111"]),
    row("M801", "added", "CAT", 6), row("M801", "added", "RS", 485), row("E610", "added", "RFI", 144),
    row("M201", "removed", "UH", 4, ["M202"], ["M601"]),
    row("M301", "removed", "EF", 2, null, null),
  ]);
  assert.deepEqual(r.removedStillShown.map((t) => t.tag), ["BFP-3"]);
  assert.equal(r.removedStillShown[0].message, "BFP-3 was removed from FP111 in this set. FP601, P111 were not re-issued and still show it.");
  assert.deepEqual(r.addedOnOneSheet, [], "CAT-6, RS-485 and an RFI number are not equipment");
  assert.deepEqual([r.sheetsInSet, r.sheetsCompared, r.newSheets, r.setDate], [58, 56, 2, "2025-01-21"]);
  assert.deepEqual([r.tagsRemoved, r.tagsAdded, r.flagged], [3, 0, 1], "UH-4 moved to another sheet of the set; EF-2 is gone everywhere");
});

test("a tag added on one sheet and shown nowhere else; one added on two sheets is not reported", () => {
  const r = revisionCarried([
    row("M201", "added", "EF", 12),
    row("M201", "added", "EF", 13, ["M601"]), row("M601", "added", "EF", 13, ["M201"]),
    row("E201", "added", "LP", 4, null, ["E601"]),
    row("M201", "added", "M", 601), row("P201", "added", "P", 7),
  ]);
  assert.deepEqual(r.addedOnOneSheet.map((t) => [t.tag, t.addedOn]), [["EF-12", "M201"], ["P-7", "P201"]], "M-601 is a sheet reference; P-7 is a pump");
  assert.match(r.addedOnOneSheet[0].message, /^EF-12 was added on M201 in this set and is on no other sheet\./);
  assert.equal(r.flagged, 0);
});

test("removed from one sheet and put back on another, removed from two, and nothing changed", () => {
  const moved = revisionCarried([row("M201", "removed", "FCU", 3, ["M202"], ["M601"]), row("M202", "added", "FCU", 3, null, ["M601"])]);
  assert.deepEqual([moved.removedStillShown.length, moved.addedOnOneSheet.length], [0, 0]);
  const two = revisionCarried([row("FA200", "removed", "SD", 1, null, ["E200"]), row("M200", "removed", "SD", 1, null, ["E200"])]);
  assert.deepEqual(two.removedStillShown[0].removedFrom, ["FA200", "M200"]);
  assert.match(two.removedStillShown[0].message, /E200 was not re-issued and still shows it\./);
  const none = revisionCarried([{ sheet_no: null, change: "-", sheets_in_set: 11, sheets_with_previous: 11, set_date: "2026-02-27" }]);
  assert.deepEqual([none.sheetsInSet, none.sheetsWithTagChanges, none.flagged, none.newSheets], [11, 0, 0, 0]);
  assert.equal(revisionCarried([]).sheetsInSet, 0);
});

test("the tool, the database function and the checklist item are in step", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('mcp.tool("check_revision_carried"') && src.includes('sbRpc("pms_set_tag_changes"') && src.includes("revisionCarried(rows)"));
  const sql = readFileSync(new URL("../../migrations/20261125160000_qa_revision_carried.sql", import.meta.url), "utf8");
  for (const col of ["sheet_no text", "change text", "tag_prefix text", "tag_num int", "in_set_sheets text[]", "elsewhere_sheets text[]", "previous_set text", "sheets_in_set bigint", "sheets_with_previous bigint", "set_date date"]) assert.ok(sql.includes(col), col);
  assert.ok(sql.includes("grant execute on function public.pms_set_tag_changes(text, text) to service_role") && sql.includes("from anon"));
  assert.ok(sql.includes("where item_id = 'qa-634'") && sql.includes("check_revision_carried"));
});
