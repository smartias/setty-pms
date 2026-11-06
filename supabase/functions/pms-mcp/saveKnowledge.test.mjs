// Tests for save_knowledge's guard logic in index.ts — the near-duplicate
// overlap measure, the sensitive-terms publishing gate, and the handler's
// refusal order (identity → project HIDE → capability → queue ceiling →
// duplicate → insert).
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

const KNOWLEDGE_SENSITIVE_TERMS = [
  ["contract", /\bcontracts?\b(?!\s+(?:documents?|drawings?|dwgs?|sets?|specs?|specifications?|plans?)\b)/i],
  ["contractual", /\bcontractual(?:ly)?\b/i],
  ["MSA", /\bMSAs?\b/i],
  ["subagreement", /\bsub-?agreements?\b/i],
  ["agreement", /\b(?:master|services?|sub-?consultant|prime|teaming|consulting)\s+agreements?\b/i],
  ["indemnification", /\bindemn/i],
  ["liability", /\bliabilit(?:y|ies)\b|\bliable\b/i],
  ["hold harmless", /\bhold\s+harmless\b/i],
  ["insurance", /\binsur(?:ance|ed|ers?)\b/i],
  ["subrogation", /\bsubrogation\b/i],
  ["deductible", /\bdeductibles?\b/i],
  ["claim notice", /\bclaims?\s+notice|\bnotice\s+of\s+claims?\b/i],
  ["dispute", /\bdisput(?:e|es|ed|ing)\b/i],
  ["arbitration", /\barbitrat/i],
  ["litigation", /\blitigat/i],
  ["attorney", /\battorneys?\b|\blegal\s+counsel\b/i],
  ["lien", /\bliens?\b/i],
  ["NDA", /\bNDAs?\b|\bnon-?disclosure\b/i],
  ["do not share", /\bdo\s+not\s+share\b|\bdon['\u2019]?t\s+share\b|\bnot\s+for\s+(?:distribution|circulation)\b|\binternal\s+(?:use\s+)?only\b/i],
  ["confidential", /\bconfidential/i],
  ["privileged", /\bprivileged\b/i],
];
function knowledgeSensitiveTerm(...fields) {
  const text = fields.filter(Boolean).join(" ");
  if (!text) return null;
  for (const [label, re] of KNOWLEDGE_SENSITIVE_TERMS) if (re.test(text)) return label;
  return null;
}
// The handler's publish rule, with the three inputs it reads.
const publishStatus = ({ pn, isAutomated, summary, source }) => {
  const sensitiveTerm = knowledgeSensitiveTerm(summary, source);
  return pn && !isAutomated && !sensitiveTerm ? "approved" : "suggested";
};

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

// ── 5. Sensitive-terms gate: the SAPX256014.00 incident never publishes ────
// The two entries that went live on 2026-10-30 / 2026-11-02 carried MSA and
// subagreement terms, liability caps, insurance limits, a dispute narrative
// and "do not share internally". Each of those alone must hold the entry.
const INCIDENT = [
  "Fire protection subagreement terms: the MSA caps the sub's fee at the prime's rate card and flows down the prime's schedule.",
  "Liability cap under the subagreement is $1M aggregate; professional liability insurance limit $2M per claim, $50k deductible.",
  "Internal dispute with the prime over the sprinkler scope creep — PM believes we are owed an add service. Do not share internally beyond the PM group.",
  "Certificate of insurance was late; the owner's claim notice on the standpipe leak names both firms.",
  "Draft indemnification language proposed by the owner's attorney is one-sided; hold harmless runs only to the owner.",
  "Confidential: owner is weighing litigation against the GC over the fire pump; our counsel says keep notes factual.",
];
for (const t of INCIDENT) {
  check(knowledgeSensitiveTerm(t) !== null, "incident text is caught: " + t.slice(0, 50));
  check(publishStatus({ pn: "SAPX256014.00", isAutomated: false, summary: t }) === "suggested",
    "project-scoped incident text is held as suggested: " + t.slice(0, 50));
}
check(publishStatus({ pn: "SAPX256014.00", isAutomated: false,
  summary: "Standpipe riser relocated to the east stair per RFI 044.",
  source: "MSA Exhibit B, section 4.2 (fee schedule)" }) === "suggested",
  "a sensitive term in the SOURCE field alone holds the entry");
check(knowledgeSensitiveTerm("Fire pump controller", "see contract value table") === "contract",
  "the returned label names the matched term");

// Each term the task names fires on its own.
for (const [label, sample] of [
  ["contract", "The contract value increased by $40k with CO-3."],
  ["MSA", "Per the MSA, invoices go to the prime monthly."],
  ["subagreement", "The sub-agreement runs through 2027."],
  ["indemnification", "Owner wants mutual indemnity."],
  ["liability", "Limitation of liability was struck."],
  ["insurance", "Additional insured endorsement required."],
  ["deductible", "Deductible is $25,000 per occurrence."],
  ["claim notice", "Notice of claim must be given in 21 days."],
  ["dispute", "The fee is disputed by the owner."],
  ["do not share", "Internal only — do not share with the GC."],
  ["confidential", "Confidentiality clause covers all drawings."],
]) check(knowledgeSensitiveTerm(sample) === label, `term "${label}" fires on: ${sample}`);

// ── 6. Ordinary CA language stays live: the gate must not swallow Sara's
//        2026-09-01 scoped-publishing rule for everyday project findings ──
const CLEAN = [
  "Per the contract documents, the subcontractor coordinates the FP riser with structural steel; the contractor's RFI 042 confirmed.",
  "Contract drawings show the fire pump in B-12; the contract set issued 2026-03-01 governs.",
  "Owner is in agreement with the VFD substitution after the harmonics study.",
  "Building settlement cracked the slab at grid C-4; cable terminations at panel LP-2 were redone.",
  "The contractor claims the duct does not fit above the corridor ceiling; field verify before CO.",
  "DASNY requires wet stamps on the fire protection narrative.",
  "Insulation on chilled water is 1.5 inch per the spec; insulate the condensate drain too.",
  "Phase 1 hydraulic constraint still governs Phase 3 riser sizing.",
];
for (const t of CLEAN) {
  check(knowledgeSensitiveTerm(t) === null, "ordinary CA language is NOT caught: " + t.slice(0, 50));
  check(publishStatus({ pn: "SAPX196006.00", isAutomated: false, summary: t }) === "approved",
    "a clean project-scoped save still publishes: " + t.slice(0, 50));
}
check(knowledgeSensitiveTerm("", null, undefined) === null, "empty fields are clean, not an error");

// ── 7. The existing gates are unchanged by the new one ──────────────────────
check(publishStatus({ pn: null, isAutomated: false, summary: "DASNY requires wet stamps." }) === "suggested",
  "firm/agency-wide (no project) still queues");
check(publishStatus({ pn: "SAPX196006.00", isAutomated: true, summary: "Riser relocated per RFI 044." }) === "suggested",
  "automated project-scoped saves still queue");
check(publishStatus({ pn: "SAPX196006.00", isAutomated: true, summary: "MSA fee cap applies." }) === "suggested",
  "automated + sensitive queues (no double-publish path)");

// ── 8. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has("const KNOWLEDGE_DUP_THRESHOLD = 0.7;", "duplicate threshold");
has(".filter((w) => w.length > 2),", "meaningful-word filter");
has("return inter / Math.min(A.size, B.size);", "containment denominator");
// Scoped publishing: a project entry publishes on the user's yes; anything
// without a project stays a suggestion for review — and automated/pipeline
// entries ALWAYS stay suggestions (Sara, 2026-09-06), landing as origin
// 'mined' so the review screen badges and filters the machine stream.
has('const sensitiveTerm = knowledgeSensitiveTerm(summary, source);', "gate reads summary AND source");
has('const status = pn && !isAutomated && !sensitiveTerm ? "approved" : "suggested";', "scoped publish rule with automated + sensitive-terms gates");
has('...(sensitiveTerm ? { heldForReview: "sensitive-terms", matchedTerm: sensitiveTerm } : {}),', "response names the matched term");
has('"Queued as a SUGGESTION — NOT live. The text reads like contract, insurance or legal content "', "sensitive-terms note tells the model it is queued, not shared");
// The pattern table itself must match this copy term for term, or the tests
// above prove nothing about production.
{
  const start = shipped.indexOf("const KNOWLEDGE_SENSITIVE_TERMS");
  const end = shipped.indexOf("];", start);
  const shippedTable = shipped.slice(start, end);
  for (const [label, re] of KNOWLEDGE_SENSITIVE_TERMS) {
    check(shippedTable.includes(`["${label}", ${re.toString()}]`), `sensitive term "${label}" pattern has DRIFTED from this test's copy`);
  }
  const shippedCount = (shippedTable.match(/^\s+\["/gm) || []).length;
  check(shippedCount === KNOWLEDGE_SENSITIVE_TERMS.length, `shipped table has ${shippedCount} terms, this copy has ${KNOWLEDGE_SENSITIVE_TERMS.length}`);
}
has('origin: isAutomated ? "mined" : "connector",', "automated entries land as origin mined");
has("const KNOWLEDGE_MAX_PENDING_AUTOMATED = 50;", "separate automated ceiling");
has('"pms_lessons?select=lesson_id&status=eq.suggested&origin=eq." + (isAutomated ? "mined" : "connector")',
  "per-lane ceiling counting (pipeline floods never block hand saves)");
has("NOT your private conversation memory", "anti-memory routing in the description");
has('mcp.tool("save_knowledge"', "save_knowledge is still registered");
// The refusal ORDER is load-bearing: identity before caps (an anonymous
// caller must never learn what a role could do), project resolution before
// caps (HIDE must not leak that a project exists via a capability error).
const idxIdentity = shipped.indexOf("save_knowledge requires a signed-in user");
const idxProject = shipped.indexOf('error: `No project matching "${projectNumber}"`,\n          nextStep: "search_projects finds projects');
const idxCap = shipped.indexOf("Your role does not have the knowledge.contribute capability");
const idxCeiling = shipped.indexOf("suggested entries awaiting review");
const idxDup = shipped.indexOf("possibleDuplicate: {");
check(idxIdentity > 0 && idxProject > idxIdentity && idxCap > idxProject &&
      idxCeiling > idxCap && idxDup > idxCeiling,
  "handler guard order is identity → project HIDE → capability → ceiling → duplicate");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);
