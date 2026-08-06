// P2.9 (derived slice): design phase read from the set folder name.
//
// Mirrors the implementation in index.ts. Every fixture below is a REAL set
// name taken from pms_filing_log or a real Outgoing folder, because the whole
// risk here is that invented names are tidier than the ones people type.
import { strict as assert } from "node:assert";
import test from "node:test";

const PHASE_PATTERNS = [
  { phase: "CD", re: /(?:^|[^A-Z0-9])(?:\d{1,3}\s*%?\s*)?CD\d?(?:[^A-Z0-9]|$)/ },
  { phase: "DD", re: /(?:^|[^A-Z0-9])(?:\d{1,3}\s*%?\s*)?DD\d?(?:[^A-Z0-9]|$)/ },
  { phase: "SD", re: /(?:^|[^A-Z0-9])(?:\d{1,3}\s*%?\s*)?SD\d?(?:[^A-Z0-9]|$)/ },
  { phase: "Bid", re: /(?:^|[^A-Z0-9])BID(?:[^A-Z0-9]|$)/ },
  { phase: "CA", re: /(?:^|[^A-Z0-9])CA(?:[^A-Z0-9]|$)/ },
  { phase: "Programming", re: /(?:^|[^A-Z0-9])PROGRAMMING(?:[^A-Z0-9]|$)/ },
  { phase: "Validation", re: /(?:^|[^A-Z0-9])VALIDATION(?:[^A-Z0-9]|$)/ },
];
const PHASE_BY_ACTIVITY = [
  { phase: "Bid", re: /(?:^|[^A-Z0-9])ADDEND/, what: "addendum" },
  { phase: "CA", re: /(?:^|[^A-Z0-9])(?:BULLETIN|ASI|RFI)(?:[^A-Z0-9]|$)/, what: "bulletin/ASI/RFI" },
];

function derivePhase(text) {
  const t = String(text || "").toUpperCase();
  if (!t) return null;
  for (const { phase, re } of PHASE_PATTERNS) if (re.test(t)) return { phase, basis: "named in the set folder" };
  for (const { phase, re, what } of PHASE_BY_ACTIVITY) if (re.test(t)) return { phase, basis: `inferred from ${what}` };
  return null;
}

const PHASE_ALIASES = {
  SD: "SD", SCHEMATIC: "SD", "SCHEMATIC DESIGN": "SD",
  DD: "DD", "DESIGN DEVELOPMENT": "DD",
  CD: "CD", "CONSTRUCTION DOCUMENTS": "CD", "CONSTRUCTION DOCUMENT": "CD",
  BID: "Bid", BIDDING: "Bid",
  CA: "CA", "CONSTRUCTION ADMINISTRATION": "CA",
  PROGRAMMING: "Programming", VALIDATION: "Validation",
};
function normalisePhase(input) {
  const raw = String(input || "").toUpperCase().replace(/\d{1,3}\s*%?\s*/g, "").trim();
  return PHASE_ALIASES[raw] ?? null;
}

test("real CD set names", () => {
  for (const n of [
    "Outgoing/2019-11-22_Final CD Submission",
    "Outgoing/2019-10-31_CD Submission",
    "Outgoing/2025-11-18_Updated 100% CD",
    "Outgoing/2026-02-02 CUNY Brooklyn BMS 100% CD SET dated 1-27-26",
    "Outgoing/2026-05-19 CD Final Dwgs Pkge",
    "Outgoing/2024-10-24_Revised 100% CD Submission",
  ]) assert.equal(derivePhase(n)?.phase, "CD", n);
});

test("real DD and SD set names", () => {
  assert.equal(derivePhase("Outgoing/2024-01-17_100 DD")?.phase, "DD");
  assert.equal(derivePhase("Outgoing/2026-03-26_SD Interim 2 Progress Submission")?.phase, "SD");
  assert.equal(derivePhase("Outgoing/2023-07-21 CHCR Grove Revised SD")?.phase, "SD");
});

test("REGRESSION: an underscore is a boundary, which \\b would get wrong", () => {
  // "_SD-2": \bSD\b does NOT match, because "_" is a word character so there is
  // no boundary between "_" and "S". This exact class of bug has bitten this
  // codebase before (an underscore made agendas outrank minutes), so the
  // separator class is deliberate rather than incidental.
  assert.equal(derivePhase("Outgoing/2026-05-26_SD-2 Updated Option Drawings")?.phase, "SD");
  assert.equal(derivePhase("Outgoing/2026_02_18 Bid Phase")?.phase, "Bid");
  assert.equal(derivePhase("Outgoing/2024-01-17_100 DD")?.phase, "DD");
});

test("a percentage is a milestone within a phase, not a phase", () => {
  assert.equal(derivePhase("2025-11-18_Updated 100% CD")?.phase, "CD");
  assert.equal(derivePhase("50% DD Submission")?.phase, "DD");
  assert.equal(derivePhase("75% CD")?.phase, "CD");
});

test("activity infers a phase only when none is stated", () => {
  const add = derivePhase("Outgoing/2025-01-21_Addendum #1");
  assert.equal(add.phase, "Bid");
  assert.equal(add.basis, "inferred from addendum", "must say it was inferred, not stated");
  const bul = derivePhase("Outgoing/2025-04-10_Bulletin #1");
  assert.equal(bul.phase, "CA");
  assert.equal(bul.basis, "inferred from bulletin/ASI/RFI");
  assert.equal(derivePhase("Outgoing/2026-03-23_RFI 137")?.phase, "CA");
});

test("a stated phase beats an inferred one", () => {
  // A bulletin issued against a CD set states CD; the stated phase wins because
  // PHASE_PATTERNS is consulted before PHASE_BY_ACTIVITY.
  const v = derivePhase("Outgoing/2026-01-15_Bulletin #4 100% CD");
  assert.equal(v.phase, "CD");
  assert.equal(v.basis, "named in the set folder");
});

test("names with no phase return null rather than a guess", () => {
  assert.equal(derivePhase("Outgoing/2026-02-17_ Con Ed Stm Load Letter"), null);
  assert.equal(derivePhase("Outgoing/2019-03-11 List of Questions for concept report"), null);
  assert.equal(derivePhase("Outgoing/2026-07-30 SI COVERSHEETS PAC_LIB"), null);
  assert.equal(derivePhase(""), null);
});

test("no false positive from letters inside words", () => {
  // "CD" inside a word must not match, or half the library becomes CD.
  assert.equal(derivePhase("Outgoing/2026-01-01 MCDONALD HALL"), null);
  assert.equal(derivePhase("Outgoing/ACADEMIC BUILDING"), null, "'CA' inside ACADEMIC must not match");
  assert.equal(derivePhase("Outgoing/2026 CASCADE REPLACEMENT"), null);
});

test("user input normalises to the canonical phase", () => {
  assert.equal(normalisePhase("cd"), "CD");
  assert.equal(normalisePhase("100% CD"), "CD");
  assert.equal(normalisePhase("Construction Documents"), "CD");
  assert.equal(normalisePhase("schematic design"), "SD");
  assert.equal(normalisePhase("bidding"), "Bid");
  assert.equal(normalisePhase("construction administration"), "CA");
  assert.equal(normalisePhase("nonsense"), null, "unknown input must be rejected, not guessed");
});
