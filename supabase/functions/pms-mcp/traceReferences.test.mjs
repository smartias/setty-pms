// trace_references: the prose sheet-number matcher and its snippet helper.
//
// Run: node supabase/functions/pms-mcp/traceReferences.test.mjs
//
// The functions are COPIES (index.ts is not importable under node); a drift
// detector below compares the copies against the shipped bodies and fails the
// run if they diverge. Classification (register / drawing-index / unvalidated)
// lives in the tool handler and is anchored literally rather than executed.

let failures = 0;
function check(ok, msg) {
  if (!ok) { failures++; console.error("FAIL: " + msg); }
}

// ── copies of the shipped functions ─────────────────────────────────────────

const PROSE_SHEET_RE = /\b([A-Za-z]{1,3})([-\s]?)(\d{3,4}[A-Za-z]?)\b/g;

function sheetTokensInText(text) {
  const out = [];
  if (!text) return out;
  PROSE_SHEET_RE.lastIndex = 0;
  let m;
  while ((m = PROSE_SHEET_RE.exec(text))) {
    out.push({
      sheet: (m[1] + m[3]).toUpperCase(),
      discipline: m[1].toUpperCase(),
      spaceSeparated: m[2] === " ",
      at: m.index,
      token: m[0],
    });
  }
  return out;
}

function refSnippet(text, at, len) {
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + len + 60);
  const clip = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + clip + (end < text.length ? "…" : "");
}

function sheetTextPattern(sheet) {
  const m = /^([A-Z]{1,3})(\d{3,4}[A-Z]?)$/.exec(sheet);
  if (!m) return sheet;
  return "\\y" + m[1] + "[-\\s]?" + m[2] + "\\y";
}

// ── matcher behavior ────────────────────────────────────────────────────────

const sheets = (t) => sheetTokensInText(t).map((x) => x.sheet);

// The plain cases.
check(sheets("Please see M406 for the duct layout").join() === "M406", "bare sheet number matches");
check(sheets("shown on M-406 and E-211").join() === "M406,E211", "hyphenated forms canonicalize");
check(sheets("refer to detail 5/M406").join() === "M406", "detail reference 5/M406 yields the sheet");
check(sheets("per sheet fp301a rev 2").join() === "FP301A", "lowercase and trailing letter suffix");
check(sheets("sheets E211, E212 & E213").join() === "E211,E212,E213", "list of sheets all match");

// Space-separated tokens match but carry the flag the handler uses to drop
// unvalidated ones ("option E 2021" must never become a link on its own).
const spaced = sheetTokensInText("as shown on E 211 near the option E 2021 budget");
check(spaced.length === 2 && spaced.every((t) => t.spaceSeparated), "space-separated tokens are flagged");

// What must NOT tokenize at all.
check(sheets("replace FCU-11 and CHWP-2 per spec").length === 0, "two-digit equipment tags never tokenize");
check(sheets("bulletin STTQ-01 reissued").length === 0, "series prefixes (4 letters / 2 digits) never tokenize");
check(sheets("project SAPX196006.00 phase 2").length === 0, "project numbers never tokenize");
check(sheets("per section 230500 and 8/22/2026").length === 0, "spec sections and dates never tokenize");

// What tokenizes but is the classifier's problem, not the matcher's: the
// handler drops these unless the register or the drawing index knows them.
check(sheets("per AHU-101 schedule").join() === "AHU101", "3-digit equipment tag tokenizes (classifier must drop)");
check(sheets("per IMC 2015 code").join() === "IMC2015", "code-year tokenizes space-separated (classifier must drop)");

// Duplicate forms collapse to one canonical key (dedupe happens in the
// handler; the matcher just has to agree on the key).
const dup = new Set(sheets("E211, E-211 and e211 are the same sheet"));
check(dup.size === 1 && dup.has("E211"), "all forms of one sheet share a canonical key");

// Snippet mechanics.
const long = "x".repeat(100) + " see M406 here " + "y".repeat(100);
const tok = sheetTokensInText(long)[0];
const snip = refSnippet(long, tok.at, tok.token.length);
check(snip.startsWith("…") && snip.endsWith("…") && snip.includes("M406"), "snippet clips both ends around the match");
check(refSnippet("see M406", 4, 4) === "see M406", "short text needs no ellipses");

// Text-fallback probe pattern: bounded, separator-tolerant, same ARE dialect
// as drawingQueryPatterns.
check(sheetTextPattern("E001") === "\\yE[-\\s]?001\\y", "probe pattern splits prefix and digits");
check(sheetTextPattern("FP301A") === "\\yFP[-\\s]?301A\\y", "probe pattern keeps trailing letter");
check(sheetTextPattern("weird") === "weird", "non-sheet key passes through untouched");

// ── drift detection against index.ts ────────────────────────────────────────

import { readFileSync } from "node:fs";

function extractBody(src, fnName) {
  const start = src.indexOf("function " + fnName);
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}
const normalise = (body) => body
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n")
  .replace(/\s+/g, " ").trim();

const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const here = readFileSync(new URL(import.meta.url), "utf8");
for (const fn of ["sheetTokensInText", "refSnippet", "sheetTextPattern"]) {
  const a = extractBody(shipped, fn);
  const b = extractBody(here, fn);
  check(a !== null, `could not find ${fn} in index.ts — extractor needs updating`);
  check(b !== null, `could not find ${fn} in this test file — extractor needs updating`);
  check(a !== null && b !== null && normalise(a) === normalise(b),
    `${fn} has DRIFTED from index.ts. Sync the copy in this test and re-run.`);
}
// The regex and the classifier's key behaviors are anchored literally so an
// edit there fails loudly here.
for (const anchor of [
  "/\\b([A-Za-z]{1,3})([-\\s]?)(\\d{3,4}[A-Za-z]?)\\b/g",
  'if (registerKeys.has(t.sheet)) confidence = "register";',
  'else if (indexKeys.has(t.sheet)) confidence = "drawing-index";',
  'else if (textKeys.has(t.sheet)) confidence = "drawing-text";',
  'else if (!t.spaceSeparated && DISCIPLINE_NAME[t.discipline]) confidence = "unvalidated";',
  '{ register: 4, "drawing-index": 3, "drawing-text": 2, unvalidated: 1 }',
]) {
  check(shipped.includes(anchor), "trace_references anchor missing from index.ts (drift): " + anchor);
}

console.log(failures ? `\n${failures} assertions FAILED` : "\nall assertions pass (trace_references)");
process.exit(failures ? 1 : 0);
