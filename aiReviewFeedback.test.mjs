// classifyAiReviewOutcome() in SettyPMS.html — how the saved response relates
// to Claude's suggested one, recorded to pms_ca_review_feedback on Save so the
// submittal-rfi-review skill can learn what gets edited.
//
//   node --test aiReviewFeedback.test.mjs
//
// Sliced out of SettyPMS.html (CRLF) and evaluated, so it cannot drift.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./SettyPMS.html", import.meta.url), "utf8");
const a = html.indexOf("function classifyAiReviewOutcome(");
const b = html.indexOf("function RFIDetailModal(");
assert.ok(a > 0 && b > a, "could not slice classifyAiReviewOutcome out of SettyPMS.html");
const src = html.slice(a, b) + "\nexport { classifyAiReviewOutcome };";
const { classifyAiReviewOutcome } = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

const suggested =
  "Neither proposed option is acceptable. A floor-mounted bottom-outlet water closet still places the waste " +
  "connection over Main Electrical Room 2-112D, and NEC 110.26(E) does not permit foreign systems in the dedicated space.";

test("identical text (whitespace aside) is accepted", () => {
  assert.equal(classifyAiReviewOutcome(suggested, suggested), "accepted");
  assert.equal(classifyAiReviewOutcome(suggested, "  " + suggested.replace(/ /g, "  ") + "\r\n"), "accepted");
});

test("suggestion kept with text around it, or lightly edited, is edited", () => {
  assert.equal(classifyAiReviewOutcome(suggested, "Per our call:\n\n" + suggested), "edited");
  const light = suggested.replace("Neither proposed option is acceptable.", "Neither option is acceptable.")
    .replace("foreign systems", "piping or other systems foreign to the electrical installation");
  assert.equal(classifyAiReviewOutcome(suggested, light), "edited");
});

test("a response written from scratch is replaced", () => {
  assert.equal(classifyAiReviewOutcome(suggested, "Provide the drip pan as proposed. See attached SK-P-12."), "replaced");
});

test("an empty side never counts as accepted", () => {
  assert.equal(classifyAiReviewOutcome("", suggested), "replaced");
  assert.equal(classifyAiReviewOutcome(suggested, ""), "replaced");
});
