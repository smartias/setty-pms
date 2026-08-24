// Tests for search_drawings' pure helpers in index.ts.
//
//   node supabase/functions/pms-mcp/searchDrawings.test.mjs
//
// The helpers are COPIED below (index.ts boots a server at import). A drift
// check at the bottom fails if the copies stop matching the shipped source.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── copies from index.ts ────────────────────────────────────────────────────
function drawingQueryPatterns(query) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(query || ""))) !== null) terms.push((m[1] ?? m[2]).trim());
  return terms
    .filter(Boolean)
    .map((t) =>
      t.split(/[-\s]+/).filter(Boolean)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[-\\s]?"))
    .filter(Boolean)
    .slice(0, 6);
}

function drawingSetOf(folderPath) {
  const parts = String(folderPath || "").split("/").filter(Boolean);
  const i = parts.findIndex((p) => p.toLowerCase().includes("outgoing"));
  if (i >= 0 && parts[i + 1]) return parts[i + 1];
  return parts[0] || "/";
}

const DRAWING_FULL_SET_RE = /(100\s*%|\b\d{2,3}\s*%?\s*(cd|dd|sd)s?\b|\b(cds?|dd|sd)\b|construction\s+doc|\bbid\b|\bfinal\b|\bifc\b|conformed|issued\s+for\s+construction|\bpermit\b|design\s+development|schematic)/i;
const DRAWING_PARTIAL_SET_RE = /(bulletin|addend|\brfi\b|\basi\b|\bsk-?\s?\d|sketch|resub|\bccd\b|\bpco\b|\bsupplement)/i;
const DRAWING_INDIVIDUAL_FOLDER_RE = /individual/i;
const DRAWING_COMBINED_FOLDER_RE = /combined/i;

function drawingSetDate(setName) {
  const m = /^(\d{4})[-._](\d{2})[-._](\d{2})/.exec(String(setName || "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function drawingBaselineSet(setNames) {
  const dated = setNames
    .filter((s) => drawingSetDate(s) && DRAWING_FULL_SET_RE.test(s) && !DRAWING_PARTIAL_SET_RE.test(s))
    .sort((a, b) => String(drawingSetDate(b)).localeCompare(String(drawingSetDate(a))) || b.localeCompare(a));
  return dated[0] || null;
}

function drawingPathBelowSet(folderPath, set) {
  const parts = String(folderPath || "").split("/").filter(Boolean);
  const i = parts.indexOf(set);
  return i >= 0 ? parts.slice(i + 1).join("/") : "";
}

function planDrawingScope(files) {
  const withSet = files.map((f) => ({ f, set: drawingSetOf(f.folderPath) }));
  const sets = [...new Set(withSet.map((x) => x.set))];
  const baselineSet = drawingBaselineSet(sets);
  const baselineDate = baselineSet ? drawingSetDate(baselineSet) : null;

  const setsWithIndividual = new Set(
    withSet.filter((x) => DRAWING_INDIVIDUAL_FOLDER_RE.test(drawingPathBelowSet(x.f.folderPath, x.set))).map((x) => x.set));
  const duplicateBooks = [];
  const kept = [];
  for (const { f, set } of withSet) {
    if (setsWithIndividual.has(set) && DRAWING_COMBINED_FOLDER_RE.test(drawingPathBelowSet(f.folderPath, set))) {
      duplicateBooks.push(f);
      continue;
    }
    const d = drawingSetDate(set);
    const tier = !baselineDate || !d || d >= baselineDate ? "current" : "superseded";
    kept.push({ ...f, set, tier });
  }
  // Current tier first, then within a tier newest set first; folderPath then
  // name make the order TOTAL and stable, so repeat calls never skip a file.
  kept.sort((a, b) =>
    (a.tier === b.tier ? 0 : a.tier === "current" ? -1 : 1) ||
    String(b.folderPath).localeCompare(String(a.folderPath)) ||
    String(a.name).localeCompare(String(b.name)));
  return { files: kept, baselineSet, duplicateBooks };
}

function drawingDateKey(d) {
  if (!d) return 0;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(d);
  if (m) return Number((m[3].length === 2 ? "20" + m[3] : m[3]) + m[1].padStart(2, "0") + m[2].padStart(2, "0"));
  const m2 = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(d);
  return m2 ? Number(m2[1] + m2[2] + m2[3]) : 0;
}

const drawingRevKey = (r) => `${r.revision ?? ""}|${r.set}`;
const drawingRevSort = (a, b) =>
  drawingDateKey(b.revisionDate) - drawingDateKey(a.revisionDate) || String(b.set).localeCompare(String(a.set));

function drawingSheetHistory(present, indexed) {
  const seen = new Set();
  const indexedRevisions = indexed
    .filter((r) => { const k = drawingRevKey(r); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort(drawingRevSort);
  const presentKeys = new Set(present.map(drawingRevKey));
  const absentAt = indexedRevisions.filter((r) => !presentKeys.has(drawingRevKey(r)));
  // The hit rows come from the search RPC without the description; borrow it
  // from the indexed row for the same (revision, set).
  const descOf = new Map(indexedRevisions.map((r) => [drawingRevKey(r), r.revisionDescription ?? null]));
  const sortedPresent = present
    .map((r) => ({ ...r, revisionDescription: r.revisionDescription ?? descOf.get(drawingRevKey(r)) ?? null }))
    .sort(drawingRevSort);
  const pick = (r) =>
    r ? { revision: r.revision, revisionDate: r.revisionDate, revisionDescription: r.revisionDescription ?? null, set: r.set } : null;
  const latestSeen = pick(sortedPresent[0]);
  const earliestSeen = pick(sortedPresent[sortedPresent.length - 1]);
  const latestIndexed = pick(indexedRevisions[0]);
  const earliestIndexed = pick(indexedRevisions[indexedRevisions.length - 1]);
  const stillPresentAtLatest = !!(latestSeen && latestIndexed && drawingRevKey(latestSeen) === drawingRevKey(latestIndexed));
  // If the term is on the OLDEST indexed revision of the sheet, "first appeared"
  // may be earlier still on a revision not yet indexed (or the sheet's base
  // issue): honest answer is "present since at least ...".
  const presentSinceEarliestIndexed = !!(earliestSeen && earliestIndexed && drawingRevKey(earliestSeen) === drawingRevKey(earliestIndexed));
  return {
    indexedRevisions: indexedRevisions.map(pick),
    absentAt: absentAt.map(pick),
    latestSeen, earliestSeen, latestIndexed, earliestIndexed,
    stillPresentAtLatest, presentSinceEarliestIndexed,
  };
}
// ── end copies ──────────────────────────────────────────────────────────────

// ── scope planning ──────────────────────────────────────────────────────────
// Tabler's real set names. The baseline is the newest FULL submission; the
// 2019 CD sets are superseded, "Revised Bulletin #1" is a partial despite the
// word "Revised", and "Revised 100% CD Submission" is the baseline despite it.
{
  const sets = [
    "2019-11-01_CD Submission", "2019-11-15_Final CD Submission",
    "2024-10-24_Revised 100% CD Submission",
    "2025-01-21_Addendum #1", "2025-02-05_Addendum #2", "2025-04-10_Bulletin #1",
    "2025-05-12_Revised Bulletin #1", "2025-07-08_Bulletin #2 Resub", "2025-09-29_Bulletin #3",
    "2026-03-23_RFI 137", "2026-04-17_Bulletin #13",
  ];
  assert.equal(drawingBaselineSet(sets), "2024-10-24_Revised 100% CD Submission");
  assert.equal(drawingBaselineSet(["2025-04-10_Bulletin #1", "2026-04-17_Bulletin #13"]), null, "no full set → no baseline");
  assert.equal(drawingBaselineSet(["Bulletin #1", "100% CD"]), null, "undated names never anchor a baseline");
  assert.equal(drawingBaselineSet(["2024-01-17_100 DD", "2023-06-01_50% DD"]), "2024-01-17_100 DD");
  assert.equal(drawingSetDate("2024-10-24_Revised 100% CD Submission"), "2024-10-24");
  assert.equal(drawingSetDate("2023.08.11_SD"), "2023-08-11");
  assert.equal(drawingSetDate("Bulletin #1"), null);
}

// Ordering: current tier (baseline and after) first, newest set first, then
// superseded sets; total and stable within a tier.
{
  const f = (folderPath, name, size = 100) => ({ itemId: `${folderPath}/${name}`, folderPath, name, size });
  const files = [
    f("Outgoing/2019-11-01_CD Submission/M", "M801.pdf"),
    f("Outgoing/2024-10-24_Revised 100% CD Submission/INDIVIDUAL PDF's/E", "E211.pdf"),
    f("Outgoing/2024-10-24_Revised 100% CD Submission/INDIVIDUAL PDF's/E", "E101.pdf"),
    f("Outgoing/2024-10-24_Revised 100% CD Submission/COMBINED PDF", "STTA-01-E.pdf", 42e6),
    f("Outgoing/2026-04-17_Bulletin #13", "STTQ-01-M_Bulletin #13.pdf"),
    f("Outgoing/2026-04-17_Bulletin #13", "STTQ-01-E_Bulletin #13.pdf"),
    f("Outgoing/2025-04-10_Bulletin #1/Combined PDF", "Bulletin1.pdf"),   // no INDIVIDUAL sibling → kept
  ];
  const plan = planDrawingScope(files);
  assert.equal(plan.baselineSet, "2024-10-24_Revised 100% CD Submission");
  assert.deepEqual(plan.duplicateBooks.map((x) => x.name), ["STTA-01-E.pdf"]);
  assert.deepEqual(plan.files.map((x) => `${x.tier}:${x.name}`), [
    "current:STTQ-01-E_Bulletin #13.pdf",
    "current:STTQ-01-M_Bulletin #13.pdf",
    "current:Bulletin1.pdf",
    "current:E101.pdf",
    "current:E211.pdf",
    "superseded:M801.pdf",
  ]);
  // Same input, same order (stability is what lets repeat calls page safely).
  assert.deepEqual(planDrawingScope([...files].reverse()).files.map((x) => x.name), plan.files.map((x) => x.name));
  // No baseline → one tier, nothing dropped.
  const noBase = planDrawingScope(files.filter((x) => !/100% CD/.test(x.folderPath)));
  assert.equal(noBase.baselineSet, null);
  assert.ok(noBase.files.every((x) => x.tier === "current"));
  assert.equal(noBase.duplicateBooks.length, 0);
}

// ── history ─────────────────────────────────────────────────────────────────
// E211 is rev C (04/11/2025) then rev 6 (12/15/2025): the label sort would put
// C last; the date sort must not. Term present at C and 6, absent at 13.
{
  const rev = (revision, revisionDate, set, revisionDescription = null) => ({ revision, revisionDate, set, revisionDescription });
  const indexed = [
    rev("13", "04/17/2026", "2026-04-17_Bulletin #13", "BULLETIN #13"),
    rev("C", "04/11/2025", "2025-04-10_Bulletin #1", "BULLETIN #1"),
    rev("C", "04/11/2025", "2025-04-10_Bulletin #1", "BULLETIN #1"),   // combined + individual copy
    rev("6", "12/15/2025", "2025-12-15_Bulletin #6R1", "BULLETIN #6"),
    rev("C", "04/11/2025", "2025-05-12_Revised Bulletin #1", "BULLETIN #1"), // re-issue, same rev, later folder
    rev(null, null, "2024-10-24_Revised 100% CD Submission", null),   // base issue, empty revision block
  ];
  const present = [
    rev("6", "12/15/2025", "2025-12-15_Bulletin #6R1"),
    rev("C", "04/11/2025", "2025-04-10_Bulletin #1"),
  ];
  const h = drawingSheetHistory(present, indexed);
  assert.equal(h.indexedRevisions.length, 5, "duplicate (revision,set) collapses");
  assert.deepEqual(h.indexedRevisions.map((r) => r.revision), ["13", "6", "C", "C", null]);
  assert.deepEqual(h.absentAt.map((r) => `${r.revision}@${r.set}`),
    ["13@2026-04-17_Bulletin #13", "C@2025-05-12_Revised Bulletin #1", "null@2024-10-24_Revised 100% CD Submission"]);
  assert.equal(h.latestSeen.revision, "6");
  assert.equal(h.latestSeen.revisionDescription, "BULLETIN #6", "description comes from the indexed rows");
  assert.equal(h.earliestSeen.revision, "C");
  assert.equal(h.latestIndexed.revision, "13");
  assert.equal(h.stillPresentAtLatest, false, "dropped at rev 13");
  assert.equal(h.presentSinceEarliestIndexed, false, "absent at the base issue → genuinely first appeared at C");
}
{
  const only = [{ revision: "13", revisionDate: "04/17/2026", set: "2026-04-17_Bulletin #13" }];
  const h = drawingSheetHistory(only, only);
  assert.equal(h.stillPresentAtLatest, true);
  assert.equal(h.presentSinceEarliestIndexed, true, "only one revision indexed → cannot claim it first appeared here");
  assert.deepEqual(h.absentAt, []);
  const none = drawingSheetHistory([], []);
  assert.equal(none.latestSeen, null);
  assert.equal(none.stillPresentAtLatest, false);
}
// CHCR-style dates (2023.08.11) sort correctly against each other.
{
  assert.ok(drawingDateKey("2023.08.11") < drawingDateKey("2024.01.05"));
  assert.ok(drawingDateKey("11/01/19") < drawingDateKey("10/29/2024"));
  assert.equal(drawingDateKey(null), 0);
}

// Patterns are POSIX regexes for Postgres `~*`; check them with JS regex, whose
// syntax agrees for everything emitted here (escapes, [-\s]?, literals).
const matches = (pat, text) => new RegExp(pat, "i").test(text);

// One term, hyphen/space/nothing inside a tag are interchangeable.
{
  const [p] = drawingQueryPatterns("FCU-11");
  assert.equal(p, "FCU[-\\s]?11");
  assert.ok(matches(p, "... FCU-11 ..."));
  assert.ok(matches(p, "... FCU 11 ..."));
  assert.ok(matches(p, "... FCU11 ..."));
  assert.ok(!matches(p, "... FCU-1 ..."));
}

// Words are separate AND terms; a quoted phrase is one term with flexible gaps.
{
  const ps = drawingQueryPatterns('"perchloric fume hood" 208V');
  assert.deepEqual(ps, ["perchloric[-\\s]?fume[-\\s]?hood", "208V"]);
  assert.ok(matches(ps[0], "PERCHLORIC FUME HOOD EXHAUST"));
  assert.ok(!matches(ps[0], "PERCHLORIC ACID ... FUME HOOD"));
  assert.deepEqual(drawingQueryPatterns("perchloric fume hood"), ["perchloric", "fume", "hood"]);
}

// User text is never regex: metacharacters are escaped, so a query like
// "(N) 4" or "1.5\"" cannot break or widen the search.
{
  const ps = drawingQueryPatterns("(N) 4\" 350KW.");
  assert.deepEqual(ps, ["\\(N\\)", "4\"", "350KW\\."]);
  assert.ok(matches(ps[0], "(N) DUCT"));
  assert.ok(!matches(ps[0], "N DUCT"));
  assert.ok(matches(ps[2], "350KW."));
  assert.ok(!matches(ps[2], "350KWX"));
}

// Empty and junk input yield no patterns; term count is capped.
{
  assert.deepEqual(drawingQueryPatterns(""), []);
  assert.deepEqual(drawingQueryPatterns("   "), []);
  assert.deepEqual(drawingQueryPatterns("- -- -"), []);
  assert.equal(drawingQueryPatterns("a b c d e f g h").length, 6);
}

// Set name comes off the path segment after Outgoing, whatever the Outgoing
// folder is actually called on that project.
{
  assert.equal(drawingSetOf("Outgoing/2025-04-10_Bulletin #1/Drawings"), "2025-04-10_Bulletin #1");
  assert.equal(drawingSetOf("99 📤 Outgoing/2024-10-24_Revised 100% CD Submission/INDIVIDUAL PDF's/E"), "2024-10-24_Revised 100% CD Submission");
  assert.equal(drawingSetOf("Incoming/Architect/2026-01-05 Backgrounds"), "Incoming");
  assert.equal(drawingSetOf(""), "/");
}

// ── drift check ─────────────────────────────────────────────────────────────
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "index.ts"), "utf8");
  const me = readFileSync(fileURLToPath(import.meta.url), "utf8");
  // Strip the TS annotations the source carries so both sides compare as JS.
  const strip = (s) => s
    .replace(/<T extends \{[^}]*\}>/g, "")
    .replace(/\): \{\n(?:[^\n]*\n)*?\} \{/g, ") {")               // multi-line object return type
    .replace(/: Array<T & \{[^}]*\}>/g, "")
    .replace(/\(r: \{ revision: string \| null; set: string \}\)/g, "(r)")
    .replace(/: (string \| null \| undefined|string \| null|string\[\]|string|number|boolean|DrawingTier|DrawingRev\[\]|DrawingRev \| undefined|DrawingRev|T\[\]|Set<string>|RegExpExecArray \| null)/g, "")
    .replace(/new Set<string>\(\)/g, "new Set()")
    .replace(/ as string\[\]/g, "");
  const grabFn = (s, name) => {
    const sig = `function ${name}`;
    const at = s.indexOf(sig);
    assert.ok(at >= 0, `${name} not found`);
    const end = s.indexOf("\n}\n", at);
    return strip(s.slice(at, end + 2));
  };
  const grabConst = (s, name) => {
    const sig = `const ${name} = `;
    const at = s.indexOf(sig);
    assert.ok(at >= 0, `${name} not found`);
    const end = s.indexOf(";\n", at);
    return strip(s.slice(at, end + 2));
  };
  for (const name of ["drawingQueryPatterns", "drawingSetOf", "drawingSetDate", "drawingBaselineSet",
    "drawingPathBelowSet", "planDrawingScope", "drawingDateKey", "drawingSheetHistory"]) {
    assert.equal(grabFn(me, name), grabFn(src, name), `${name} in this test has drifted from index.ts`);
  }
  for (const name of ["DRAWING_FULL_SET_RE", "DRAWING_PARTIAL_SET_RE", "DRAWING_INDIVIDUAL_FOLDER_RE",
    "DRAWING_COMBINED_FOLDER_RE", "drawingRevKey", "drawingRevSort"]) {
    assert.equal(grabConst(me, name), grabConst(src, name), `${name} in this test has drifted from index.ts`);
  }
}

// Big-book page-windowed indexing (2026-08-23): the invariants that keep a
// 400-page book from OOM-crashing the worker or double-counting on resume.
// These are inline in the handler, so they are pinned by anchor rather than
// copied — an edit that removes one must decide what replaces it.
{
  const src = readFileSync(join(here, "index.ts"), "utf8");
  for (const anchor of [
    "const DRAWING_INDEX_PAGE_WINDOW = 40;",
    "const DRAWING_INDEX_FLUSH_EVERY = 10;",
    "const startPage = Math.max(0, Number(prev?.pages_done || 0)) + 1;",
    "attempts: lastFlushed > Number(prev?.pages_done || 0) ? 0 : attempts,",
    'status: finished ? "done" : "pending",',
    "if (r.resumes) continue;",
    "pages_done,text_pages",
  ]) {
    assert.ok(src.includes(anchor), "big-book windowing invariant missing from index.ts: " + anchor);
  }
}

console.log("searchDrawings.test.mjs: all assertions passed");
