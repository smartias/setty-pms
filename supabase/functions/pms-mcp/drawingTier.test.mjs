// Backgrounds: other disciplines' drawings in the index, kept apart from
// what Setty issued.
//
//   node --test supabase/functions/pms-mcp/drawingTier.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBackgroundPath } from "./drawingTier.ts";

test("received-files folders are backgrounds", () => {
  for (const p of [
    "Emails/2025-08-26_100%CD Package/BPL New Lots - 100% Construction Documents - 20250822",
    "Email/2024-06-25 Re- BPL Civil",
    "01-INCOMING/2024-10-29_Revised 100% Construction Documents",
    "01-SAPX196006.00_INCOMING/2024-08-15 CompiledSet",
    "Incoming/Architect",
    "02 Backgrounds - Arch/2025-03",
    "Project Management/Reference/Structural",
    "Client Uploads/2026-01",
    "From Architect/2025-08-22",
  ]) assert.equal(isBackgroundPath(p), true, p);
});

test("issued sets, QA copies and ordinary folders are not", () => {
  for (const p of [
    "Outgoing/2025-08-22_100%_CD/Drawings",
    "Outgoing/2026-06-12_Bulletin 3",
    "Outgoing/2024-10-24_Revised 100% CD Submission/Reference",
    "99-SAPX236012.00_OUTGOING/2025-10-29_Bulletin 1",
    "09 ✅ QAQC/2026-11-10",
    "Design Reports and Narratives",
    "Referenced Standards",
    "Preference Sheets",
    "",
    null,
  ]) assert.equal(isBackgroundPath(p), false, String(p));
});

test("the index leaves backgrounds out wherever it leaves QA copies out", () => {
  const here = new URL(".", import.meta.url);
  const src = readFileSync(new URL("index.ts", here), "utf8");
  assert.match(src, /from "\.\/drawingTier\.ts"/);
  assert.match(src, /const isNotIssuedPath = /);
  // Every reader that answers "what do the issued drawings say" uses the
  // combined rule; only the two places that REPORT a QA copy name it alone.
  const bare = src.split("\n").filter((l) => /isPreIssuePath\(/.test(l) && !/const is(PreIssue|NotIssued)Path/.test(l));
  assert.ok(bare.length <= 4, "isPreIssuePath used alone in " + bare.length + " places:\n" + bare.join("\n"));
  assert.match(src, /backgroundsExcluded/);
  assert.match(readFileSync(new URL("README.md", here), "utf8"), /drawingTier\.ts/);
  assert.match(readFileSync(new URL("../../../.claude/skills/qa-coordination-review/SKILL.md", here), "utf8"), /indexOnly/);
});
