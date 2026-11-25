// greetingFirstName() — the first name in an email's "Hi …,". Defined twice:
// SettyPMS.html (CRLF) and transmittal.html (CRLF). Both copies are sliced out
// of their pages and run against the same cases, so they cannot drift.
//
//   node --test greetingFirstName.test.mjs
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

// Slice from the suffix list to the end of greetingFirstName(): its closing
// brace is the first one at the start of a line after the declaration.
async function load(file) {
  const html = readFileSync(new URL("./" + file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const a = html.indexOf("const NAME_SUFFIX_RE =");
  const f = html.indexOf("function greetingFirstName(", a);
  const b = html.indexOf("\n}", f);
  assert.ok(a > 0 && f > a && b > f, "could not slice greetingFirstName out of " + file);
  assert.equal(html.indexOf("function greetingFirstName(", f + 1), -1, file + " defines greetingFirstName twice");
  const src = html.slice(a, b + 2) + "\nexport { greetingFirstName };";
  return (await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"))).greetingFirstName;
}

const copies = {
  "SettyPMS.html": await load("SettyPMS.html"),
  "transmittal.html": await load("transmittal.html"),
};

// Shapes taken from the PMS contact lists.
const CASES = [
  ["Rama, Monica", "Monica"],
  ["Bermudez , James", "James"],
  ["Millard Jensen , Gene", "Gene"],
  ["Schenne , John A.", "John"],
  ["Monica Rama", "Monica"],
  ["John Smith, PE", "John"],
  ["John Smith, P.E.", "John"],
  ["Kurt Bedore, Jr.", "Kurt"],
  ["Jane Doe, PhD", "Jane"],
  ["Smith, John, PE", "John"],
  ["Dr. Ann Lee", "Ann"],
  ["Rama,", "Rama"],
  ["", ""],
  [null, ""],
  [undefined, ""],
];

for (const [file, fn] of Object.entries(copies)) {
  test(file + ": greets by the given name", () => {
    for (const [name, want] of CASES) assert.equal(fn(name), want, JSON.stringify(name));
  });
}
