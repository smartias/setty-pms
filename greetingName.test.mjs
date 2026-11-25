// greetingName.js: the first name for "Hi …,", plus checks that every page
// that greets loads the shared script instead of keeping its own copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// A plain browser script: run it the way a page does and read the global.
const SRC = readFileSync(new URL("./greetingName.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(SRC, sandbox);
const { greetingFirstName } = sandbox;

test("First Last takes the first word", () => {
  assert.equal(greetingFirstName("Chris Hardy"), "Chris");
  assert.equal(greetingFirstName("  Chris   Hardy  "), "Chris");
  assert.equal(greetingFirstName("Cher"), "Cher");
});

test("Last, First takes the part after the comma", () => {
  assert.equal(greetingFirstName("Rama, Monica"), "Monica");
  assert.equal(greetingFirstName("Bermudez , James"), "James");
  assert.equal(greetingFirstName("Rama,Monica"), "Monica");
  assert.equal(greetingFirstName("Van Der Berg, Anna Marie"), "Anna");
});

test("credentials and suffixes after a comma are not names", () => {
  assert.equal(greetingFirstName("John Smith, PE"), "John");
  assert.equal(greetingFirstName("Jane Doe, P.E."), "Jane");
  assert.equal(greetingFirstName("Pat Lee, AIA"), "Pat");
  assert.equal(greetingFirstName("Kurt Bedore, Jr."), "Kurt");
  assert.equal(greetingFirstName("Sam Ortiz, PhD"), "Sam");
  assert.equal(greetingFirstName("Ana Cruz, LEED AP"), "Ana");
  assert.equal(greetingFirstName("Lee, Ann, AIA"), "Ann");
  assert.equal(greetingFirstName("Lee, Ann, P.E., LEED AP"), "Ann");
});

test("a leading title and trailing punctuation are dropped", () => {
  assert.equal(greetingFirstName("Dr. Ann Lee"), "Ann");
  assert.equal(greetingFirstName("Ms Ann Lee"), "Ann");
  assert.equal(greetingFirstName("Smith, Dr. Jane"), "Jane");
  assert.equal(greetingFirstName("Bob; Jones"), "Bob");
});

test("no usable name gives an empty string, so the caller picks its fallback", () => {
  for (const v of ["", "   ", null, undefined, ",", "PE", ", PE"]) {
    assert.equal(greetingFirstName(v), "", JSON.stringify(v));
  }
});

test("an email address is not a name", () => {
  assert.equal(greetingFirstName("monica.rama@example.com"), "");
  assert.equal(greetingFirstName("Rama, Monica <monica@example.com>"), "Monica");
  assert.equal(greetingFirstName("<monica@example.com>"), "");
});

test("only the function leaks into the page's global scope", () => {
  assert.deepEqual(Object.keys(sandbox), ["greetingFirstName"]);
});

test("every page that greets loads greetingName.js and keeps no copy", () => {
  for (const page of ["SettyPMS.html", "transmittal.html", "Newsletter.html"]) {
    const html = readFileSync(new URL("./" + page, import.meta.url), "utf8");
    const load = html.indexOf('<script src="greetingName.js"></script>');
    assert.ok(load !== -1, page + " loads greetingName.js");
    assert.ok(!/function greetingFirstName\s*\(/.test(html), page + " has no copy of greetingFirstName");
    assert.ok(!/NAME_SUFFIX_RE/.test(html), page + " has no copy of the suffix list");
    // A real call ("= greetingFirstName(", "=> greetingFirstName("), not a comment that names it.
    const firstUse = html.search(/[=(>]\s*greetingFirstName\(/);
    assert.ok(firstUse !== -1, page + " calls greetingFirstName");
    assert.ok(firstUse > load, page + " calls greetingFirstName after the script tag");
  }
});
