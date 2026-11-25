// The Accolade-O-Meter block in the Monday digest (pms-user-emails/wallDigest.ts).
//
//   node --test wallDigest.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFeatured, wallBlock } from "./supabase/functions/pms-user-emails/wallDigest.ts";

const rows = [
  { id: 1, quote: "Great job on the RFI log", kind: "client", recipients: ["Ana Diaz"], recipient_emails: ["ana@setty.com"], from_name: "Pat", from_company: "Acme", created_at: "2026-11-23T10:00:00Z" },
  { id: 2, quote: "Thanks for staying late", kind: "internal", recipients: ["Bo Chen"], recipient_emails: ["bo@setty.com"], created_by_name: "Cy Roe", created_at: "2026-11-24T10:00:00Z" },
  { id: 3, quote: "Quick turnaround <3", kind: "client", recipients: ["Bo Chen"], recipient_emails: ["bo@setty.com"], created_at: "2026-11-25T10:00:00Z" },
];

test("the most-cheered accolade is featured, newest on a tie", () => {
  assert.equal(pickFeatured(rows, { 1: 3, 2: 1 }, "x@setty.com").id, 1);
  assert.equal(pickFeatured(rows, {}, "x@setty.com").id, 3);
  assert.equal(pickFeatured([], {}, "x@setty.com"), null);
});

test("one that names the reader is skipped while there is another", () => {
  assert.equal(pickFeatured(rows, { 1: 3 }, "ANA@setty.com").id, 3);
  assert.equal(pickFeatured([rows[0]], {}, "ana@setty.com").id, 1);   // the only one: still shown
});

test("the block shows the week, the quote, and a nudge that fits the reader", () => {
  const w = { rows, cheers: { 2: 2 }, players: 4, loggers: new Set(["cy@setty.com"]) };
  const html = wallBlock(w, "dee@setty.com", "https://example.test/Accolades.html");
  assert.match(html, /3 accolades last week · 4 people played the daily guess/);
  assert.match(html, /Thanks for staying late/);
  assert.match(html, /For Bo Chen — from Cy Roe/);
  assert.match(html, /Who helped you out this week\?/);                // never logged one
  assert.match(wallBlock(w, "Cy@Setty.com", "u"), /Who else deserves one this week\?/);
  assert.match(html, /href="https:\/\/example.test\/Accolades.html"/);
});

test("a quiet week still nudges, and quotes are escaped", () => {
  const quiet = wallBlock({ rows: [], cheers: {}, players: 0, loggers: new Set() }, "a@setty.com", "u");
  assert.match(quiet, /A quiet week on the wall\./);
  assert.doesNotMatch(quiet, /For /);
  const one = wallBlock({ rows: [rows[2]], cheers: {}, players: 1, loggers: new Set() }, "a@setty.com", "u");
  assert.match(one, /1 accolade last week · 1 person played/);
  assert.match(one, /&lt;3/);
  assert.match(one, /from a client/);
});
