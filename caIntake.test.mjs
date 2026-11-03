// Portal email parsers (caIntake.js) against trimmed copies of real Procore
// notification emails from the filed log (pms_project_emails, 2026-06 to
// 2026-10). Names and long bodies are cut down; the label/value layout,
// spacing and subject shapes are kept exactly, since that is what the
// parsers depend on.
//
//   node --test caIntake.test.mjs
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  parseProcore, parseProcoreSub, parseForma, parseNewformaFwdRfi, parseNewformaFwdSub,
  collapse, normDate, VENDORS, vendorPool, planIntake, RFI_DISC, SUB_DISC,
} from "./caIntake.js";

const mail = (subject, body, extra = {}) => ({
  record_id: extra.record_id || "rec-" + subject.length, subject, body_text: body,
  from_name: extra.from_name || "", from_address: extra.from_address || "Gilbane_Building_Company@procoretech.com",
  email_date: extra.email_date || "2026-10-30T13:00:00+00:00", sp_folder_url: extra.sp_folder_url || "",
});

const RFI_BODY_PREFIXED = `James Kemp opened a new RFI. Ball is in your court. \n\n\n\nGilbane Building Company\nJ10313.000 - Brooklyn Public Library New Lots Library\n\n\n\nJames Kemp (Gilbane Building Company) opened an RFI. Ball is in your court. \n\nRFI RFI-91: Condensate lines in cellar \n\n\n\nHi Lesley, \nJames Kemp (Gilbane Building Company) created this RFI. Your action is required by the following due date. \n\nDue Date: \nJuly 7, 2026\n\n\n\n\n\nView in Procore \n\n\n\nQuestion \nAsked by: \n\nJames Kemp\n\n\nLocation: \n\n-- \n\n\n\nQuestion: \n\nDrawing M-200 shows two different condensate lines we have questions about how they terminate. \n\n\n\n\n\nAttachments :\n\n--\n\n\n\n\n\nAdditional Information \nResponsible Contractor: \n\n-- \n\nDate Initiated: \n\nJune 30, 2026\n\n\n\n\nSubject: \n\nCondensate lines in cellar\n`;

const RFI_BODY_PLAIN = `Hailey Cornell (Gilbane Building Company) opened an RFI. Ball is in your court. \n\nRFI 2218: CP - Automated Isolation Valves for OP Secondary Pumps \n\n\n\nHi David, \n\nDue Date: \nNovember 6, 2026\n\n\n\nQuestion \nAsked by: \n\nHailey Cornell\n\n\nLocation: \n\nCP - Chiller Plant\n\n\n\nQuestion: \n\nEngineer to confirm if automated isolation valves are truly required.\n\n\n\nAttachments :\n\n--\n\n\nAdditional Information \nDate Initiated: \n\nOctober 30, 2026\n`;

test("Procore RFI numbered RFI-91 (the production miss in the proposal)", () => {
  const e = parseProcore(mail("Action Required: J10313.000, Brooklyn Public Library New Lots Library: New RFI #RFI-91, Condensate lines in cellar", RFI_BODY_PREFIXED));
  assert.ok(e, "must parse");
  assert.equal(e.extNum, "91");
  assert.equal(e.event, "New RFI");
  assert.equal(e.title, "Condensate lines in cellar");
  assert.equal(e.dueDate, "2026-07-07");
  assert.equal(e.dateInit, "2026-06-30");
  assert.equal(e.askedBy, "James Kemp");
  assert.match(e.question, /^Drawing M-200 shows two different condensate lines/);
});

test("Procore RFI with a plain number", () => {
  const e = parseProcore(mail("Action Required: J10096.100, M&T Bank Stadium Renovations: New RFI #2218, CP - Automated Isolation Valves for OP Secondary Pumps", RFI_BODY_PLAIN));
  assert.equal(e.extNum, "2218");
  assert.equal(e.title, "CP - Automated Isolation Valves for OP Secondary Pumps");
  assert.equal(e.dueDate, "2026-11-06");
  assert.equal(e.dateInit, "2026-10-30");
});

test("Procore RFI events: response, status update, closed (title from subject when body is empty)", () => {
  const r = parseProcore(mail("23-068, 23-068 - Amex - Lounge Building Program - EWR - C&S: Response to RFI #662, Fire Alarm Drawing Update", ""));
  assert.deepEqual([r.extNum, r.event, r.title], ["662", "Response to RFI", "Fire Alarm Drawing Update"]);
  const s = parseProcore(mail("23-068, Amex: Status Update on RFI #664, FTR-3 Electric Heater – Equipment Rating", ""));
  assert.deepEqual([s.extNum, s.event], ["664", "Status Update on RFI"]);
  const c = parseProcore(mail("21417-215, NVCC - Bisdorf HVAC Renovations: RFI Closed, #17, New Riser Installation Requirements", ""));
  assert.deepEqual([c.extNum, c.event, c.title], ["17", "RFI Closed", "New Riser Installation Requirements"]);
  const cp = parseProcore(mail("J1, Proj: RFI Closed, #RFI-91, Condensate lines in cellar", ""));
  assert.equal(cp.extNum, "91");
});

test("Procore RFI parser ignores submittals, meetings and overdue reminders", () => {
  assert.equal(parseProcore(mail("21417-215, NVCC: Submittal Distributed 262416-1.0, Panelboard", "")), null);
  assert.equal(parseProcore(mail("Massanetta Springs Hotel: Meeting 4 - Pre-Construction OAC Minutes", "")), null);
  assert.equal(parseProcore(mail("You have 3 overdue RFIs on Proj: New RFI #4, x", "")), null);
});

const SUB_DISTRIBUTED = `Lauren Eckenrode distributed this submittal. \n\n\nGCS, Inc.\n21417-215 - NVCC - Bisdorf HVAC Renovations\n\n\n\nLauren Eckenrode (GCS, Inc.) distributed a submittal. \n\nSubmittal 262416-1.0: Panelboard and Accessories - Product Data. \n\n\n\nHi Daniel, \n\nDistribution Message: \n\nPlease see attached Approved as Noted submittal for the panelboards.\n\n\n\nRecipients: \nSetty CA (Setty & Associates Int.)\n\n\nView in Procore \n\n\n\nDistributed Responses \n\nResponder’s Name: \n\nSetty CA (Setty & Associates Int.) \n\nResponse: \n\nApproved as Noted\n\n\n\n\nComments: \n\nGENERAL NOTES: \n\nElectrical drawings are graphical representations.\n\n\nAttachments :\n\n262416-001-0 Response 10302026.pdf \n`;

const SUB_APPROVER = `Setty CA Approved as Noted this submittal. \n\n\nGCS, Inc.\n21417-215 - NVCC - Bisdorf HVAC Renovations\n\n\n\nSetty CA responded to a submittal. \n\nSubmittal 262416-1.0: Panelboard and Accessories - Product Data. \n\n\n\nHi Daniel, \nSetty CA responded to this submittal. \n\nBall in court: \nLauren Eckenrode (GCS, Inc.) \n\n\n\nBall in court due date: \nOctober 28, 2026\n\n\n\nResponse: \nApproved as Noted\n\n\n\nComments: \n\nGENERAL NOTES: \n\n\n\nView in Procore \n\n\n\nGeneral Information \nResponsible Contractor: \n\nPaul Francis & Company dba Bailey & Shipp Electric\n\n\nFinal Due Date: \n\nOctober 28, 2026\n\n\n\n\nSpec Section: \n\n262416 - PANELBOARDS \n\nType: \n\nProduct Information\n`;

test("Procore submittal distributed: Newforma-style id, stamp, Returned", () => {
  const e = parseProcoreSub(mail("21417-215, NVCC - Bisdorf HVAC Renovations: Submittal Distributed 262416-1.0, Panelboard and Accessories - Product Data", SUB_DISTRIBUTED, { from_address: "GCS-SIGAL@procoretech.com" }));
  assert.equal(e.extNum, "262416-001");
  assert.equal(e.rev, 0);
  assert.equal(e.event, "distributed");
  assert.equal(e.status, "Returned");
  assert.equal(e.stamp, "Approved as Noted");
  assert.equal(e.title, "Panelboard and Accessories - Product Data");
});

test("Procore submittal: Setty approver response carries spec, due date, contractor", () => {
  const e = parseProcoreSub(mail("21417-215, NVCC - Bisdorf HVAC Renovations: Approver Setty CA Updated their Response for Submittal 262416-1.0, Panelboard and Accessories - Product Data", SUB_APPROVER, { from_name: "Setty CA (Setty & Associates Int.)" }));
  assert.equal(e.event, "approver-response");
  assert.equal(e.status, "Returned");
  assert.equal(e.stamp, "Approved as Noted");
  assert.equal(e.specSection, "262416 - PANELBOARDS");
  assert.equal(e.dueDate, "2026-10-28");
  assert.equal(e.ballInCourt, "Lauren Eckenrode (GCS, Inc.)");
});

test("Procore submittal: other approver / submitter updates stay open; revision and repeated-number title", () => {
  const a = parseProcoreSub(mail("23-068, Amex: Approver Isaiah Felton Updated their Response for Submittal 089100-7.1, AELXP - L1 & L2 Louver Shop Drawings - For Record", ""));
  assert.deepEqual([a.extNum, a.rev, a.status], ["089100-007", 1, "Under Review"]);
  const s = parseProcoreSub(mail("Action Required: 60736219, JMU Johnston Hall: Submitter Garrett Dawson Updated their Response for Submittal 238219-1.0, Fan Coil Units - Product Data and Shop Drawings", ""));
  assert.deepEqual([s.extNum, s.event, s.status, s.specSection], ["238219-001", "submitter-response", "Received", "238219"]);
  const t = parseProcoreSub(mail("01-26015-00, Renov. Elstad Auditorium at GU: Approver Setty CA Updated their Response for Submittal 110000-1.1, 110000-001-1 - Storage Container - Shop Drawings", ""));
  assert.deepEqual([t.extNum, t.rev, t.title], ["110000-001", 1, "Storage Container - Shop Drawings"]);
  assert.equal(parseProcoreSub(mail("J1, Proj: New RFI #4, x", "")), null);
});

test("collapse: Procore submittal events fold into one row, newest status wins, stamp kept", () => {
  const evs = [
    parseProcoreSub(mail("P: Submitter Lauren Eckenrode Updated their Response for Submittal 262416-1.0, Panelboard", "", { email_date: "2026-10-20T10:00:00Z" })),
    parseProcoreSub(mail("P: Approver Setty CA Updated their Response for Submittal 262416-1.0, Panelboard", SUB_APPROVER, { email_date: "2026-10-30T11:50:00Z" })),
    parseProcoreSub(mail("P: Submittal Distributed 262416-1.0, Panelboard", SUB_DISTRIBUTED, { email_date: "2026-10-30T13:41:00Z" })),
  ];
  const rows = collapse(evs, "submittal");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Returned");
  assert.equal(rows[0].stamp, "Approved as Noted");
  assert.equal(rows[0].dateReceived, "2026-10-20");
  assert.equal(rows[0].lastDate, "2026-10-30");
});

test("collapse: Procore RFI new then closed → Closed, received date from Date Initiated", () => {
  const evs = [
    parseProcore(mail("A: J1, P: New RFI #RFI-91, Condensate lines in cellar", RFI_BODY_PREFIXED, { email_date: "2026-06-30T13:54:00Z" })),
    parseProcore(mail("J1, P: RFI Closed, #RFI-91, Condensate lines in cellar", "", { email_date: "2026-07-10T09:00:00Z" })),
  ];
  const [r] = collapse(evs, "rfi");
  assert.deepEqual([r.extNum, r.status, r.dateReceived, r.dueDate, r.from], ["91", "Closed", "2026-06-30", "2026-07-07", "James Kemp"]);
});

test("vendor table: both Procore parsers see Procore mail, Forma's does not", () => {
  const emails = [mail("P: Submittal Distributed 262416-1.0, Panelboard", SUB_DISTRIBUTED, { from_address: "GCS-SIGAL@procoretech.com" })];
  const hits = VENDORS.map((v) => vendorPool(v, emails).map(v.parse).filter(Boolean).length);
  // [Procore RFI, Procore submittal, Forma, Newforma RFI, Newforma submittal]
  assert.deepEqual(hits, [0, 1, 0, 0, 0]);
});

test("unchanged parsers still work (Forma, Newforma forwards)", () => {
  const f = parseForma(mail("Submittal #56 is ready", "Item #56 (Rev 2) VAV Boxes\nItem Details\nSpec Section\n23 36 00\nStatus\nOpen\nDue Date\nNov 5, 2026\n", { from_address: "no-reply@mail.forma.autodesk.com" }));
  assert.deepEqual([f.extNum, f.rev, f.specSection, f.dueDate], ["56", 2, "23 36 00", "2026-11-05"]);
  const nr = parseNewformaFwdRfi(mail("RFI Forwarded: Refrigeration Liquid Line Insulation - RFI:074:SM1mU", ""));
  assert.deepEqual([nr.extNum, nr.title], ["74", "Refrigeration Liquid Line Insulation"]);
  const ns = parseNewformaFwdSub(mail("Submittal Forwarded: Closeout Submittal - 17 - Submittal:017800-001-0:u5vTT", ""));
  assert.deepEqual([ns.extNum, ns.rev], ["017800-001", 0]);
});

test("normDate: long, short and numeric US dates", () => {
  assert.equal(normDate("July 7, 2026"), "2026-07-07");
  assert.equal(normDate("Nov 5, 2026"), "2026-11-05");
  assert.equal(normDate("1/7/2026"), "2026-01-07");
  assert.equal(normDate("--"), "");
  assert.equal(normDate("13/40/2026"), "");
});

test("tracker page loads caIntake.js and no longer carries its own parsers", () => {
  const html = readFileSync(new URL("./RFISubmittalSync_Preview.html", import.meta.url), "utf8");
  assert.match(html, /import \* as CaIntake from "\.\/caIntake\.js"/);
  assert.doesNotMatch(html, /function parseProcore\(/);
  assert.match(html, /CI\.buildInbox\(/);
  assert.doesNotMatch(html, /function matchRFI\(|function toRfiRecord\(/);
});

test("the page's discipline lists match the module's (the import preview offers the page's)", () => {
  const html = readFileSync(new URL("./RFISubmittalSync_Preview.html", import.meta.url), "utf8");
  const arr = (name) => JSON.parse(html.match(new RegExp("const " + name + " = (\\[[^\\]]*\\]);"))[1]);
  assert.deepEqual(arr("RFI_DISC"), RFI_DISC);
  assert.deepEqual(arr("SUB_DISC"), SUB_DISC);
});

test("planIntake: Procore only, new only, since-gated, marked Unreviewed", () => {
  const emails = [
    mail("P: New RFI #RFI-91, Condensate lines in cellar", RFI_BODY_PREFIXED, { email_date: "2026-10-30T10:00:00Z" }),
    mail("P: New RFI #4, Old", "", { email_date: "2026-01-01T10:00:00Z" }),
    mail("Submittal Forwarded: X - 1 - Submittal:017800-001-0:u5vTT", "", { from_address: "a@b.com", email_date: "2026-10-30T10:00:00Z" }),
  ];
  const plan = planIntake(emails, { rfis: [], submittals: [] }, "p1", { since: "2026-10-20", at: "T" });
  assert.deepEqual(plan.rfis.map((r) => r.number), ["RFI-091"]);
  assert.equal(plan.submittals.length, 0, "Newforma forwards stay manual");
  assert.equal(plan.skipped.old, 1);
  assert.deepEqual([plan.rfis[0].intakeReviewed, plan.rfis[0].intake], [false, { at: "T", by: "ca-items-intake", vendor: "Procore" }]);
});

test("platformOfEmail / detectPlatforms: the portal a project's mail comes from", async () => {
  const { platformOfEmail, detectPlatforms } = await import("./caIntake.js");
  assert.equal(platformOfEmail({ from_address: "Gilbane_Building_Company@procoretech.com" }), "Procore");
  assert.equal(platformOfEmail({ from_address: "no-reply@mail.forma.autodesk.com" }), "Autodesk Build");
  assert.equal(platformOfEmail({ from_address: "pm@page.com", subject: "RFI Forwarded: Insulation - RFI:074:x" }), "Newforma");
  assert.equal(platformOfEmail({ from_address: "a@b.com", subject: "DASNY PMWeb - CSI - Submittal Sets 056" }), "PMWeb");
  assert.equal(platformOfEmail({ from_address: "a@b.com", subject: "Meeting minutes" }), "");
  const d = detectPlatforms([
    { project_id: "p1", from_address: "x@procoretech.com" }, { project_id: "p1", from_address: "y@procoretech.com" },
    { project_id: "p1", subject: "RFI Forwarded: x" }, { project_id: "p2", subject: "Submittal Forwarded: y" },
    { project_id: "p3", subject: "hello" },
  ]);
  assert.deepEqual(d.p1, { platform: "Procore", counts: { Procore: 2, Newforma: 1 }, total: 3 });
  assert.equal(d.p2.platform, "Newforma");
  assert.equal(d.p3, undefined);
});
