// Tests for meetingMinutes.ts (the rules behind file_meeting_minutes) and the
// places that must stay in step with it.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  MEETING_ITEM_TYPES, MEETING_NOTE_CATEGORY, MINUTES_MAX_ITEMS, isIsoDate, cleanMinutesItems,
  minutesSourceRef, resolveOwner, minutesNoteBody, dateAtNoonUtc,
} from "./meetingMinutes.ts";

const here = import.meta.url;
const read = (rel) => readFileSync(new URL(rel, here), "utf8");

test("isIsoDate accepts real dates only", () => {
  assert.equal(isIsoDate("2026-11-19"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("11/19/2026"), false);
  assert.equal(isIsoDate(null), false);
});

test("cleanMinutesItems normalises good items", () => {
  const { items, problems } = cleanMinutesItems([
    { type: "action_item", text: "  Send revised   panel schedule ", owner: " Mike ", dueDate: "2026-11-25", itemNumber: 3 },
    { type: "decision", text: "AHU-1 moves to the roof", dueDate: "" },
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(items[0], {
    type: "action_item", text: "Send revised panel schedule", owner: "Mike",
    ownerIsSetty: null, dueDate: "2026-11-25", itemNumber: "3",
  });
  assert.equal(items[1].owner, null);
  assert.equal(items[1].dueDate, null);
});

test("cleanMinutesItems reports every problem and files none of the bad ones", () => {
  const { items, problems } = cleanMinutesItems([
    { type: "todo", text: "x" },
    { type: "decision", text: "   " },
    { type: "action_item", text: "ok", dueDate: "next Friday" },
    { type: "open_question", text: "Who carries the fire alarm tie-in?" },
  ]);
  assert.equal(problems.length, 3);
  assert.equal(items.length, 1);
  assert.equal(cleanMinutesItems("nope").problems.length, 1);
  const many = Array.from({ length: MINUTES_MAX_ITEMS + 1 }, () => ({ type: "decision", text: "d" }));
  assert.match(cleanMinutesItems(many).problems[0], /limit/);
});

test("minutesSourceRef is stable across spacing and case, distinct across titles", () => {
  assert.equal(minutesSourceRef("2026-11-19", "OAC Meeting 12"), "manual|2026-11-19|oac-meeting-12");
  assert.equal(minutesSourceRef("2026-11-19", " oac  meeting-12 "), minutesSourceRef("2026-11-19", "OAC Meeting 12"));
  assert.notEqual(minutesSourceRef("2026-11-19", "OAC Meeting 12"), minutesSourceRef("2026-11-19", "Design coordination"));
  assert.equal(minutesSourceRef("2026-11-19", "!!!"), "manual|2026-11-19|meeting");
});

const STAFF = [
  { name: "Michael Chen", email: "MChen@setty.com" },
  { name: "Priya Chen", email: "pchen@setty.com" },
  { name: "Sara Arias", email: "sarias@setty.com" },
];
const CALLER = { name: "Sara Arias", email: "sarias@setty.com" };

test("resolveOwner: exact name, unique part name, me, the firm", () => {
  assert.deepEqual(resolveOwner("sara arias", STAFF, CALLER), { name: "Sara Arias", email: "sarias@setty.com", isSetty: true });
  assert.deepEqual(resolveOwner("Priya", STAFF, CALLER), { name: "Priya Chen", email: "pchen@setty.com", isSetty: true });
  assert.deepEqual(resolveOwner("me", STAFF, CALLER), { name: "Sara Arias", email: "sarias@setty.com", isSetty: true });
  assert.deepEqual(resolveOwner("Setty", STAFF, CALLER), { name: "Setty", email: null, isSetty: true });
});

test("resolveOwner: ambiguous and outside names stay external unless told otherwise", () => {
  // Two Chens: the last name alone names nobody.
  assert.deepEqual(resolveOwner("Chen", STAFF, CALLER), { name: "Chen", email: null, isSetty: false });
  assert.deepEqual(resolveOwner("Dattner", STAFF, CALLER), { name: "Dattner", email: null, isSetty: false });
  assert.deepEqual(resolveOwner("Mikey", STAFF, CALLER, true), { name: "Mikey", email: null, isSetty: true });
  assert.deepEqual(resolveOwner(null, STAFF, CALLER), { name: null, email: null, isSetty: false });
  // A first name inside a longer outside name must not match staff.
  assert.equal(resolveOwner("Sara Lopez", STAFF, CALLER).isSetty, false);
});

test("minutesNoteBody lists items under their headings and keeps the notes", () => {
  const body = minutesNoteBody({
    title: "OAC meeting 12", meetingDate: "2026-11-19", attendees: ["Sara Arias (Setty)", "D. Hill (Dattner)"],
    minutes: "Roof steel discussed.",
    items: [
      { type: "action_item", text: "Send LP-2 schedule", owner: "Michael Chen", ownerIsSetty: null, dueDate: "2026-11-25", itemNumber: null },
      { type: "decision", text: "AHU-1 moves to the roof", owner: null, ownerIsSetty: null, dueDate: null, itemNumber: "2.1" },
    ],
  });
  assert.equal(body, [
    "MEETING MINUTES: OAC meeting 12 (2026-11-19)",
    "Attendees: Sara Arias (Setty), D. Hill (Dattner)",
    "", "DECISIONS", "- 2.1 AHU-1 moves to the roof",
    "", "ACTION ITEMS", "- Send LP-2 schedule (Michael Chen, due 2026-11-25)",
    "", "NOTES", "Roof steel discussed.",
  ].join("\n"));
});

test("dateAtNoonUtc keeps the calendar day in US time zones", () => {
  assert.equal(dateAtNoonUtc("2026-11-19"), "2026-11-19T12:00:00.000Z");
});

// ── drift: the schema, the web app, the tool and the skill agree ────────────
test("item types and source match the meeting_minutes migration", () => {
  const sql = read("../../migrations/20260920130000_meeting_minutes_schema.sql");
  assert.ok(sql.includes(`array[${MEETING_ITEM_TYPES.map((t) => `'${t}'`).join(",")}]`));
  assert.match(sql, /'manual'/);
});

test("note categories exist in the PMS", () => {
  const pms = read("../../../SettyPMS.html");
  const list = pms.match(/const NOTE_CATEGORIES = \[(.*?)\]/)[1];
  for (const c of Object.values(MEETING_NOTE_CATEGORY)) assert.ok(list.includes(`"${c}"`), c);
});

test("the tool confirms through the cascade and holds carried-forward matches", () => {
  const src = read("./index.ts");
  const at = src.indexOf('mcp.tool("file_meeting_minutes"');
  assert.ok(at > 0);
  const tool = src.slice(at, src.indexOf("\nmcp.tool(", at + 10));
  // Items are inserted as suggested and THEN patched: the cascade trigger is
  // BEFORE UPDATE, so inserting 'confirmed' directly would track nothing.
  assert.match(tool, /status: "suggested"/);
  assert.match(tool, /carried_from_item_id=is\.null/);
  assert.match(tool, /meeting_items\.review/);
  assert.match(tool, /projects\.edit/);
  assert.match(read("../../migrations/20260920130000_meeting_minutes_schema.sql"), /before update on public\.pms_meeting_items/);
});

test("the skill files through the tool and only after approval", () => {
  const skill = read("../../../.claude/skills/meeting-minutes/SKILL.md");
  assert.match(skill, /file_meeting_minutes/);
  assert.match(skill, /confirmed: true/);
  assert.match(skill, /heldForReview/);
});
