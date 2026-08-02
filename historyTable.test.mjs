// Tests for renderHistoryTable() in transmittal.html — the Transmittal History
// panel, and specifically the row that expands to show the sheet register.
//
//   node historyTable.test.mjs
//
// The function is sliced out of transmittal.html and evaluated, so it cannot
// drift from the shipped markup. It is pure: it takes items and returns HTML.

import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./transmittal.html", import.meta.url), "utf8");
const a = html.indexOf("function renderHistoryTable(");
const b = html.indexOf("// Delegated so it survives every re-render");
if (a < 0 || b < 0 || b <= a) {
  console.error("FAIL: could not slice renderHistoryTable out of transmittal.html");
  process.exit(1);
}
const src = html.slice(a, b) + "\nexport { renderHistoryTable };";
const { renderHistoryTable } = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

let failures = 0, total = 0;
const check = (c, m) => { total++; if (!c) { failures++; console.error("FAIL: " + m); } };

// A backfilled row WITH a register, shaped exactly as pms_filing_log stores it.
const withSheets = {
  createdDateTime: "2026-04-17T12:00:00Z",
  sheets: [
    { sheetNo: "E221", title: "GROUND FLOOR PLAN - COMMONS", revision: "13", discipline: "Electrical", filename: "STTQ-01-E_Bulletin #13.pdf" },
    { sheetNo: "E602", title: "ELECTRICAL EQUIPMENT SCHEDULES", revision: "13", discipline: "Electrical", filename: "STTQ-01-E_Bulletin #13.pdf" },
  ],
  fields: { MilestoneName: "Bulletin #13", RecipientEmails: "", FileCount: 2, AnonymousLink: "", LinkExpiry: "", SenderUPN: "sara@setty.com", SenderDisplayName: "Sara", Status: "Logged (backfill)" },
};
// A send from before the register existed. It genuinely has no sheets.
const noSheets = {
  createdDateTime: "2026-05-18T21:17:58Z",
  sheets: [],
  fields: { MilestoneName: "", RecipientEmails: "", FileCount: "—", AnonymousLink: "", LinkExpiry: "", SenderUPN: "sara@setty.com", SenderDisplayName: "Sara", Status: "Sent" },
};

const out = renderHistoryTable([withSheets, noSheets]);

// ── The expand exists, and only where there is something to expand ─────────
check(out.includes('class="sheet-toggle"'), "a row with a register gets a toggle");
check((out.match(/class="sheet-toggle"/g) || []).length === 1,
  "the row WITHOUT a register gets no toggle, because there is nothing to show");
check(out.includes('id="sheet-detail-0"'), "the detail row is keyed to its parent row");
check(out.includes("hidden"), "the detail row starts collapsed");
check(out.includes('aria-expanded="false"'), "the toggle reports its state to assistive tech");
check(out.includes('colspan="7"'), "the detail row spans the full table");

// ── The register itself is rendered ────────────────────────────────────────
for (const v of ["E221", "GROUND FLOOR PLAN - COMMONS", "13", "Electrical", "STTQ-01-E_Bulletin #13.pdf"]) {
  check(out.includes(v), `the sheet register shows ${JSON.stringify(v)}`);
}
check(out.includes("E602"), "every sheet is listed, not just the first");

// ── Escaping. Sheet titles are user data and land inside markup ────────────
const nasty = renderHistoryTable([{
  createdDateTime: "2026-01-01",
  sheets: [{ sheetNo: "<img src=x onerror=alert(1)>", title: "A & B", revision: "", discipline: "", filename: "" }],
  fields: { MilestoneName: "<script>", RecipientEmails: "", FileCount: 1, AnonymousLink: "", LinkExpiry: "", SenderUPN: "", SenderDisplayName: "", Status: "" },
}]);
check(!nasty.includes("<img src=x"), "a sheet number containing markup is escaped");
check(nasty.includes("&lt;img"), "...and rendered as text");
check(!nasty.includes("<script>"), "a milestone name containing markup is escaped");
check(nasty.includes("A &amp; B"), "ampersands in titles are escaped");

// ── Empty values read as blanks, not as the string "undefined" ─────────────
const sparse = renderHistoryTable([{
  createdDateTime: "2026-01-01",
  sheets: [{ sheetNo: "", title: "", revision: "", discipline: "", filename: "" }],
  fields: { MilestoneName: "", RecipientEmails: "", FileCount: 1, AnonymousLink: "", LinkExpiry: "", SenderUPN: "", SenderDisplayName: "", Status: "" },
}]);
check(!sparse.includes("undefined"), "missing sheet fields never render as 'undefined'");
check(sparse.includes("—"), "...they render as the empty-value placeholder");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (renderHistoryTable evaluated from transmittal.html)`);
process.exit(failures ? 1 : 0);
