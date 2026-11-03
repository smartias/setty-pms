// "Reply in Procore" helpers in SettyPMS.html: which filed Procore email an
// RFI's response is drafted as a reply to, and the plain-text response.
// Sliced out of SettyPMS.html and evaluated, so the test cannot drift from
// the shipped code (same approach as historyTable.test.mjs).
//
//   node --test procoreReply.test.mjs
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./SettyPMS.html", import.meta.url), "utf8");
const a = html.indexOf("// ── REPLY IN PROCORE: pure helpers");
const b = html.indexOf("// ── end REPLY IN PROCORE helpers ──");
assert.ok(a > 0 && b > a, "helper block markers not found in SettyPMS.html");
const src = html.slice(a, b) + "\nexport { procoreRfiNumberOf, procoreSubjectIsRfi, pickProcoreNotification, procoreReplyText, isProcoreRfi };";
const H = await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

// Subjects copied from filed Procore notifications (pms_project_emails, 2026-06..10).
const row = (record_id, subject, email_date, from_address = "Gilbane_Building_Company@procoretech.com") =>
  ({ record_id, msg_id: "AAMk-" + record_id, subject, email_date, from_address });
const ROWS = [
  row("e1", "Action Required: J10313.000, Brooklyn Public Library New Lots Library: New RFI #RFI-91, Condensate lines in cellar", "2026-06-30T13:54:19Z"),
  row("e2", "J10313.000, Brooklyn Public Library New Lots Library: Response to RFI #RFI-91, Condensate lines in cellar", "2026-07-03T10:00:00Z"),
  row("e3", "J10313.000, Brooklyn Public Library New Lots Library: RFI Closed, #RFI-91, Condensate lines in cellar", "2026-07-10T10:00:00Z"),
  row("e4", "Action Required: J10313.000, BPL: New RFI #RFI-9, Something else", "2026-06-01T10:00:00Z"),
  row("e5", "J10313.000, BPL: New RFI #910, Not 91", "2026-07-01T10:00:00Z"),
  row("e6", "Meeting 4 - OAC Minutes", "2026-07-11T10:00:00Z"),
];

test("RFI number from the log record", () => {
  assert.equal(H.procoreRfiNumberOf({ number: "RFI-091" }), "91");
  assert.equal(H.procoreRfiNumberOf({ number: "RFI-091", extNumber: "91" }), "91");
  assert.equal(H.procoreRfiNumberOf({ number: "2218" }), "2218");
  assert.equal(H.procoreRfiNumberOf({ number: "" }), "");
});

test("subject matching: every Procore RFI shape, never a neighbouring number", () => {
  assert.ok(H.procoreSubjectIsRfi(ROWS[0].subject, "91"));
  assert.ok(H.procoreSubjectIsRfi(ROWS[2].subject, "91"));
  assert.ok(H.procoreSubjectIsRfi("23-068, Amex: Response to RFI #662, Fire Alarm", "662"));
  assert.ok(H.procoreSubjectIsRfi("21417-215, NVCC: RFI Closed, #17, New Riser", "17"));
  assert.ok(H.procoreSubjectIsRfi("23-068, Amex: Status Update on RFI #664, FTR-3", "664"));
  assert.ok(!H.procoreSubjectIsRfi(ROWS[3].subject, "91"), "RFI-9 is not RFI-91");
  assert.ok(!H.procoreSubjectIsRfi(ROWS[4].subject, "91"), "910 is not 91");
  assert.ok(!H.procoreSubjectIsRfi(ROWS[0].subject, "9"), "RFI-91 is not RFI-9");
  assert.ok(!H.procoreSubjectIsRfi(ROWS[0].subject, ""));
});

test("picks the New RFI notification, never the Closed one or another RFI", () => {
  assert.equal(H.pickProcoreNotification(ROWS, { number: "RFI-091" }).record_id, "e1");
  assert.equal(H.pickProcoreNotification(ROWS, { number: "RFI-009" }).record_id, "e4");
  assert.equal(H.pickProcoreNotification(ROWS, { number: "RFI-100" }), null);
  const onlyClosed = [ROWS[2]];
  assert.equal(H.pickProcoreNotification(onlyClosed, { number: "RFI-091" }), null);
});

test("prefers the email the item was imported from, if it is a live notification", () => {
  assert.equal(H.pickProcoreNotification(ROWS, { number: "RFI-091", sourceEmailId: "e2" }).record_id, "e2");
  assert.equal(H.pickProcoreNotification(ROWS, { number: "RFI-091", sourceEmailId: "e3" }).record_id, "e1", "a Closed source falls back");
  assert.equal(H.pickProcoreNotification(ROWS, { number: "RFI-091", sourceEmailId: "e5" }).record_id, "e1", "a source for another RFI is ignored");
});

test("ignores non-Procore senders even with a matching subject", () => {
  const fwd = [row("f1", "FW: J1, BPL: New RFI #RFI-91, Condensate", "2026-07-20T10:00:00Z", "sara.arias@setty.com")];
  assert.equal(H.pickProcoreNotification(fwd, { number: "RFI-091" }), null);
});

test("response rich text becomes plain text", () => {
  assert.equal(H.procoreReplyText("<p>Route the condensate in the east wall.</p><p>See M-200, note 4 &amp; detail 2.</p>"),
    "Route the condensate in the east wall.\nSee M-200, note 4 & detail 2.");
  assert.equal(H.procoreReplyText("<ul><li>One</li><li>Two</li></ul>"), "• One\n• Two");
  assert.equal(H.procoreReplyText("Line one<br>Line&nbsp;two"), "Line one\nLine two");
  assert.equal(H.procoreReplyText("<p> </p>"), "");
  assert.equal(H.procoreReplyText(""), "");
});

test("button shows for Procore projects and Procore-imported RFIs only", () => {
  assert.ok(H.isProcoreRfi({ caPortal: { platform: "Procore" } }, {}));
  assert.ok(H.isProcoreRfi({}, { intake: { vendor: "Procore" } }));
  assert.ok(H.isProcoreRfi({}, { notes: "Imported from Procore · RFI #91" }));
  assert.ok(!H.isProcoreRfi({ caPortal: { platform: "Newforma" } }, { notes: "Imported from Newforma · RFI #74" }));
  assert.ok(!H.isProcoreRfi({}, {}));
});
