// Tests for find_document's ranking in index.ts — how a plain-language ask
// ("current phase 3 fire protection narrative") turns into a ranked file list.
//
//   node supabase/functions/pms-mcp/findDocument.test.mjs
//
// The scoring functions are COPIED below, same reason as the other pms-mcp
// tests: index.ts boots a server at import. Drift checks at the bottom.
//
// The fixture filenames are real, from the Tabler Quad (SAPX196006.00) and
// Homeport II folder listings: spec manuals, addenda and bulletin subfolders
// under Outgoing, dated meeting-record folders under Project Management, and
// the OPR / Basis of Design pair that is what this firm actually calls a design
// criteria document.

// ── copies from index.ts ────────────────────────────────────────────────────
const norm = (s) => String(s || "").toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
const STOPWORDS = new Set(["the", "a", "an", "of", "for", "and", "to", "in", "on", "current", "latest", "newest", "me", "get", "find", "show", "please"]);
const DOC_TYPE_WORDS = {
  Narrative: ["narrative", "basis of design", "bod", "opr", "owners project requirements", "design report", "criteria"],
  Calc: ["calc", "calculation", "calculations", "load", "sizing", "takeoff"],
  Spec: ["spec", "specs", "specification", "specifications", "division"],
  "Comment Log": ["comment", "comments", "drchecks", "dr checks", "response", "responses", "backcheck"],
  Transmittal: ["transmittal", "cover sheet"],
  Minutes: ["minutes", "meeting notes", "mtg", "notes"],
  Report: ["report", "survey", "study", "assessment", "scorecard"],
};
const DISCIPLINE_WORDS = {
  M: ["mechanical", "hvac", "ductwork", "hthw"],
  E: ["electrical", "power", "lighting", "normal power"],
  P: ["plumbing", "domestic water", "sanitary"],
  FP: ["fire protection", "sprinkler", "standpipe", "fp"],
  FA: ["fire alarm", "fa"],
  T: ["technology", "telecom", "security", "av"],
};
function folderArea(folderPath) {
  const p = norm(folderPath);
  if (p.includes("outgoing")) return "Outgoing";
  if (p.includes("email")) return "Emails";
  if (p.includes("project management")) return "Project Management";
  if (p.includes("design")) return "Design";
  return "Other";
}
function parseQuery(query, discipline, docType) {
  const n = norm(query);
  const tokens = n.split(" ").filter((t) => t && !STOPWORDS.has(t));
  let wantType = docType || null;
  if (!wantType) {
    for (const [type, words] of Object.entries(DOC_TYPE_WORDS)) {
      if (words.some((w) => n.includes(w))) { wantType = type; break; }
    }
  }
  let wantDisc = discipline || null;
  if (!wantDisc) {
    for (const [code, words] of Object.entries(DISCIPLINE_WORDS)) {
      if (words.some((w) => n.includes(w))) { wantDisc = code; break; }
    }
  }
  const wantsCurrent = /\b(current|latest|newest|most recent)\b/.test(n);
  return { tokens, wantType, wantDisc, wantsCurrent };
}
function scoreDocument(file, q, nowMs) {
  const name = norm(file.name);
  const path = norm(file.folderPath);
  let s = 0;
  for (const t of q.tokens) {
    if (name.includes(t)) s += 10;
    else if (path.includes(t)) s += 3;
  }
  if (s === 0) return 0;
  if (q.wantType) {
    const words = DOC_TYPE_WORDS[q.wantType] || [];
    if (words.some((w) => name.includes(w))) s += 8;
    else if (words.some((w) => path.includes(w))) s += 3;
  }
  if (q.wantDisc) {
    const words = DISCIPLINE_WORDS[q.wantDisc] || [];
    const code = q.wantDisc.toLowerCase();
    if (words.some((w) => name.includes(w))) s += 8;
    else if (new RegExp("(^| )" + code + "( |$)").test(name)) s += 6;
    else if (words.some((w) => path.includes(w))) s += 3;
  }
  const area = folderArea(file.folderPath);
  if (area === "Outgoing") s += 6;
  else if (area === "Project Management") s += 3;
  else if (area === "Design") s -= 2;
  if (/\bsuperseded|\bold\b|\barchive/.test(path)) s -= 12;
  if (file.ext === "pdf") s += 2;
  else if (["docx", "doc", "xlsx", "xls"].includes(file.ext)) s += 1;
  else if (["url", "lnk", "ini", "tmp"].includes(file.ext)) s -= 10;
  const dateInPath = /(\d{4})-(\d{2})-(\d{2})/.exec(file.folderPath || "");
  const stamp = dateInPath ? Date.parse(dateInPath[0]) : Date.parse(file.modified || "");
  if (!isNaN(stamp)) {
    const years = (nowMs - stamp) / (365.25 * 24 * 3600 * 1000);
    s += Math.max(-3, 3 - years);
    if (q.wantsCurrent) s += Math.max(-4, 4 - years * 1.5);
  }
  return s;
}

// ── fixtures ────────────────────────────────────────────────────────────────
const NOW = Date.parse("2026-08-01T00:00:00Z");
const f = (name, folderPath, modified) => ({
  name, folderPath, modified,
  ext: (name.split(".").pop() || "").toLowerCase(),
  webUrl: "https://setty.sharepoint.com/x/" + encodeURIComponent(name),
});

const CORPUS = [
  f("FP Narrative Phase 3.pdf", "Outgoing/2026-04-17_Bulletin #13", "2026-04-17T12:00:00Z"),
  f("FP Narrative Phase 3.pdf", "Outgoing/2019-11-08_CD Submission", "2019-11-08T12:00:00Z"),
  f("Fire Protection Narrative.docx", "Outgoing/2025-01-21_Addendum #1", "2025-01-21T12:00:00Z"),
  f("STTQ-01-E_Bulletin #13.pdf", "Outgoing/2026-04-17_Bulletin #13", "2026-04-17T12:00:00Z"),
  f("STTQ-01-M_Bulletin #13.pdf", "Outgoing/2026-04-17_Bulletin #13", "2026-04-17T12:00:00Z"),
  f("HTHW Specifications.pdf", "Outgoing/2025-01-21_Addendum #1/Specifications", "2025-01-21T12:00:00Z"),
  f("Design Meeting #4 Notes.pdf", "Project Management/2024-06-11_Design Meeting", "2024-06-11T12:00:00Z"),
  f("SQL Basis of Design Guide.pdf", "Emails/2023-02-01_BOD", "2023-02-01T12:00:00Z"),
  f("SQL_Owners Project Requirements OPR.xlsx", "Emails/2023-02-01_BOD", "2023-02-01T12:00:00Z"),
  f("Owner Comments DD.xlsx", "Emails/2024-09-02_Owner Comments", "2024-09-02T12:00:00Z"),
  f("FP Narrative Phase 3.pdf", "Outgoing/Superseded/2018-03-02_Old", "2018-03-02T12:00:00Z"),
  f("Mechanical Load Calcs.xlsx", "Design/Calcs", "2025-06-01T12:00:00Z"),
  f("Phase 3 Kickoff.url", "Project Management", "2026-01-05T12:00:00Z"),
];

const rank = (query, discipline, docType) => {
  const q = parseQuery(query, discipline, docType);
  return CORPUS.map((file) => ({ file, s: scoreDocument(file, q, NOW) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || String(b.file.modified || "").localeCompare(String(a.file.modified || "")));
};

let failures = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failures++; console.error("FAIL: " + msg); } };
const top = (q, d, t) => { const r = rank(q, d, t); return r.length ? r[0].file : null; };

// ── 1. The roadmap's headline acceptance case ──────────────────────────────
const hero = rank("current phase 3 fire protection narrative");
check(hero.length > 0, "the hero query returns results at all");
check(
  hero[0].file.name === "FP Narrative Phase 3.pdf" && hero[0].file.folderPath.includes("2026-04-17"),
  `hero query returns the NEWEST FP narrative first — got "${hero[0]?.file.name}" in "${hero[0]?.file.folderPath}"`,
);
// Same filename, three folders. The differentiator has to be the folder date,
// which is why recency is scored off the path date and not lastModifiedDateTime.
const heroPaths = hero.filter((r) => r.file.name === "FP Narrative Phase 3.pdf").map((r) => r.file.folderPath);
check(heroPaths.length === 3, "all three same-named FP narratives are candidates");
check(heroPaths[0].includes("2026-04-17"), "the 2026 copy outranks the 2019 copy");
check(
  heroPaths[heroPaths.length - 1].includes("Superseded"),
  "the copy in a Superseded folder ranks LAST among identical names",
);

// ── 2. Superseded and junk are pushed down, not silently dropped ───────────
const supersededRow = hero.find((r) => r.file.folderPath.includes("Superseded"));
check(!!supersededRow, "a superseded file is still returned (visible, not hidden)");
check(
  supersededRow.s < hero[0].s,
  "...but scores below the current one, so it cannot be mistaken for the answer",
);
// Same principle as superseded: down-ranked, not hidden. A shortcut that
// genuinely matches the words is worth showing, just never as the answer.
const phase3 = rank("phase 3");
check(phase3[0].file.ext !== "url", `a .url shortcut never WINS a query it nominally matches — got "${phase3[0].file.name}"`);
check(phase3.some((r) => r.file.ext === "url"), "...but it is still listed rather than silently dropped");

// ── 3. Query interpretation ────────────────────────────────────────────────
const q1 = parseQuery("current phase 3 fire protection narrative");
check(q1.wantType === "Narrative", "'narrative' is read as a doc type");
check(q1.wantDisc === "FP", "'fire protection' is read as discipline FP");
check(q1.wantsCurrent === true, "'current' is read as a recency preference");
check(!q1.tokens.includes("current"), "'current' is an intent, not a search term");
check(!q1.tokens.includes("the"), "stopwords are dropped");
check(q1.tokens.includes("phase") && q1.tokens.includes("3"), "meaningful terms survive");

// The firm's vocabulary: nobody names the file "design criteria".
const dc = parseQuery("design criteria");
check(dc.wantType === "Narrative", "'design criteria' maps to Narrative, the firm's actual naming");
const dcHits = rank("basis of design").map((r) => r.file.name);
check(dcHits.includes("SQL Basis of Design Guide.pdf"), "'basis of design' finds the BOD guide");
const oprHits = rank("OPR").map((r) => r.file.name);
check(oprHits.some((n) => n.includes("OPR")), "'OPR' finds the owner's project requirements sheet");

// ── 4. Discipline handling ─────────────────────────────────────────────────
// A bare letter must only match as a sheet-name segment, never as a substring,
// or "E" hits every file with an e in it.
const eSheets = rank("bulletin 13", "E").map((r) => r.file.name);
check(eSheets[0] === "STTQ-01-E_Bulletin #13.pdf", `discipline E picks the E sheet — got "${eSheets[0]}"`);
check(
  !eSheets.slice(0, 1).includes("STTQ-01-M_Bulletin #13.pdf"),
  "...and not the M sheet from the same bulletin",
);
const mSheets = rank("bulletin 13", "M").map((r) => r.file.name);
check(mSheets[0] === "STTQ-01-M_Bulletin #13.pdf", "discipline M picks the M sheet");
check(
  scoreDocument(f("Owner Comments DD.xlsx", "Emails"), parseQuery("comments", "E"), NOW) <
  scoreDocument(f("STTQ-01-E_Bulletin #13.pdf", "Outgoing"), parseQuery("bulletin", "E"), NOW),
  "a bare 'E' does not match loose substrings in unrelated names",
);

// ── 5. Folder semantics ────────────────────────────────────────────────────
check(folderArea("Outgoing/2026-04-17_Bulletin #13") === "Outgoing", "Outgoing is recognised nested");
check(folderArea("01 📋 Project Management/2024-06-11") === "Project Management", "emoji/number prefixes do not defeat area detection");
check(folderArea("Emails/2024-09-02_Owner Comments") === "Emails", "Emails is recognised");
check(folderArea("Random/Folder") === "Other", "an unknown folder is Other, not silently Outgoing");
// Internal calcs are real but rarely the ask, so they sit below issued work.
const calcVsIssued =
  scoreDocument(f("Mechanical Load Calcs.xlsx", "Design/Calcs"), parseQuery("mechanical"), NOW) <
  scoreDocument(f("Mechanical Narrative.pdf", "Outgoing/2026-04-17_Bulletin #13"), parseQuery("mechanical"), NOW);
check(calcVsIssued, "an issued document outranks an internal Design calc for the same term");

// ── 6. Non-matches score zero rather than trickling in ─────────────────────
check(scoreDocument(CORPUS[0], parseQuery("elevator maintenance"), NOW) === 0, "a file matching no term scores 0");
check(rank("elevator maintenance").length === 0, "a query matching nothing returns an empty list, not the whole folder");

// ── 7. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has('if (p.includes("outgoing")) return "Outgoing";', "folderArea");
has('const wantsCurrent = /\\b(current|latest|newest|most recent)\\b/.test(n);', "wantsCurrent detection");
has('if (name.includes(t)) s += 10;', "filename match weight");
has('if (s === 0) return 0;', "the zero-match early return");
has('else if (new RegExp("(^| )" + code + "( |$)").test(name)) s += 6;', "bare-discipline-letter guard");
has('mcp.tool("find_document"', "find_document is still registered");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (${CORPUS.length} real filenames, 6 drift checks)`);
process.exit(failures ? 1 : 0);
