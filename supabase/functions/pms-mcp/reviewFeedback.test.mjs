// search_review_feedback: the sentence-level delta between a Claude
// suggestion and what the reviewer saved (feedbackDelta in index.ts).
//
//   node --test supabase/functions/pms-mcp/reviewFeedback.test.mjs
//
// The helpers are COPIED below (index.ts boots a server at import) with a
// drift anchor: the test fails if index.ts no longer carries the same bodies.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

function splitSentences(s) {
  return String(s || "").replace(/\s+/g, " ")
    .split(/(?<=[.;:!?])\s+(?=[A-Z0-9"(])/)
    .map((x) => x.trim()).filter((x) => x.length > 2);
}
function feedbackDelta(suggested, final) {
  const a = splitSentences(suggested), b = splitSentences(final);
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
  const sa = new Set(a.map(norm)), sb = new Set(b.map(norm));
  return { removed: a.filter((x) => !sb.has(norm(x))), added: b.filter((x) => !sa.has(norm(x))) };
}

test("drift anchor: index.ts carries the same helper bodies", () => {
  for (const line of [
    '.split(/(?<=[.;:!?])\\s+(?=[A-Z0-9"(])/)',
    'const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\\s+/g, " ").trim();',
    "return { removed: a.filter((x) => !sb.has(norm(x))), added: b.filter((x) => !sa.has(norm(x))) };",
    'mcp.tool("search_review_feedback", {',
  ]) assert.ok(src.includes(line), "index.ts drifted: " + line);
});

const suggested =
  "Per RFI-121, the piping is routed in the wet wall. Neither proposed option is acceptable. " +
  "A drip pan is not a permitted means of routing piping through that space. No work shall proceed without written direction.";

test("the sentences Ben cut and the one he added come back, kept ones do not", () => {
  const final =
    "Neither proposed option is acceptable. A drip pan is not a permitted means of routing piping through that space. " +
    "Setty has proposed to the Architect extending the wet wall so the stack offsets around the structure.";
  const d = feedbackDelta(suggested, final);
  assert.deepEqual(d.removed, [
    "Per RFI-121, the piping is routed in the wet wall.",
    "No work shall proceed without written direction.",
  ]);
  assert.deepEqual(d.added, ["Setty has proposed to the Architect extending the wet wall so the stack offsets around the structure."]);
});

test("re-wrapped or re-punctuated sentences count as kept", () => {
  const final = suggested.split(". ").join(".\r\n\r\n").replace("RFI-121,", "RFI-121");
  const d = feedbackDelta(suggested, final);
  assert.deepEqual(d, { removed: [], added: [] });
});

test("empty sides", () => {
  assert.deepEqual(feedbackDelta("", "Anything."), { removed: [], added: ["Anything."] });
  assert.deepEqual(feedbackDelta(suggested, ""), { removed: splitSentences(suggested), added: [] });
});
