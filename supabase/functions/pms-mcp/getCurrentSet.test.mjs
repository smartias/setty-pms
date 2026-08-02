// Tests for the get_current_set helpers in index.ts — how the connector decides
// which issued set is current, and which sheets belong to a discipline.
//
//   node supabase/functions/pms-mcp/getCurrentSet.test.mjs
//
// The functions are COPIED below rather than imported, for the same reason as
// scoreMeetingDoc.test.mjs: index.ts is a single-file edge function whose top
// level builds the MCP server and calls Deno.serve, so importing it boots a
// server. Keep the copies in lockstep — there is a drift check at the bottom.
//
// Every transmittal fixture is REAL, pulled verbatim from pms_filing_log rows
// tagged operation = 'transmittal-generated' on 2026-08-01. That matters here:
// the register is small (11 rows, 3 projects) and its shape is not what the
// roadmap assumed, so synthetic fixtures would have hidden both defects this
// file pins down.

// ── copies from index.ts ────────────────────────────────────────────────────
function setFolderDate(name) {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(name || ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function registerIssueDate(row) {
  const explicit = row?.files?.issuedAt;
  if (explicit) return String(explicit).slice(0, 10);
  const named = /^\s*(\d{4})[-_](\d{2})[-_](\d{2})/.exec(String(row?.files?.milestoneName || ""));
  if (named) return `${named[1]}-${named[2]}-${named[3]}`;
  return String(row?.created_at || "").slice(0, 10);
}
function registerIssueDateSource(row) {
  if (row?.files?.issuedAt) return "stated issue date";
  if (/^\s*\d{4}[-_]\d{2}[-_]\d{2}/.test(String(row?.files?.milestoneName || ""))) return "set folder name";
  return "filing timestamp (may not be the issue date)";
}

const sheetsOf = (row) => Array.isArray(row?.files?.sheets) ? row.files.sheets : [];
function sheetDisciplines(sheet) {
  const out = new Set();
  const stored = String(sheet?.discipline || "").toLowerCase().trim();
  if (stored) out.add(stored);
  const base = String(sheet?.filename || "").replace(/\.[a-z0-9]+$/i, "");
  for (const m of base.matchAll(/[-_]([A-Z]{1,3})(?=[-_.\s]|$)/g)) out.add(m[1].toLowerCase());
  const lead = /^([A-Z]{1,3})[-_]?\d/.exec(base);
  if (lead) out.add(lead[1].toLowerCase());
  return [...out];
}
const sheetHasDiscipline = (sheet, disc) => sheetDisciplines(sheet).includes(disc);
const hasDiscipline = (row, disc) => sheetsOf(row).some((s) => sheetHasDiscipline(s, disc));

// ── fixtures: the real SAPX196006.00 register, newest first ─────────────────
const T003 = {
  created_at: "2026-07-30 20:23:47.145398+00",
  sp_folder_url: "https://setty.sharepoint.com/sites/NYCProjects/x/Outgoing/2025-04-10_Bulletin%20%231",
  files: {
    transmittalNumber: "T-003", milestoneName: "2025-04-10_Bulletin #1", distributionKind: "save-sp",
    sheets: [{ title: "2025 04 10 TablerQ E Bulletin #1", sheetNo: "", filename: "2025-04-10_TablerQ_E_Bulletin #1.pdf", revision: "0", discipline: "General" }],
  },
};
const T001 = {
  created_at: "2026-04-17 12:00:00+00",
  sp_folder_url: "https://setty.sharepoint.com/sites/NYCProjects/x/Outgoing/2026-04-17_Bulletin%20%2313",
  files: {
    transmittalNumber: "T-001", milestoneName: "2026-04-17_Bulletin #13", distributionKind: "backfill", backfilled: true,
    sheets: [
      { title: "E Bulletin #13", sheetNo: "STTQ-01", filename: "STTQ-01-E_Bulletin #13.pdf", revision: "0", discipline: "STTQ" },
      { title: "M Bulletin #13", sheetNo: "STTQ-01", filename: "STTQ-01-M_Bulletin #13.pdf", revision: "0", discipline: "STTQ" },
    ],
  },
};
const T002 = {
  created_at: "2025-04-10 12:00:00+00",
  sp_folder_url: "https://setty.sharepoint.com/sites/NYCProjects/x/Outgoing/2025-04-10_Bulletin%20%231",
  files: {
    transmittalNumber: "T-002", milestoneName: "2025-04-10_Bulletin #1", distributionKind: "backfill", backfilled: true,
    sheets: [{ title: "2025 04 10 TablerQ E Bulletin #1", sheetNo: "", filename: "2025-04-10_TablerQ_E_Bulletin #1.pdf", revision: "0", discipline: "General" }],
  },
};
// A routine send from before the sheet register existed: authoritative set, no sheets.
const NO_SHEETS = {
  created_at: "2026-05-18 21:17:58.839691+00",
  sp_folder_url: "https://setty.sharepoint.com/sites/NYCProjects/y",
  files: { transmittalNumber: "T-001", milestoneName: "", distributionKind: "send-email", sheets: [] },
};
const REGISTER = [T003, T001, T002]; // as PostgREST returns it: order=created_at.desc

let failures = 0, ran = 0;
// Counts what actually ran. The total used to be hardcoded, so assertions added
// later were silently uncounted and the summary under-reported.
const check = (cond, msg) => { ran++; if (!cond) { failures++; console.error("FAIL: " + msg); } };

// ── 1. Newest-first selection ───────────────────────────────────────────────
// created_at order is only the FETCH order now; registerIssueDate decides which
// set is current. See section 6b.
check(REGISTER[0] === T003, "PostgREST returns the register newest-first by created_at");
check(
  REGISTER.map((r) => r.files.transmittalNumber).join(",") === "T-003,T-001,T-002",
  "transmittal NUMBER is not chronological on real data (T-002 predates T-001), so ordering must " +
  "use created_at and never the number",
);

// ── 2. Same-day ties resolve on time of day, but only for live sends ────────
const liveA = "2026-05-18 14:18:01.466729+00", liveB = "2026-05-18 14:18:12.068034+00";
check(liveA < liveB, "two live sends on the same date are separated by real time-of-day (11s apart)");
check(
  T001.created_at.slice(11, 19) === "12:00:00" && T002.created_at.slice(11, 19) === "12:00:00",
  "backfilled rows are stamped at synthetic 12:00:00 UTC, so time-of-day CANNOT break a tie between two " +
  "backfills on the same date",
);
const backfilled = (r) => r.files.backfilled === true;
check(
  !backfilled(T003) && backfilled(T001),
  "a live send is distinguishable from a backfill, which is the only safe tiebreak when timestamps collide",
);

// ── 3. Discipline: the register's own field is not a discipline ─────────────
// This is the defect that would silently break supersession keyed on
// sheetNo + discipline. Both Bulletin #13 sheets record sheetNo "STTQ-01" and
// discipline "STTQ" — the building series, not M/E/P/FP. The key (STTQ-01, STTQ)
// therefore collides across two genuinely different sheets.
const [e13, m13] = T001.files.sheets;
check(
  e13.sheetNo === m13.sheetNo && e13.discipline === m13.discipline,
  "REAL DATA: the E and M sheets of Bulletin #13 share sheetNo AND discipline",
);
check(
  e13.filename !== m13.filename,
  "...yet they are different sheets, distinguishable only by filename",
);
// Reading the letter out of the filename recovers the real discipline.
check(sheetHasDiscipline(e13, "e"), "the E sheet is findable as discipline E via its filename");
check(sheetHasDiscipline(m13, "m"), "the M sheet is findable as discipline M via its filename");
check(!sheetHasDiscipline(e13, "m"), "the E sheet is NOT returned for discipline M");
check(!sheetHasDiscipline(m13, "e"), "the M sheet is NOT returned for discipline E");
check(sheetHasDiscipline(e13, "sttq"), "the stored series value still matches, so nothing regresses");

// Conventional names still parse the conventional way.
for (const [fn, disc] of [
  ["M-501_Riser Diagram_Rev2.pdf", "m"],
  ["FP-301 Sprinkler Plan.pdf", "fp"],
  ["P101 Plumbing Plan.pdf", "p"],
  ["E-201.pdf", "e"],
]) {
  check(sheetHasDiscipline({ filename: fn, discipline: "" }, disc), `${fn} reads as discipline ${disc.toUpperCase()}`);
}

// ── 4. Discipline scoping picks the newest set CONTAINING that discipline ───
// Not the newest set overall: T-003 is newer but holds no M sheet.
const newestWithM = REGISTER.filter((r) => hasDiscipline(r, "m"))[0];
check(newestWithM === T001, "asking for discipline M returns Bulletin #13 (T-001), not the newer T-003");
const newestOverall = REGISTER[0];
check(newestOverall === T003 && !hasDiscipline(T003, "m"), "...because the newest set overall has no M sheet at all");

// ── 5. Empty sheet registers are reported, not silently treated as empty ────
check(sheetsOf(NO_SHEETS).length === 0, "a pre-register send has no sheets");
check(NO_SHEETS.files.milestoneName === "", "...and no set name either, so the handler must not imply one");

// ── 6. Folder-date inference ────────────────────────────────────────────────
const folders = [
  "2025-01-21_Addendum #1", "2026-04-17_Bulletin #13", "2025-04-10_Bulletin #1",
  "2019-11-08_CD Submission", "Drawings", "Superseded",
];
const dated = folders.map((n) => ({ n, d: setFolderDate(n) })).filter((x) => x.d);
check(dated.length === 4, "four of the six folder names carry a leading ISO date");
check(setFolderDate("Drawings") === null, "an undated folder name yields no date rather than a bogus one");
check(setFolderDate("2026-04-17_Bulletin #13") === "2026-04-17", "the date is read from the NAME, not from Graph metadata");
const newestFolder = [...dated].sort((a, b) => b.d.localeCompare(a.d))[0];
check(newestFolder.n === "2026-04-17_Bulletin #13", "the newest dated folder wins the inference fallback");
check(setFolderDate("  2025-04-10_Bulletin #1") === "2025-04-10", "leading whitespace does not defeat the date parse");

// ── 6b. The issue date is not the filing timestamp ─────────────────────────
// This is the bug that made get_current_set name a year-superseded set as
// current on Tabler. T-003 was FILED 2026-07-30 for a set ISSUED 2025-04-10,
// and created_at outranked Bulletin #13's 2026-04-17.
const filedLate = { created_at: "2026-07-30 20:23:47+00", files: { milestoneName: "2025-04-10_Bulletin #1", transmittalNumber: "T-003" } };
const bulletin13 = { created_at: "2026-04-17 12:00:00+00", files: { milestoneName: "2026-04-17_Bulletin #13", issuedAt: "2026-04-17T12:00:00.000Z" } };
check(registerIssueDate(filedLate) === "2025-04-10", "a filing timestamp does not become the issue date");
check(registerIssueDate(bulletin13) === "2026-04-17", "a stated issue date is used as-is");
const ordered = [filedLate, bulletin13].sort((a, b) => registerIssueDate(b).localeCompare(registerIssueDate(a)));
check(ordered[0].files.milestoneName === "2026-04-17_Bulletin #13",
  "Bulletin #13 is current, NOT the set whose record happens to be newest");

// issuedAt beats the folder name, and it must. CUNY's folder is
// "2026-02-02 ... 100% CD SET dated 1-27-26": the folder date is when it was
// filed, and the name itself says the set is dated 1-27-26.
const cuny = { created_at: "2026-01-27 12:00:00+00",
  files: { milestoneName: "2026-02-02 CUNY Brooklyn BMS 100% CD SET dated 1-27-26", issuedAt: "2026-01-27T12:00:00.000Z" } };
check(registerIssueDate(cuny) === "2026-01-27", "a stated issue date outranks a misleading folder date");
check(registerIssueDateSource(cuny) === "stated issue date", "...and the source is reported");

// Underscored folder dates parse too: PMS writes "2026_04_16 Comment Response".
check(registerIssueDate({ created_at: "2026-07-01", files: { milestoneName: "2026_04_16 Comment Response" } }) === "2026-04-16",
  "an underscored folder date is read");
// Nothing to go on: fall back, and SAY it is only a filing timestamp.
const bare = { created_at: "2026-05-18 21:17:58+00", files: { milestoneName: "" } };
check(registerIssueDate(bare) === "2026-05-18", "with no better source, created_at is used");
check(registerIssueDateSource(bare) === "filing timestamp (may not be the issue date)",
  "...and the answer admits what it is based on");

// ── 7. Drift check against the shipped source ──────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const line = (src, re) => (src.match(re) || [""])[0].trim();
const shippedDateRe = line(shipped, /^\s*const m = \/\^\\s\*\(\\d\{4\}\).*$/m);
check(shippedDateRe !== "", "found setFolderDate's regex in index.ts");
check(
  shipped.includes("for (const m of base.matchAll(/[-_]([A-Z]{1,3})(?=[-_.\\s]|$)/g)) out.add(m[1].toLowerCase());"),
  "sheetDisciplines' filename regex has DRIFTED from this test's copy",
);
check(shipped.includes("mcp.tool(\"get_current_set\""), "get_current_set is still registered in index.ts");
check(
  shipped.includes("operation=eq.transmittal-generated"),
  "the register query still filters on operation = transmittal-generated",
);

const total = ran;
console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (real register fixtures: 3 transmittals + 1 pre-register send, ` +
    `6 folder names, 4 drift checks)`);
process.exit(failures ? 1 : 0);
