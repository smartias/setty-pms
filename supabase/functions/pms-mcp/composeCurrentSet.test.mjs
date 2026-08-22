// Tests for the transmittal-register FOLD — how "the current set" is composed
// from pms_filing_log rows tagged operation = 'transmittal-generated'.
//
//   node supabase/functions/pms-mcp/composeCurrentSet.test.mjs
//
// The fold now lives in currentSet.ts (the Edge source of truth) and is MIRRORED
// for the browser in currentSetFold.js. This test imports BOTH directly — the .ts
// is importable now that it no longer boots a server — runs the behavioural
// assertions against the Edge source, and then asserts the browser mirror produces
// byte-identical output on the same real fixtures. That equivalence is the drift
// guard: the "Current Set" panel and the connector cannot answer differently.
//
// Every sheet fixture is REAL, read verbatim out of pms_filing_log rows tagged
// operation = 'transmittal-generated' for SAPX196006.00 on 2026-08-02. Two defects
// this file pins down are both invisible to synthetic data:
//   1. The register's own `discipline` field is wrong (Bulletin #2's TECHNOLOGY
//      sheets stored as "Electrical"). Only the sheet-number prefix is reliable.
//   2. Some rows record a building SERIES ("STTQ-01") for BOTH an E and an M sheet.
//      Folding on that key would collapse two disciplines into one row.

import {
  composeCurrentSet, canonicalSheet, disciplineRank, sheetRank,
  DISCIPLINE_ORDER, registerIssueDate, prepareRegisterRows,
} from "./currentSet.ts";
import * as browser from "../../../currentSetFold.js";
import { readFileSync } from "node:fs";

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
// Addendum #1, electrical. E-211 here is also present in the 2019 baseline below —
// the newer row must win.
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
check(out.supersededCount === 2, `2 older sightings were superseded (got ${out.supersededCount})`);

// ── 2. Sheet numbers normalise across eras ─────────────────────────────────
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
check(out.unusable[0].filename !== out.unusable[1].filename,
  "the E and M sheets stayed distinct rather than folding onto one 'STTQ-01' row");

// ── 5. Ordering is SET order, then sheet number ────────────────────────────
check(out.disciplines.map((d) => d.discipline).join(",") === "M,FP,E,T",
  `disciplines run in set order M,FP,E,T (got ${out.disciplines.map((d) => d.discipline).join(",")})`);
check(disciplineRank("M") < disciplineRank("E"), "mechanical precedes electrical");
check(disciplineRank("ZZ") === DISCIPLINE_ORDER.length, "an unknown discipline sorts last");
check(elec.sheets.map((s) => s.sheetNo).join(",") === "E001,E111,E211", "sheets ascend within a discipline");
check(sheetRank("E1000") > sheetRank("E221"), "sheet numbers sort numerically, not as strings");
check(sheetRank("FP301A") === 301, "a revision suffix does not break the numeric sort");

// ── 6. Provenance is reported, because the register is uneven ──────────────
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

// ── 8. prepareRegisterRows: drop superseded, order newest-issue-first ──────
const supersededRow = { ...T014, files: { ...T014.files, superseded: true } };
const raw = [T009, T001, supersededRow, T023]; // deliberately out of order, one stale
const prepped = prepareRegisterRows(raw);
check(!prepped.some((r) => r.files.superseded === true), "a marked-superseded row is dropped before folding");
check(prepped.length === 3, `three live rows remain (got ${prepped.length})`);
check(registerIssueDate(prepped[0]) >= registerIssueDate(prepped[prepped.length - 1]),
  "rows come out newest-issue-first");
check(prepped[0].files.transmittalNumber === "T-001", "Bulletin #13 (2026-04-17) sorts first");
check(prepareRegisterRows([]).length === 0, "an empty register prepares to empty");
// The whole browser path in one call: raw rows -> prepare -> compose.
check(composeCurrentSet(prepareRegisterRows(raw)).sheetCount ===
  composeCurrentSet(prepareRegisterRows(raw)).disciplines.reduce((n, d) => n + d.sheetCount, 0),
  "prepare+compose is internally consistent");

// ── 9. DRIFT GUARD: the browser mirror matches the Edge source exactly ─────
// This is what lets the panel and the connector share one answer. If someone
// edits currentSet.ts without mirroring currentSetFold.js (or vice versa), the
// composed output diverges and this fails.
const edgeJson = JSON.stringify(out);
const browserJson = JSON.stringify(browser.composeCurrentSet(REGISTER));
check(edgeJson === browserJson, "currentSetFold.js composes IDENTICALLY to currentSet.ts on the real register");
check(browser.composeCurrentSet([]).sheetCount === 0, "the mirror handles the empty register too");
for (const s of ["E-211", "fp 301a", "STTQ-01", "E1", ""]) {
  check(JSON.stringify(browser.canonicalSheet({ sheetNo: s })) === JSON.stringify(canonicalSheet({ sheetNo: s })),
    `canonicalSheet agrees across edge/browser for "${s}"`);
}
check(browser.SHEET_NO_RE.source === "^([A-Z]{1,3})[-_ ]?(\\d{2,4}[A-Z]?)$",
  "the mirror's SHEET_NO_RE is the shared pattern");
check(browser.DISCIPLINE_ORDER.join(",") === DISCIPLINE_ORDER.join(","), "DISCIPLINE_ORDER matches across edge/browser");
check(JSON.stringify(browser.prepareRegisterRows(raw)) === JSON.stringify(prepped),
  "prepareRegisterRows agrees across edge/browser");

// ── 10. GUARD: index.ts delegates to the module, does not redefine the fold ─
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
check(/from ["']\.\/currentSet\.ts["']/.test(shipped), "index.ts imports the fold from ./currentSet.ts");
check(!/function composeCurrentSet\s*\(/.test(shipped), "index.ts no longer DEFINES composeCurrentSet (it imports it)");
check(shipped.includes('mode: "current-full-set"'), "the get_current_set handler still reports mode current-full-set");
check(/subfolder: z\.string\(\)\.optional\(\)/.test(shipped), "subfolder is still OPTIONAL — the full set is the default");

const total = ran;
console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (real register fixtures; edge/browser equivalence + index.ts delegation verified)`);
process.exit(failures ? 1 : 0);
