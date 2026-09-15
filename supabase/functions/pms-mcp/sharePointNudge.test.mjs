// Drift anchors for the SharePoint adoption reminder (1.19.1): one string,
// attached wherever a result came off the office drive or a project has
// nothing filed, so the model can pass it on to the person.
//
//   node supabase/functions/pms-mcp/sharePointNudge.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf8");

// The one string, and what it must keep saying.
assert.ok(src.includes("const SHAREPOINT_NUDGE ="), "the reminder constant exists");
const start = src.indexOf("const SHAREPOINT_NUDGE =");
const text = src.slice(start, src.indexOf(";", start));
for (const phrase of [
  "once per conversation",              // paced by the model, never nagging
  "read-only",                          // the drive's limitation, plainly
  "found by name only",
  "emails kept there are invisible",
  "Setty PMS Outlook add-in",           // the concrete action for emails
  "SharePoint folder",                  // the concrete action for documents
]) assert.ok(text.includes(phrase), `reminder text lost: ${phrase}`);
assert.ok(text.length < 700, "the reminder stays short enough to relay");

// Where it is attached. Each site is a moment the drive's limits are felt.
for (const anchor of [
  // list_project_documents: every drive listing, both drive refusals, and a SharePoint project with a drive annex
  "await azureResolveSubfolder(az.ctx, dec.relPath, relIn))), reminder: SHAREPOINT_NUDGE });",
  "reminder: SHAREPOINT_NUDGE,\n            ...(others.length",
  'or a folderId from a prior listing.", note: AZURE_LIMITED_NOTE, reminder: SHAREPOINT_NUDGE });',
  "note: AZURE_LIMITED_NOTE, reminder: SHAREPOINT_NUDGE });",
  "...(annex && (annex as any).available ? { reminder: SHAREPOINT_NUDGE } : {}),",
  // read_document on a drive file (base spreads into every result shape)
  "sharePath: sharePathOf(az.ctx.share, dec.relPath), reminder: SHAREPOINT_NUDGE };",
  // find_document on a drive project
  "...(onDrive ? { reminder: SHAREPOINT_NUDGE } : {}),",
  // emails: an empty log is the moment to say where emails come from
  "This log only holds emails filed with the Setty PMS Outlook add-in",
  "No emails are filed for this project.",
  // project_briefing with no minutes or no emails to draw on
  "...(!docs.items.length || !mail.length ? { reminder: SHAREPOINT_NUDGE } : {}),",
  // the SharePoint-only writes, refused on a drive
  'nextStep: "Transmittal staging needs the project\'s Outgoing folder in its region\'s SharePoint site.", reminder: SHAREPOINT_NUDGE });',
  'nextStep: "Filing needs the project record in SharePoint.", reminder: SHAREPOINT_NUDGE });',
  "or save it under the project's SharePoint record if it has one.\", reminder: SHAREPOINT_NUDGE });",
]) {
  assert.ok(src.includes(anchor), `index.ts lost a reminder site: ${JSON.stringify(anchor)}`);
}
const sites = src.split("SHAREPOINT_NUDGE").length - 1;
assert.ok(sites >= 14, `expected the reminder at 13+ sites plus its definition, found ${sites} mentions`);

// The successful SharePoint paths must NOT carry it: nagging people who
// already save to SharePoint is how a reminder gets ignored.
const spListing = src.slice(src.indexOf("const drives = await siteDrives(team);"), src.indexOf("const annex = region.shares.length"));
assert.ok(!spListing.includes("SHAREPOINT_NUDGE"), "SharePoint folder listings stay reminder-free");

console.log("sharePointNudge.test.mjs: all assertions passed");
