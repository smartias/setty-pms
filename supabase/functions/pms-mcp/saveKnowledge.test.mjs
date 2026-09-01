// Tests for save_knowledge's guard logic in index.ts — the near-duplicate
// overlap measure and the handler's refusal order (identity → project HIDE →
// capability → queue ceiling → duplicate → insert).
//
//   node supabase/functions/pms-mcp/saveKnowledge.test.mjs
//
// The functions are COPIED below, same reason as the other pms-mcp tests:
// index.ts boots a server at import. Drift checks at the bottom.

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

// ── copies from index.ts ────────────────────────────────────────────────────
const KNOWLEDGE_DUP_THRESHOLD = 0.7;
function knowledgeWords(s) {
  return new Set(
    String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
      .filter((w) => w.length > 2),
  );
}
function knowledgeOverlap(a, b) {
  const A = knowledgeWords(a), B = knowledgeWords(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}
const isDup = (a, b) => knowledgeOverlap(a, b) >= KNOWLEDGE_DUP_THRESHOLD;

// ── 1. Restatements are caught ──────────────────────────────────────────────
check(isDup(
  "DASNY requires the cover sheet to list every discipline's sheet count before review.",
  "The DASNY reviewer requires that the cover sheet list every discipline's sheet count before their review starts.",
), "a padded restatement of the same finding is a duplicate");
check(isDup(
  "Phase 1 hydraulic constraint still governs Phase 3 riser sizing.",
  "Note: the Phase 1 hydraulic constraint still governs the Phase 3 riser sizing!",
), "punctuation and filler words do not defeat the check");
check(isDup("SCA wants closeout billing split by discipline.",
            "SCA wants closeout billing split by discipline."),
  "an exact duplicate is a duplicate");

// ── 2. Distinct findings in the same scope pass ─────────────────────────────
check(!isDup(
  "DASNY requires the cover sheet to list every discipline's sheet count.",
  "DASNY comment responses must be returned in DrChecks within 14 days.",
), "two different DASNY facts are not duplicates");
check(!isDup(
  "The chiller plant serves buildings A and B through a shared header.",
  "Bulletin 13 superseded the ground floor electrical power plan.",
), "unrelated findings are not duplicates");

// ── 3. Degenerate inputs never divide by zero or match everything ───────────
check(knowledgeOverlap("", "anything at all here") === 0, "empty summary scores 0");
check(knowledgeOverlap("a an of to", "a an of to") === 0, "only-short-words scores 0 (no meaningful words)");
check(knowledgeOverlap("x", "x") === 0, "1-2 char tokens are ignored entirely");

// ── 4. Containment, not Jaccard: a superset restatement is still caught ─────
const short = "DASNY requires wet stamps on the fire protection narrative.";
const long = short + " This came up on Boylan Hall and again on Tabler Quad; the PDF signature was rejected both times by the Albany office reviewer.";
check(isDup(short, long), "a longer entry containing the short one is a duplicate (containment)");

// ── 5. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has("const KNOWLEDGE_DUP_THRESHOLD = 0.7;", "duplicate threshold");
has(".filter((w) => w.length > 2),", "meaningful-word filter");
has("return inter / Math.min(A.size, B.size);", "containment denominator");
has('status: "suggested",          // hardwired: this tool cannot publish', "suggested-only insert");
has('mcp.tool("save_knowledge"', "save_knowledge is still registered");
// The refusal ORDER is load-bearing: identity before caps (an anonymous
// caller must never learn what a role could do), project resolution before
// caps (HIDE must not leak that a project exists via a capability error).
const idxIdentity = shipped.indexOf("save_knowledge requires a signed-in user");
const idxProject = shipped.indexOf('error: `No project matching "${projectNumber}"`,\n          nextStep: "search_projects finds projects');
const idxCap = shipped.indexOf("knowledge.contribute capability");
const idxCeiling = shipped.indexOf("suggested entries awaiting review");
const idxDup = shipped.indexOf("possibleDuplicate: {");
check(idxIdentity > 0 && idxProject > idxIdentity && idxCap > idxProject &&
      idxCeiling > idxCap && idxDup > idxCeiling,
  "handler guard order is identity → project HIDE → capability → ceiling → duplicate");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);
