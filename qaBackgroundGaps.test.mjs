// qaBackgroundGaps.js: which other disciplines' drawings a QA review could not
// check against, read from its checklist notes, for the top of the QA tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./qaBackgroundGaps.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(SRC, sandbox);
// Arrays made inside the sandbox fail deepStrictEqual on prototype; copy out.
const qaBackgroundGaps = (...args) => JSON.parse(JSON.stringify(sandbox.qaBackgroundGaps(...args)));

const row = (itemId, disposition, note) => ({ itemId, disposition, note });
const keys = (gaps) => gaps.map((g) => g.key);
const itemsOf = (gaps, key) => (gaps.find((g) => g.key === key) || { items: [] }).items;

// Notes as real reviews wrote them (review 108, SAPX246004.00; review 68,
// SAPX256011.00), before the skill had a fixed wording.
test("free-form notes from recorded reviews are read", () => {
  const results = [
    row("qa-083", "not attempted", "No RCP on file."),
    row("qa-613", "not attempted", "No structural set."),
    row("qa-612", "not attempted", "No life safety plan."),
    row("qa-616", "partial", "Room names consistent across M, SP, FA schedules; EUH-2-1 location text wrong (P-23); not checked vs architecture."),
    row("qa-615", "not attempted", "Architectural plans/elevations not in hand."),
    row("qa-084", "not attempted", "No RCP or structural set."),
    row("qa-102", "partial", "Slab/wall penetration details M-602 det 2/3; locations not coordinated (no backgrounds)."),
    row("qa-610", "not attempted", "No architectural plans, door hardware or Div 08/10/11/12/14 specs on file."),
    row("qa-092", "not attempted", "Needs RCP."),
    row("qa-614", "not attempted", "RCPs and sections not in hand."),
    row("qa-210", "not attempted", "No structural drawings in record."),
  ];
  const gaps = qaBackgroundGaps(results);
  assert.deepEqual(keys(gaps), ["arch", "ls", "struct", "specs", "other"]);
  assert.deepEqual(itemsOf(gaps, "arch"), ["qa-083", "qa-616", "qa-615", "qa-084", "qa-610", "qa-092", "qa-614"]);
  assert.deepEqual(itemsOf(gaps, "struct"), ["qa-613", "qa-084", "qa-210"]);
  assert.deepEqual(itemsOf(gaps, "ls"), ["qa-612"]);
  assert.deepEqual(itemsOf(gaps, "specs"), ["qa-610"]);
  // "no backgrounds" with no discipline named lands in the catch-all only.
  assert.deepEqual(itemsOf(gaps, "other"), ["qa-102"]);
  assert.ok(gaps.every((g) => g.stale === false));
});

test("the skill's fixed wording, and drawings that are there but out of date", () => {
  const gaps = qaBackgroundGaps([
    row("qa-613", "not attempted", "Missing background: Structural (framing plans). No S sheets anywhere in the project folder."),
    row("qa-614", "partial", "Stale background: Architectural RCPs dated 2025-03-02, older than our 2025-09 issue; corridors checked only."),
  ]);
  assert.deepEqual(keys(gaps), ["arch", "struct"]);
  assert.equal(gaps.find((g) => g.key === "arch").stale, true);
  assert.equal(gaps.find((g) => g.key === "struct").stale, false);
});

test("clean, finding and n/a rows never count, nor notes that do not say anything is missing", () => {
  const gaps = qaBackgroundGaps([
    row("qa-613", "clean", "Compared M-101 against S-101 framing dated 2026-03-01; no conflicts."),
    row("qa-612", "finding", "Fire damper missing at the 2-hour shaft on the life safety plan (P-4)."),
    row("qa-110", "n/a", "No roof work."),
    row("qa-616", "partial", "Room names checked against the architectural plans for floors 1-2; floors 3-4 not reached (budget)."),
    row("qa-040", "not attempted", "Out of budget."),
  ]);
  assert.deepEqual(gaps, []);
});

test("the coverage line names missing sets too, clause by clause", () => {
  const gaps = qaBackgroundGaps([], "Index coverage 42/42. No structural or civil backgrounds found in the project folder; architectural set dated 2026-01-10 used.");
  assert.deepEqual(keys(gaps), ["struct", "civil"]);
  assert.deepEqual(itemsOf(gaps, "struct"), []);
});

test("an item is listed once per discipline; bad input is harmless", () => {
  const gaps = qaBackgroundGaps([
    row("qa-080", "not attempted", "No RCP on file."),
    row("qa-080", "not attempted", "No RCP on file."),
    null,
    { disposition: "not attempted", note: "No RCP." },
  ]);
  assert.deepEqual(itemsOf(gaps, "arch"), ["qa-080"]);
  assert.deepEqual(qaBackgroundGaps(null, null), []);
  assert.deepEqual(qaBackgroundGaps("x"), []);
});

// The page loads the shared script and does not keep its own copy.
test("SettyPMS.html loads qaBackgroundGaps.js and calls it", () => {
  const page = readFileSync(new URL("./SettyPMS.html", import.meta.url), "utf8");
  assert.match(page, /<script src="qaBackgroundGaps\.js"><\/script>/);
  assert.match(page, /qaBackgroundGaps\(/);
  assert.doesNotMatch(page, /function qaBackgroundGaps\b/);
});
