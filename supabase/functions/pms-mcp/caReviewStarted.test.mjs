// Drift anchors for mark_ca_review_started — the "Claude is reviewing" stamp.
//
//   node --test supabase/functions/pms-mcp/caReviewStarted.test.mjs
//
// The PMS, the Tracker and the Outlook add-in derive the review state from
// three stamps on the item (aiReviewRequested, aiReviewStarted, aiReview); the
// skill must call the tool first and every "Send to Claude" prompt must say so,
// or the pages fall back to "waiting" with no way to tell a stall from a request
// that never arrived.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const src = readFileSync(join(here, "index.ts"), "utf8");

test("mark_ca_review_started is registered, guarded and writes only the start stamp", () => {
  assert.ok(src.includes('mcp.tool("mark_ca_review_started"'), "tool missing");
  const body = src.slice(src.indexOf('mcp.tool("mark_ca_review_started"'), src.indexOf('mcp.tool("backload_ca_item"'));
  assert.ok(body.includes("qaLedgerCaller()"), "must be signed-in only, like save_ca_review");
  assert.ok(body.includes("updateProjectRecord(pid"), "must go through the version-guarded record write");
  assert.ok(body.includes("aiReviewStarted: { at, by: who.email }"), "stamp shape changed");
  assert.ok(!body.includes("aiReview:"), "must not touch aiReview itself");
});

test("the review can find the contractor's files from the record", () => {
  assert.ok(src.includes("spFolderUrl: item.spFolderUrl, filesNote:"), "read_rfi_submittal no longer returns the item's folder");
  assert.ok(/folderUrl:\s*z\.string\(\)\.optional\(\)/.test(src), "list_project_documents lost its folderUrl mode");
  assert.ok(src.includes("/shares/${encodeURIComponent(shareToken(url))}/driveItem"), "folderUrl must resolve through the Graph shares API");
  const skill = readFileSync(join(root, ".claude/skills/submittal-rfi-review/SKILL.md"), "utf8");
  assert.ok(skill.includes("folderUrl: spFolderUrl"), "skill must open the item's folder by URL");
  assert.ok(skill.indexOf("in the item's folder first") < skill.indexOf("If the reviewer attached the PDF"), "folder must come before the attachment fallback");
  for (const f of ["SettyPMS.html", "RFISubmittalSync_Preview.html"]) {
    const page = readFileSync(join(root, f), "utf8");
    assert.ok(!page.includes("if I attach the PDF"), f + " prompt still asks for an attachment first");
    assert.ok(page.includes("filed in the item's SharePoint folder"), f + " prompt must point Claude at the item's folder");
  }
});

test("the skill calls it first and every Send-to-Claude prompt names it", () => {
  const skill = readFileSync(join(root, ".claude/skills/submittal-rfi-review/SKILL.md"), "utf8");
  assert.ok(skill.indexOf("`mark_ca_review_started`") < skill.indexOf("`read_rfi_submittal` (project + type + number)"), "skill must call mark_ca_review_started before read_rfi_submittal");
  for (const f of ["SettyPMS.html", "RFISubmittalSync_Preview.html"]) {
    const page = readFileSync(join(root, f), "utf8");
    assert.ok(page.includes("mark_ca_review_started"), f + " review prompt no longer asks Claude to mark the review started");
  }
});
