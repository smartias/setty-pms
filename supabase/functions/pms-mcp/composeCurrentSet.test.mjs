// Tests for composeCurrentSet() in index.ts — how the connector folds the
// transmittal register into "every sheet on the job, at its most recent
// issuance, grouped by discipline".
//
//   node supabase/functions/pms-mcp/composeCurrentSet.test.mjs
//
// The functions are COPIED below rather than imported, for the same reason as
// getCurrentSet.test.mjs: index.ts is a single-file edge function whose top
// level builds the MCP server and calls Deno.serve, so importing it boots a
// server. Keep the copies in lockstep — there is a drift check at the bottom.
//
// Every sheet fixture is REAL, read verbatim out of pms_filing_log rows tagged
// operation = 'transmittal-generated' for SAPX196006.00 on 2026-08-02. That
// matters more here than usual, because the two defects this file pins down are
// both invisible to synthetic data:
//
//   1. The register's own `discipline` field is wrong. Bulletin #2's TECHNOLOGY
//      sheets (T-001, T-111) are stored as discipline "Electrical", because
//      filename parsing guessed. Only the sheet number's prefix is reliable.
//   2. Some rows record a building SERIES instead of a sheet number. Bulletin
//      #13 stored BOTH its E sheet and its M sheet as sheetNo "STTQ-01". Folding
//      those on sheet number would collapse two disciplines into one row.

// ── copies from index.ts ────────────────────────────────────────────────────
function registerIssueDate(row) {
  const explicit = row?.files?.issuedAt;
  if (explicit) return String(explicit).slice(0, 10);
  const named = /^\s*(\d{4})[-_](\d{2})[-_](\d{2})/.exec(String(row?.files?.milestoneName || ""));
  if (named) return `${named[1]}-${named[2]}-${named[3]}`;
  return String(row?.created_at || "").slice(0, 10);
}
const sheetsOf = (row) => Array.isArray(row?.files?.sheets) ? row.files.sheets : [];

const SHEET_NO_RE = /^([A-Z]{1,3})[-_ ]?(\d{2,4}[A-Z]?)$/;

function canonicalSheet(sheet) {
  const raw = String(sheet?.sheetNo || "").toUpperCase().replace(/\s+/g, "");
  const m = SHEET_NO_RE.exec(raw);
  if (!m) return null;
  return { sheetNo: m[1] + m[2], discipline: m[1] };
}

const DISCIPLINE_ORDER = ["G", "M", "MS", "P", "FP", "FA", "E", "ES", "T", "TS", "EN"];
const DISCIPLINE_NAME = {
  G: "General", M: "Mechanical", MS: "Mechanical Site", P: "Plumbing",
  FP: "Fire Protection", FA: "Fire Alarm", E: "Electrical", ES: "Electrical Site",
  T: "Technology", TS: "Technology Security", EN: "Energy",
};
const disciplineRank = (d) => {
  const i = DISCIPLINE_ORDER.indexOf(d);
  return i === -1 ? DISCIPLINE_ORDER.length : i;
};
const sheetRank = (no) => {
  const m = SHEET_NO_RE.exec(no);
  return m ? Number(String(m[2]).replace(/[A-Z]$/, "")) : 0;
};

function composeCurrentSet(rows) {
  const current = new Map();
  const unusable = [];
  const sourceSets = new Map();
  let supersededCount = 0;

  for (const row of rows) {
    const issueDate = registerIssueDate(row);
    const setName = row?.files?.milestoneName || null;
    const transmittalNumber = row?.files?.transmittalNumber || null;
    for (const s of sheetsOf(row)) {
      const c = canonicalSheet(s);
      if (!c) {
        unusable.push({
          recordedAs: s?.sheetNo ?? null,
          filename: s?.filename ?? null,
          fromSet: setName,
          transmittalNumber,
        });
        continue;
      }
      if (current.has(c.sheetNo)) { supersededCount++; continue; }
      current.set(c.sheetNo, {
        sheetNo: c.sheetNo,
        discipline: c.discipline,
        title: String(s?.title || "").replace(/\s+/g, " ").trim() || null,
        revision: s?.revision ?? null,
        revisionDate: s?.revisionDate ?? null,
        issuedIn: setName,
        transmittalNumber,
        issueDate,
        backfilled: row?.files?.backfilled === true,
        folderUrl: row?.sp_folder_url || null,
      });
      const key = `${issueDate}|${setName ?? ""}`;
      let ss = sourceSets.get(key);
      if (!ss) {
        ss = { setName, issueDate, transmittalNumbers: new Set(), currentSheets: 0 };
        sourceSets.set(key, ss);
      }
      ss.currentSheets++;
      if (transmittalNumber) ss.transmittalNumbers.add(transmittalNumber);
    }
  }

  const all = [...current.values()].sort((a, b) =>
    disciplineRank(a.discipline) - disciplineRank(b.discipline) ||
    a.discipline.localeCompare(b.discipline) ||
    sheetRank(a.sheetNo) - sheetRank(b.sheetNo) ||
    a.sheetNo.localeCompare(b.sheetNo));

  const disciplines = [];
  for (const s of all) {
    let d = disciplines[disciplines.length - 1];
    if (!d || d.discipline !== s.discipline) {
      d = { discipline: s.discipline, name: DISCIPLINE_NAME[s.discipline] || s.discipline, sheetCount: 0, sheets: [] };
      disciplines.push(d);
    }
    d.sheetCount++;
    const sheet = { ...s };
    delete sheet.discipline;
    d.sheets.push(sheet);
  }

  return {
    disciplines,
    sheetCount: all.length,
    supersededCount,
    sourceSets: [...sourceSets.values()]
      .sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate)))
      .map((s) => ({ ...s, transmittalNumbers: [...s.transmittalNumbers].sort() })),
    unusable,
  };
}

// ── harness ────────────────────────────────────────────────────────────────
let ran = 0, failures = 0;
function check(cond, label) {
  ran++;
  if (!cond) { failures++; console.error(`  FAIL: ${label}`); }
}

// ── fixtures: real SAPX196006.00 register rows, newest first ───────────────
const row = (tno, setName, issuedAt, sheets, backfilled = true) => ({
  created_at: issuedAt + " 12:00:00+00",
  sp_folder_url: "https://setty.sharepoint.com/sites/NYCProjects/x/Outgoing/" + encodeURIComponent(setName),
  files: { transmittalNumber: tno, milestoneName: setName, issuedAt, backfilled, sheets },
});

// Bulletin #13: BOTH sheets recorded as the series "STTQ-01". Real, verbatim.
const T001 = row("T-001", "2026-04-17_Bulletin #13", "2026-04-17", [
  { title: "E Bulletin #13", sheetNo: "STTQ-01", filename: "STTQ-01-E_Bulletin #13.pdf", revision: "0", discipline: "STTQ" },
  { title: "M Bulletin #13", sheetNo: "STTQ-01", filename: "STTQ-01-M_Bulletin #13.pdf", revision: "0", discipline: "STTQ" },
]);
// Bulletin #2 Resubmission: TECHNOLOGY sheets filed as discipline "Electrical".
const T023 = row("T-023", "2025-07-08_Bulletin #2_Resubmission", "2025-07-08", [
  { title: "TECHNOLOGY AND SECURITY LEGEND AND NOTES", sheetNo: "T-001", filename: "T001 - TECHNOLOGY AND SECURITY LEGEND AND NOTES.pdf", revision: "0", discipline: "Electrical" },
  { title: "GROUND FLOOR PLAN EAST WING TECHNOLOGY AND SECURITY PLAN", sheetNo: "T-111", filename: "T111 - GROUND FLOOR PLAN - EAST WING -TECHNOLOGY AND SECURITY PLAN.pdf", revision: "0", discipline: "Electrical" },
]);
// Addendum #1, electrical. E-211 here is REISSUED later by nothing, but is also
// present in the 2019 baseline below — the newer row must win.
const T014 = row("T-014", "2025-01-21_Addendum #1", "2025-01-21", [
  { title: "GENERAL NOTES, SYMBOLS & ABBREVIATIONS", sheetNo: "E-001", filename: "E001 - GENERAL NOTES, SYMBOLS & ABBREVIATIONS.pdf", revision: "0", discipline: "Electrical" },
  { title: "GROUND FLOOR PLAN EAST WING ELECTRICAL POWER", sheetNo: "E-211", filename: "E211 - GROUND FLOOR PLAN - EAST WING - ELECTRICAL POWER.pdf", revision: "0", discipline: "Electrical" },
]);
// The 2019 baseline: same sheets, no titles, written "E-001" / "E-111".
const T009 = row("T-009", "2019-11-22_Final CD Submission", "2019-11-22", [
  { title: "", sheetNo: "E-001", filename: "E001.pdf", revision: "0", discipline: "Electrical" },
  { title: "", sheetNo: "E-111", filename: "E111.pdf", revision: "0", discipline: "Electrical" },
  { title: "", sheetNo: "E-211", filename: "E211.pdf", revision: "0", discipline: "Electrical" },
]);
const T011 = row("T-011", "2019-11-22_Final CD Submission", "2019-11-22", [
  { title: "", sheetNo: "M-121", filename: "M121.pdf", revision: "0", discipline: "Mechanical" },
  { title: "", sheetNo: "M-601", filename: "M601.pdf", revision: "0", discipline: "Mechanical" },
]);
const T010 = row("T-010", "2019-11-22_Final CD Submission", "2019-11-22", [
  { title: "", sheetNo: "FP-111", filename: "FP111.pdf", revision: "0", discipline: "Fire Protection" },
]);

const REGISTER = [T001, T023, T014, T009, T011, T010];
const out = composeCurrentSet(REGISTER);

// ── 1. Supersession: newest issuance of a sheet wins ───────────────────────
const flat = new Map(out.disciplines.flatMap((d) => d.sheets.map((s) => [s.sheetNo, s])));
check(flat.has("E211"), "E211 is in the current set");
check(flat.get("E211").issuedIn === "2025-01-21_Addendum #1",
  "E211 is shown at its ADDENDUM #1 issuance, not the 2019 baseline it also appears in");
check(flat.get("E211").title === "GROUND FLOOR PLAN EAST WING ELECTRICAL POWER",
  "...and carries the newer row's title, not the baseline's empty one");
check(flat.get("E001").issuedIn === "2025-01-21_Addendum #1", "E001 likewise resolves to the newer set");
check(flat.get("E111").issuedIn === "2019-11-22_Final CD Submission",
  "E111, never reissued, still resolves to the baseline");
// E001 and E211 are each seen twice (Addendum #1, then the 2019 baseline).
check(out.supersededCount === 2, `2 older sightings were superseded (got ${out.supersededCount})`);

// ── 2. Sheet numbers normalise across eras ─────────────────────────────────
// "E-211" and "E211" are one sheet. Without this the composite double-counts
// every sheet the 2019 set and a later addendum both contain.
check(canonicalSheet({ sheetNo: "E-211" }).sheetNo === "E211", "a hyphenated sheet number normalises");
check(canonicalSheet({ sheetNo: "E211" }).sheetNo === "E211", "an unhyphenated one lands on the same key");
check(canonicalSheet({ sheetNo: "fp 301a" }).sheetNo === "FP301A", "case, spaces and a revision suffix are handled");
check([...flat.keys()].filter((k) => k === "E211").length === 1, "E211 appears exactly once in the output");

// ── 3. Discipline comes from the PREFIX, never the stored field ────────────
const techs = out.disciplines.find((d) => d.discipline === "T");
check(!!techs, "a Technology discipline group exists");
check(techs.sheetCount === 2, `both T sheets grouped under T (got ${techs?.sheetCount})`);
check(techs.name === "Technology", "the group is named Technology");
const elec = out.disciplines.find((d) => d.discipline === "E");
check(!elec.sheets.some((s) => s.sheetNo.startsWith("T")),
  "the T sheets did NOT land under Electrical, despite the register saying discipline:'Electrical'");
check(canonicalSheet({ sheetNo: "FP-111", discipline: "Fire Protection" }).discipline === "FP",
  "FP is read as a two-letter prefix, not as F");

// ── 4. A building series is unusable, not a sheet ──────────────────────────
check(canonicalSheet({ sheetNo: "STTQ-01" }) === null, "a 4-letter series prefix is rejected");
check(out.unusable.length === 2, `both Bulletin #13 rows are reported unusable (got ${out.unusable.length})`);
check(out.unusable.every((u) => u.recordedAs === "STTQ-01"), "...and say what was recorded");
check(out.unusable[0].filename === "STTQ-01-E_Bulletin #13.pdf", "...and name the file, so it can be re-read");
check(!flat.has("STTQ01"), "the series never becomes a sheet in the set");
// The whole point: two different sheets must not collapse onto one key.
check(out.unusable[0].filename !== out.unusable[1].filename,
  "the E and M sheets stayed distinct rather than folding onto one 'STTQ-01' row");

// ── 5. Ordering is SET order, then sheet number ────────────────────────────
check(out.disciplines.map((d) => d.discipline).join(",") === "M,FP,E,T",
  `disciplines run in set order M,FP,E,T (got ${out.disciplines.map((d) => d.discipline).join(",")})`);
check(disciplineRank("M") < disciplineRank("E"), "mechanical precedes electrical");
check(disciplineRank("ZZ") === DISCIPLINE_ORDER.length, "an unknown discipline sorts last");
check(elec.sheets.map((s) => s.sheetNo).join(",") === "E001,E111,E211", "sheets ascend within a discipline");
// A string sort puts E1000 before E221, which reads as a renumbered set.
check(sheetRank("E1000") > sheetRank("E221"), "sheet numbers sort numerically, not as strings");
check(sheetRank("FP301A") === 301, "a revision suffix does not break the numeric sort");

// ── 6. Provenance is reported, because the register is uneven ──────────────
// T001, T111, E001, E111, E211, M121, M601, FP111. The two "STTQ-01" rows are
// NOT among them, which is the point of section 4.
check(out.sheetCount === 8, `8 real sheets composed (got ${out.sheetCount})`);
check(out.disciplines.reduce((n, d) => n + d.sheetCount, 0) === out.sheetCount,
  "the discipline counts add up to the total");
check(out.sourceSets.length === 3, `3 sets contribute current sheets (got ${out.sourceSets.length})`);
check(out.sourceSets[0].issueDate === "2025-07-08", "source sets are listed newest first");
check(out.sourceSets[0].setName === "2025-07-08_Bulletin #2_Resubmission", "...named");
const baseline = out.sourceSets.find((s) => s.issueDate === "2019-11-22");
check(baseline.currentSheets === 4, `the baseline still supplies 4 current sheets (got ${baseline?.currentSheets})`);
check(baseline.transmittalNumbers.join(",") === "T-009,T-010,T-011",
  "one set spanning several discipline transmittals lists all of them");
check(flat.get("E211").backfilled === true, "a backfilled origin is carried through to the sheet");
check(flat.get("E211").transmittalNumber === "T-014", "each sheet names the transmittal it came in on");
check(out.disciplines.every((d) => d.sheets.every((s) => s.discipline === undefined)),
  "discipline is not repeated on every sheet — the group already states it");

// ── 7. Degenerate input ────────────────────────────────────────────────────
const empty = composeCurrentSet([]);
check(empty.sheetCount === 0 && empty.disciplines.length === 0, "an empty register composes to an empty set");
check(composeCurrentSet([row("T-1", "s", "2026-01-01", [])]).sheetCount === 0, "a set with no sheets contributes none");
check(canonicalSheet({ sheetNo: "" }) === null, "a blank sheet number is rejected");
check(canonicalSheet({}) === null, "a missing sheet number is rejected");
check(canonicalSheet({ sheetNo: "E1" }) === null, "a one-digit number is rejected as too short to be a sheet");

// ── 8. Drift check against the shipped source ──────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
check(shipped.includes("const SHEET_NO_RE = /^([A-Z]{1,3})[-_ ]?(\\d{2,4}[A-Z]?)$/;"),
  "SHEET_NO_RE has DRIFTED from this test's copy");
check(shipped.includes('const DISCIPLINE_ORDER = ["G", "M", "MS", "P", "FP", "FA", "E", "ES", "T", "TS", "EN"];'),
  "DISCIPLINE_ORDER has DRIFTED from this test's copy");
check(shipped.includes("function composeCurrentSet(rows: any[])"), "composeCurrentSet is still defined in index.ts");
check(shipped.includes("return { sheetNo: m[1] + m[2], discipline: m[1] };"),
  "canonicalSheet still derives discipline from the sheet-number prefix");
check(/subfolder: z\.string\(\)\.optional\(\)/.test(shipped),
  "subfolder is still OPTIONAL, which is what makes the full set the default");
check(shipped.includes('mode: "current-full-set"'), "the default path still reports mode current-full-set");

const total = ran;
console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (real register fixtures: 6 transmittals across 4 sets, 6 drift checks)`);
process.exit(failures ? 1 : 0);
