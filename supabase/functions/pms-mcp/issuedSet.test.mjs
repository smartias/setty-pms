// Tests for issuedSet.ts: which transmittal-register rows get_current_set may
// treat as an issued set.
//
//   node supabase/functions/pms-mcp/issuedSet.test.mjs
//
// The BPL row is the real one (pms_filing_log, T-012, 2026-09-03) that made
// get_current_set report a single compliance PDF as the project's current set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notASetReason, isIssuedSetRow } from "./issuedSet.ts";
import { prepareRegisterRows } from "./currentSet.ts";

const BPL = "https://setty.sharepoint.com/sites/NYCProjects/Project Document Library/SAPX236012.00 - BPL New Lots";
const T012 = {
  id: 12, created_at: "2026-09-03T19:21:05.8848+00:00",
  sp_folder_url: BPL + "/01 📋 Project Management",
  files: {
    transmittalNumber: "T-012", milestoneName: "01 📋 Project Management", distributionKind: "send-email",
    sheets: [{ title: "BPL NEW LOTS ASHRAE 55 COMPLIANCE", sheetNo: "", filename: "BPL-NEW LOTS - ASHRAE 55 COMPLIANCE.pdf", revision: "0", discipline: "General" }],
  },
};
const T011 = {
  id: 11, created_at: "2026-06-24T15:00:00+00:00",
  sp_folder_url: BPL + "/99 📤 Outgoing/2026-06-24_Revised FDNY",
  files: { transmittalNumber: "T-011", milestoneName: "2026-06-24_Revised FDNY", sheets: [{ sheetNo: "FA-101", filename: "FA-101.pdf", revision: "2" }] },
};

test("a document emailed from outside Outgoing is not a set", () => {
  assert.match(notASetReason(T012), /01 📋 Project Management/);
  assert.equal(isIssuedSetRow(T012), false);
});

test("the newest real set wins once the non-set is dropped", () => {
  const rows = prepareRegisterRows([T011, T012]);
  assert.equal(rows[0].files.transmittalNumber, "T-012", "the compliance PDF is the newest row");
  assert.equal(rows.filter(isIssuedSetRow)[0].files.transmittalNumber, "T-011");
});

test("a bulletin with an unparsed filename still counts: it is under Outgoing", () => {
  // Real Tabler row (T-003): sheetNo "" and discipline "General", same shape as the BPL file.
  assert.equal(notASetReason({
    sp_folder_url: "https://setty.sharepoint.com/sites/NYCProjects/x/Outgoing/2025-04-10_Bulletin #1",
    files: { milestoneName: "2025-04-10_Bulletin #1", sheets: [{ sheetNo: "", filename: "2025-04-10_TablerQ_E_Bulletin #1.pdf", discipline: "General" }] },
  }), null);
});

test("sheets or spec sections make it a set wherever it was filed", () => {
  assert.equal(notASetReason({ sp_folder_url: BPL + "/02 Design", files: { sheets: [{ sheetNo: "E-221" }] } }), null);
  assert.equal(notASetReason({ sp_folder_url: BPL + "/02 Design", files: { sheets: [{ sheetNo: "23 05 00", kind: "spec" }] } }), null);
});

test("no evidence, no exclusion", () => {
  // Rows from before the sheet register carry no file list.
  assert.equal(notASetReason({ sp_folder_url: BPL + "/01 Project Management", files: { transmittalNumber: "T-001" } }), null);
  // No folder recorded at all.
  assert.equal(notASetReason({ files: { sheets: [{ sheetNo: "", filename: "memo.pdf" }] } }), null);
});

test("drive projects: the recorded drive folder is read the same way", () => {
  const sheets = [{ sheetNo: "", filename: "letter.pdf" }];
  assert.equal(notASetReason({ files: { driveFolder: "N:\\SAP\\2023\\X\\Outgoing\\2026-01-05_Bulletin 1", sheets } }), null);
  assert.match(notASetReason({ files: { driveFolder: "N:\\SAP\\2023\\X\\Correspondence", sheets } }), /Correspondence/);
});

test("a literal % in a decoded folder name does not throw", () => {
  assert.equal(notASetReason({ sp_folder_url: BPL + "/Outgoing/2025-08-22_100%_CD", files: { sheets: [{ sheetNo: "", filename: "book.pdf" }] } }), null);
});

// Drift anchors: the handler has to actually use the filter.
test("get_current_set filters the register through isIssuedSetRow", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes("const setRegister = rows.filter(isIssuedSetRow);"));
  assert.ok(src.includes("const candidates = disc ? setRegister.filter((r) => hasDiscipline(r, disc)) : setRegister;"));
});
