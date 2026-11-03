// node --test portalLogSpec.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { zip, unzip } from "./setty-docx.js";
import { PORTAL_LOG_FILE, contractorStatus, portalLogColumns, portalLogRows, buildPortalLogParts } from "./portalLogSpec.js";

const txt = (u8) => new TextDecoder().decode(u8);
const P = {
  projectNumber: "SAPX176021.01", name: "County of Dutchess 10 Market Street CA",
  rfis: [
    { number: "RFI-002", title: "Second <one>", status: "Responded", dateReceived: "2026-11-03", dueDate: "2026-11-10", dateResponded: "2026-11-05", portalReturn: { folderUrl: "https://sp/x/RFI-002" } },
    { number: "RFI-001", title: "First", extNumber: "Acme 1", status: "Open", dateReceived: "2026-11-02", dueDate: "2026-11-09", subRouting: { subId: "s1" }, notes: "internal only" },
    { number: "RFI-003", title: "Pending sub", status: "Pending Sub Response", intakeReviewed: false },
  ],
  submittals: [
    { number: "SUB-001", description: "Fans", specSection: "23 34 00", status: "Returned", stamp: "Approved as Noted", resubNumber: 1, dateReturned: "2026-11-06", portalReturn: { fileUrl: "https://sp/y/SUB-001.docx" } },
    { number: "SUB-002", description: "Pumps", status: "Pending Sub Review", stamp: "—" },
  ],
};

test("statuses are in the contractor's words", () => {
  assert.equal(contractorStatus({ status: "Pending Sub Response" }, "rfi"), "Open");
  assert.equal(contractorStatus({ status: "Responded" }, "rfi"), "Responded");
  assert.equal(contractorStatus({ status: "Closed" }, "rfi"), "Closed");
  assert.equal(contractorStatus({ status: "Void" }, "rfi"), "Void");
  assert.equal(contractorStatus({ status: "Pending Sub Review" }, "submittal"), "Under review");
  assert.equal(contractorStatus({ status: "Resubmittal Required" }, "submittal"), "Resubmittal required");
  assert.equal(contractorStatus({ status: "Returned" }, "submittal"), "Returned");
});

test("rows are oldest number first, carry only contractor-facing fields, and link the posted return", () => {
  const rows = portalLogRows(P, "rfi");
  assert.deepEqual(rows.map((r) => r.number), ["RFI-001", "RFI-002", "RFI-003"]);
  assert.equal(rows[0].ref, "Acme 1");
  assert.equal(rows[1].link, "https://sp/x/RFI-002");
  assert.equal(rows[1].returned, "2026-11-05");
  assert.equal(rows[2].status, "Open");
  for (const r of rows) assert.ok(!("notes" in r) && !("subRouting" in r));
  const subs = portalLogRows(P, "submittal");
  assert.equal(subs[0].stamp, "Approved as Noted");
  assert.equal(subs[0].revision, "1");
  assert.equal(subs[0].link, "https://sp/y/SUB-001.docx");
  assert.equal(subs[1].stamp, "", "the dash placeholder is not a stamp");
  assert.equal(subs[1].status, "Under review");
});

for (const type of ["rfi", "submittal"]) {
  test(`${type} log workbook is a complete package with title, note, header, rows and links`, async () => {
    const parts = buildPortalLogParts({ project: P, type, generatedAt: "2026-11-03T15:04:00Z" });
    const bytes = await zip(parts);
    const z = await unzip(bytes.buffer);
    for (const p of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) assert.ok(z.has(p), p);
    const sheet = txt(z.get("xl/worksheets/sheet1.xml"));
    assert.ok(sheet.includes("SETTY — " + (type === "rfi" ? "RFI Log" : "Submittal Log") + " — SAPX176021.01 - County of Dutchess"));
    assert.ok(sheet.includes("Generated 2026-11-03 15:04 UTC"));
    const cols = portalLogColumns(type);
    for (const c of cols) assert.ok(sheet.includes(`>${c.label}<`), "header " + c.label);
    assert.ok(sheet.includes("<f>HYPERLINK(&quot;https://sp/"), "hyperlink formula");
    assert.ok(sheet.includes("<v>Open</v>"), "cached link label");
    assert.ok(sheet.includes("Second &lt;one&gt;") || sheet.includes("Fans"));
    assert.ok(sheet.includes(`state="frozen"`) && sheet.includes("<autoFilter ref=\"A4:"));
    const wb = txt(z.get("xl/workbook.xml"));
    assert.ok(wb.includes("_xlnm._FilterDatabase") && wb.includes('fullCalcOnLoad="1"'));
  });
}

test("an empty log still opens and says so", async () => {
  const parts = buildPortalLogParts({ project: { name: "P", rfis: [] }, type: "rfi", generatedAt: "2026-11-03T15:04:00Z" });
  const sheet = txt(parts.find(([n]) => n === "xl/worksheets/sheet1.xml")[1]);
  assert.ok(sheet.includes("Nothing logged yet."));
  assert.equal(PORTAL_LOG_FILE.submittal, "Submittal Log.xlsx");
});

test("portalLogSpec.js has no imports, so the connector can run a copy on its own", async () => {
  const { readFileSync } = await import("node:fs");
  assert.ok(!/^\s*import\s/m.test(readFileSync(new URL("./portalLogSpec.js", import.meta.url), "utf8")));
});
