// Tests for followups.ts: cadence, due and tone rules, and the kind guess.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  FOLLOWUP_KINDS, FOLLOWUP_CADENCE_DAYS, addDays, nextFollowupAfter, toneForReminder,
  daysOutstanding, isDue, guessKind,
} from "./followups.ts";

test("every kind has a cadence", () => {
  for (const k of FOLLOWUP_KINDS) assert.ok(FOLLOWUP_CADENCE_DAYS[k]?.length, k);
});

test("nextFollowupAfter walks the cadence and repeats the last step", () => {
  const from = "2026-10-01T00:00:00.000Z";
  assert.equal(nextFollowupAfter("payment", from, 0), "2026-10-04T00:00:00.000Z");
  assert.equal(nextFollowupAfter("payment", from, 1), "2026-10-13T00:00:00.000Z");
  assert.equal(nextFollowupAfter("payment", from, 2), "2026-10-16T00:00:00.000Z");
  assert.equal(nextFollowupAfter("payment", from, 9), "2026-10-16T00:00:00.000Z");
  assert.equal(nextFollowupAfter("signature", from, -1), "2026-10-06T00:00:00.000Z");
});

test("addDays rejects a bad date", () => {
  assert.throws(() => addDays("not a date", 1));
});

test("toneForReminder escalates", () => {
  assert.deepEqual([0, 1, 2, 5].map(toneForReminder), ["friendly", "firm", "escalate", "escalate"]);
});

test("daysOutstanding floors, clamps and tolerates missing dates", () => {
  const now = "2026-10-13T12:00:00.000Z";
  assert.equal(daysOutstanding("2026-10-06T13:00:00.000Z", now), 6);
  assert.equal(daysOutstanding("2026-10-20T00:00:00.000Z", now), 0);
  assert.equal(daysOutstanding(null, now), null);
  assert.equal(daysOutstanding("garbage", now), null);
});

test("isDue: open without a date is due, snoozed waits, resolved never", () => {
  const now = "2026-10-13T00:00:00.000Z";
  assert.equal(isDue({ status: "open" }, now), true);
  assert.equal(isDue({ status: "open", next_followup_at: "2026-10-14T00:00:00.000Z" }, now), false);
  assert.equal(isDue({ status: "snoozed", next_followup_at: "2026-10-12T00:00:00.000Z" }, now), true);
  assert.equal(isDue({ status: "snoozed", next_followup_at: "2026-10-15T00:00:00.000Z" }, now), false);
  assert.equal(isDue({ status: "snoozed" }, now), false);
  assert.equal(isDue({ status: "resolved", next_followup_at: "2026-01-01T00:00:00.000Z" }, now), false);
});

test("guessKind reads subject and attachment names", () => {
  assert.equal(guessKind("Homeport II Add Service 7 for signature"), "signature");
  assert.equal(guessKind("Invoice 3", []), "payment");
  assert.equal(guessKind("Re: scope", ["Agreement_signed.pdf"]), "signature");
  assert.equal(guessKind("Please confirm the schedule"), "info");
  assert.equal(guessKind("Hello"), "general");
  assert.equal(guessKind(null), "general");
});
