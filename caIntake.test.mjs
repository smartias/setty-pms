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
  // [Procore RFI, Procore submittal, Forma, Newforma RFI, Newforma submittal, Kahua RFI, Kahua submittal]
  assert.deepEqual(hits, [0, 1, 0, 0, 0, 0, 0]);
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

/* ---------- Newforma and Autodesk Forma, from real filed mail (2024-11..2026-11) ---------- */
const NF_RFI_BODY = "Project: 1018037.01 Stony Brook University, Tabler Quad New Residence Hall \n\n\nNotification about RFI Follow up to RFI 005 \n\nA RFI has been forwarded. \n\n\n\nRemarks \n\nSee RFI \n\n\n\n\nDownload all files \n\n\n\n\nRFI Info \n\nTo: Paul Conant (Page Southerland Page, Inc.); Sankeerth N.S.; SettyCA@setty.com (Setty) \nFrom: Eileen Duggan (Page Southerland Page, Inc.) \n\nPurpose: To Answer \nDue back: 11/10/2025 \nSender ID: RFI-005R \nRFI ID: RFI-005R \nExpiration Date: 11/16/2025 \n\n\nTransferred Files \nRFI-005R - Follow Up to RFI-005 Response (Bana-002) (1).pdf \n";
const NF_SUB_BODY = "Project: SAPX196019.00 NY SCA PS 163X \n\n\nNotification about Submittal R5 TAB Reports \n\nA Submittal has been forwarded. \n\n\n\nRemarks \n\n\nTeam, \n\nPlease review by 11/06 \n\nPROJECT NAME: \n\n\nDownload all files \n\n\n\n\nSubmittal Info \n\nTo: Sankeerth; Paul Dumitrescu; Arjun \nFrom: yashvanth.gowda@setty.com \n\nPurpose: For Review \nDue back: 11/6/2025 \nSender ID: 15993-001-6 \n";
const FORMA_BODY = "Hunter Roberts Construction Group • 224300 - NYCEDC - Homeport II - Phase 2 \n\n\nJames Mirabile (Hunter Roberts Construction Group)\n\nprovided the following submittal item for your information:\n\n\n \nitem #202 (Rev 2) Make Up Air Unit (MAU-1) \n\n\n\nWhat's changed \n\n\n \nStatus\n\n\nOpen → Closed \n\n\n\nFinal Response \n\n\n\n\n \nResponse\n\n\nApproved as noted \n\n\n\n\nItem Details \n\n\n\n\n \nStatus\n\n\nClosed \n\n\n\n\n \nBall in court\n\n\nACS Submittals (ACS Systems Associates) \n\n\n\n\n \nDue Date\n\n\nUnspecified \n\n\n\n\n \nSpec Section\n\n\n237313.13 - Make Up Air Unit (MAU-1) \n";

test("rfiKey: one key per RFI whatever the portal prints", async () => {
  const { rfiKey, rfiDisplay } = await import("./caIntake.js");
  assert.equal(rfiKey("RFI-091"), "91"); assert.equal(rfiKey("#91"), "91"); assert.equal(rfiKey(91), "91");
  assert.equal(rfiKey("RFI-005R"), "5R"); assert.equal(rfiKey("121.1"), "121.1"); assert.equal(rfiKey("RFI-021.1"), "21.1");
  assert.equal(rfiKey("053.1"), "53.1"); assert.equal(rfiKey("BID-RFI-306"), "BID-306");
  assert.notEqual(rfiKey("121.1"), rfiKey("121"), "a follow-up is not the original");
  assert.notEqual(rfiKey("5R"), rfiKey("5"));
  assert.equal(rfiDisplay("5R"), "005R"); assert.equal(rfiDisplay("91"), "091"); assert.equal(rfiDisplay("121.1"), "121.1");
});

test("Newforma RFI forward: id with prefix/suffix, title without the project, body fields", () => {
  const e = parseNewformaFwdRfi(mail("RFI Forwarded: Follow up to RFI 005 - Stony Brook University, Tabler Quad New Residence Hall - RFI:RFI-005R:SM1mU", NF_RFI_BODY, { from_address: "eduggan@pagethink.com", from_name: "Eileen Duggan" }));
  assert.deepEqual([e.extNum, e.rawId, e.event, e.title], ["5R", "RFI-005R", "New RFI", "Follow up to RFI 005"]);
  assert.equal(e.dueDate, "2025-11-10");
  assert.equal(e.askedBy, "Eileen Duggan");
  assert.equal(e.question, "See RFI");
  assert.equal(e.internal, false);
});

test("Newforma RFI: every id shape in the log, and Setty's own forwards", () => {
  const ids = [
    ["RFI Forwarded: Branch Power Confirming RFI (Bana RFI 18) - Stony Brook University, Tabler Quad New Reside... - RFI:RFI-029:SM1mU", "29", "Branch Power Confirming RFI (Bana RFI 18)"],
    ["RFI Forwarded: RFI-188.1 Follow Up to RFI-188-Access Panel Locations - 1018037.01_Stony Brook University, Tabler Quad New Residence Hall - RFI:188.1:SM1mU", "188.1", "RFI-188.1 Follow Up to RFI-188-Access Panel Locations"],
    ["RFI Forwarded: Follow Up To RFI-021 (Bana-RFI-024) - Stony Brook University, Tabler Quad New Residence... - RFI:RFI-021.1:SM1mU", "21.1", "Follow Up To RFI-021 (Bana-RFI-024)"],
    ["RFI Forwarded: SAPX196006.00_SUNY StonyBrook TblrQud - MC Cables - RFI:BID-RFI-306:FCqqN", "BID-306", "MC Cables"],
    ["RFI Forwarded: SAPX188032.00_NVCC Howsmon & Colgan - RFI-40 Lab Gas Valve Box Door Clarification - RFI:166:YvTUq", "166", "RFI-40 Lab Gas Valve Box Door Clarification"],
  ];
  for (const [subj, key, title] of ids) {
    const e = parseNewformaFwdRfi(mail(subj, NF_RFI_BODY.replace(/^Project:.*\n/, ""), { from_address: "x@pagethink.com" }));
    assert.ok(e, subj); assert.equal(e.extNum, key, subj); assert.equal(e.title, title, subj);
  }
  const own = parseNewformaFwdRfi(mail("RFI Forwarded: SAPX196006.00_SUNY StonyBrook TblrQud - Load Bank Location - RFI:RFI-138:FCqqN", "Remarks \n\nTeam, please review\n\nDownload all files", { from_address: "enoch.bethi@setty.com" }));
  assert.deepEqual([own.extNum, own.internal, own.question], ["138", true, ""], "Setty's own forward: no instructions-template as the question");
});

test("Newforma: replies, forwards of forwards and auto-replies are not notifications", () => {
  for (const subj of [
    "RE: RFI Forwarded: Follow Up to RFI-087 (Bana-030) - Stony Brook University, Tabler Quad New Residence Hall - RFI:RFI-087.1:SM1mU",
    "FW: RFI Forwarded: Follow up RFI 145 Smoke Detector - Stony Brook University - RFI:RFI-145.1:SM1mU (SAPX196006.00)",
    "Re: RFI Forwarded: SIPX252003.00_GU Elstad Audi Imrovemnt - Shoring Confirmation - RFI:006:jjRMn",
  ]) assert.equal(parseNewformaFwdRfi(mail(subj, "", { from_address: "p@setty.com" })), null, subj);
  for (const subj of [
    "RE: Submittal Forwarded: SAPX196006.00_SUNY StonyBrook TblrQud - Dampers - Submittal:233300-004-0:FCqqN",
    "Automatic reply: Submittal Forwarded: SAPX186034.03_SUNY Old Westbury NSB Add3 - PD - Condensing Unit - Submittal:132130-004-0:NKi0a",
  ]) assert.equal(parseNewformaFwdSub(mail(subj, "", { from_address: "p@setty.com" })), null, subj);
});

test("Newforma submittal forward and Responded-to-and-Closed", () => {
  const f = parseNewformaFwdSub(mail("Submittal Forwarded: SAPX196019.00_NY SCA PS 163X - R5 TAB Reports - Submittal:15993-001-6:00MT0", NF_SUB_BODY, { from_address: "yashvanth.gowda@setty.com", email_date: "2025-11-03T11:38:57Z" }));
  assert.deepEqual([f.extNum, f.rev, f.title, f.dueDate, f.status, f.specSection], ["15993-001", 6, "R5 TAB Reports", "2025-11-06", "", "15993"]);
  const sp = parseNewformaFwdSub(mail("Submittal Forwarded: SAPX259009.00_Gordonsville FireCompany - Diffusers, Registers & Grilles - Submittal:233713-001-0 :9PAkD", "", { from_address: "j@setty.com" }));
  assert.deepEqual([sp.extNum, sp.rev, sp.title], ["233713-001", 0, "Diffusers, Registers & Grilles"], "space before the tag");
  const lt = parseNewformaFwdSub(mail("Submittal Forwarded: SAPX186034.03_SUNY Old Westbury NSB Add3 - R1 SD - NSB - Level 00 Machine Room - Submittal:232113-016C-1:NKi0a", ""));
  assert.deepEqual([lt.extNum, lt.rev, lt.title], ["232113-016C", 1, "R1 SD - NSB - Level 00 Machine Room"], "letter suffix in the item segment");
  const c = parseNewformaFwdSub(mail("Submittal Responded to and Closed: SAPX196006.00_SUNY StonyBrook TblrQud - 1st Floor Sheetmetal SM-1.1 thru 1.6 - Shp dwgs - Submittal:233113-002-0:FCqqN", ""));
  assert.deepEqual([c.extNum, c.status], ["233113-002", "Returned"]);
});

test("Autodesk Forma: final response becomes the stamp; summaries are skipped", () => {
  const e = parseForma(mail("224300 - NYCEDC - Homeport II - Phase 2 - Submittal #202 was provided for your information", FORMA_BODY, { from_address: "no-reply@mail.forma.autodesk.com" }));
  assert.deepEqual([e.extNum, e.rev, e.title, e.formaStatus, e.stamp, e.dueDate], ["202", 2, "Make Up Air Unit (MAU-1)", "Closed", "Approved as Noted", ""]);
  assert.equal(e.specSection, "237313.13 - Make Up Air Unit (MAU-1)");
  assert.equal(parseForma(mail("Hourly summary: 1 new update", "Forms (1) Form #76 - P3 Site Observation Report", { from_address: "no-reply@mail.forma.autodesk.com" })), null);
  assert.equal(parseForma(mail("Welcome to 25-015 CUNY MEC Classroom Swing Space", "", { from_address: "no-reply@mail.forma.autodesk.com" })), null);
  const [row] = collapse([e], "submittal");
  assert.deepEqual([row.status, row.stamp], ["Returned", "Approved as Noted"]);
});

test("matching: follow-ups stay separate; Forma #N finds spec-based and SUB-N log numbers", async () => {
  const { matchRFI, matchSub } = await import("./caIntake.js");
  const log = [{ number: "121", title: "Bathroom water closet" }, { number: "053.1", title: "Follow Up To RFI-053 (R&S-RFI 15)" }];
  assert.equal(matchRFI("121.1", "Bathroom CN 2-314 Water Closet", log), null, "121.1 is new, not 121");
  assert.equal(matchRFI("53.1", "", log).number, "053.1");
  assert.equal(matchRFI("121", "", log).number, "121");
  assert.equal(matchRFI("1", "Follow Up To RFI-053 (R&S-RFI 15)", log).number, "053.1", "another system's number, same title");
  const subs = [{ number: "237313.13-202-2" }, { number: "SUB-233" }, { number: "260533-238-1" }];
  assert.equal(matchSub("202", subs).row.number, "237313.13-202-2");
  assert.equal(matchSub("202", subs).maxRev, 2);
  assert.equal(matchSub("233", subs).row.number, "SUB-233");
  assert.equal(matchSub("23", subs), null, "SUB-233 is not #23");
});

test("unattended intake follows the project's confirmed platform", async () => {
  const { intakeVendorsFor } = await import("./caIntake.js");
  assert.deepEqual(intakeVendorsFor({}), ["Procore"]);
  assert.deepEqual(intakeVendorsFor({ caPortal: { platform: "Newforma" } }), ["Newforma"]);
  assert.deepEqual(intakeVendorsFor({ caPortal: { platform: "Autodesk Build" } }), ["Autodesk Forma"]);
  assert.deepEqual(intakeVendorsFor({ caPortal: { platform: "Email only" } }), []);
  const ALL = ["Procore", "Autodesk Forma", "Newforma"];
  const emails = [
    mail("Action Required: J1, P: New RFI #RFI-91, Condensate lines in cellar", RFI_BODY_PREFIXED, { email_date: "2026-10-30T10:00:00Z" }),
    mail("RFI Forwarded: Follow up to RFI 005 - Stony Brook University, Tabler Quad New Residence Hall - RFI:RFI-005R:SM1mU", NF_RFI_BODY, { from_address: "eduggan@pagethink.com", email_date: "2026-10-30T10:00:00Z" }),
    mail("224300 - Homeport II - Submittal #202 was provided for your information", FORMA_BODY, { from_address: "no-reply@mail.forma.autodesk.com", email_date: "2026-10-30T10:00:00Z" }),
  ];
  const plan = (portal) => planIntake(emails, { rfis: [], submittals: [], ...(portal ? { caPortal: { platform: portal } } : {}) }, "p1", { vendors: ALL, since: "2026-10-20" });
  const nums = (p) => [...p.rfis, ...p.submittals].map((r) => r.number);
  assert.deepEqual(nums(plan(null)), ["RFI-091"], "unconfirmed: Procore only");
  assert.deepEqual(nums(plan("Newforma")), ["RFI-005R"], "Newforma job: never the Procore copy");
  assert.deepEqual(nums(plan("Autodesk Build")), ["SUB-202"]);
  assert.deepEqual(nums(plan("Email only")), []);
  assert.equal(plan("Newforma").rfis[0].intake.vendor, "Newforma");
  assert.deepEqual(nums(planIntake(emails, { caPortal: { platform: "Newforma" } }, "p1", { vendors: ["Procore"], since: "2026-10-20" })), [], "the caller's allow-list still bounds it");
});

/* ---------- status updates on logged items ---------- */
test("status updates: closing/answering events move logged items forward only", async () => {
  const { planIntake, applyStatusUpdates } = await import("./caIntake.js");
  const NEW = mail("A: J1, P: New RFI #RFI-91, Condensate lines in cellar", RFI_BODY_PREFIXED, { email_date: "2026-06-30T13:54:00Z" });
  const CLOSED = mail("J1, P: RFI Closed, #RFI-91, Condensate lines in cellar", "", { record_id: "eC", email_date: "2026-10-30T10:00:00Z" });
  const RESP = mail("J1, P: Response to RFI #RFI-91, Condensate lines in cellar", "", { record_id: "eR", email_date: "2026-10-29T10:00:00Z" });
  const STAT = mail("J1, P: Status Update on RFI #RFI-91, Condensate lines in cellar", "", { email_date: "2026-10-31T10:00:00Z" });
  const proj = (status, extra = {}) => ({ rfis: [{ id: "r91", number: "RFI-091", title: "Condensate lines in cellar", status, response: "<p>our text</p>", dateResponded: "", ...extra }], submittals: [] });
  const plan = (emails, p) => planIntake(emails, p, "p1", { since: "2026-10-20", at: "T" });

  const p1 = plan([NEW, CLOSED], proj("Open"));
  assert.equal(p1.rfis.length, 0, "a logged item is never re-created");
  assert.equal(p1.updates.length, 1);
  const u = p1.updates[0];
  assert.deepEqual([u.id, u.from, u.to, u.patch], ["r91", "Open", "Closed", { status: "Closed", dateResponded: "2026-10-30" }]);
  assert.deepEqual([u.intakeStatus.prev, u.intakeStatus.emailId, u.intakeStatus.reviewed, u.intakeStatus.vendor], [{ status: "Open", dateResponded: "" }, "eC", false, "Procore"]);
  const applied = applyStatusUpdates(proj("Open"), p1.updates);
  assert.equal(applied.applied, 1);
  assert.equal(applied.rfis[0].status, "Closed");
  assert.equal(applied.rfis[0].response, "<p>our text</p>", "text fields are never written");

  assert.deepEqual(plan([NEW, RESP], proj("Open")).updates.map((x) => x.to), ["Responded"]);
  assert.deepEqual(plan([NEW, RESP], proj("Pending Sub Response")).updates.map((x) => x.to), ["Responded"]);
  assert.equal(plan([NEW, RESP], proj("Closed")).updates.length, 0, "never backwards");
  assert.equal(plan([NEW, CLOSED], proj("Closed")).updates.length, 0, "already there");
  assert.equal(plan([NEW, CLOSED], proj("Void")).updates.length, 0, "Void is never touched");
  assert.equal(plan([NEW, RESP, STAT], proj("Open")).updates.length, 0, "a Status Update is not a status change");
  assert.equal(plan([NEW, CLOSED], proj("Open", { dateResponded: "2026-10-01" })).updates[0].patch.dateResponded, undefined, "an existing date is kept");
  const old = mail("J1, P: RFI Closed, #RFI-91, Condensate", "", { email_date: "2026-07-01T10:00:00Z" });
  assert.equal(plan([NEW, old], proj("Open")).updates.length, 0, "only recent events");
  assert.equal(planIntake([NEW, CLOSED], proj("Open"), "p1", { since: "2026-10-20", updates: false }).updates.length, 0, "can be switched off");
});

test("status updates: never on a title-only match or an ambiguous number", async () => {
  const { planIntake } = await import("./caIntake.js");
  const CLOSED = mail("J1, P: RFI Closed, #RFI-77, Condensate lines in cellar", "", { email_date: "2026-10-30T10:00:00Z" });
  const titleOnly = { rfis: [{ id: "a", number: "RFI-091", title: "Condensate lines in cellar", status: "Open" }], submittals: [] };
  assert.equal(planIntake([CLOSED], titleOnly, "p1", { since: "2026-10-20" }).updates.length, 0);
  const twice = { rfis: [{ id: "a", number: "RFI-077", status: "Open" }, { id: "b", number: "77", status: "Open" }], submittals: [] };
  assert.equal(planIntake([CLOSED], twice, "p1", { since: "2026-10-20" }).updates.length, 0, "two rows claim RFI 77: leave both");
});

test("status updates: submittals by exact revision, stamp only when none recorded", async () => {
  const { planIntake } = await import("./caIntake.js");
  const DIST = mail("P: Submittal Distributed 262416-1.0, Panelboard and Accessories - Product Data", SUB_DISTRIBUTED, { email_date: "2026-10-30T13:41:00Z" });
  const sub = (number, status, stamp = "—", extra = {}) => ({ rfis: [], submittals: [{ id: "s1", number, status, stamp, dateReturned: "", ...extra }] });
  const plan = (p, emails = [DIST]) => planIntake(emails, p, "p1", { since: "2026-10-20", at: "T" });
  const u = plan(sub("262416-001-0", "Under Review")).updates[0];
  assert.deepEqual([u.to, u.patch], ["Returned", { status: "Returned", dateReturned: "2026-10-30", stamp: "Approved as Noted" }]);
  assert.equal(plan(sub("262416-001-0", "Under Review", "Revise and Resubmit")).updates[0].patch.stamp, undefined, "a recorded stamp wins");
  assert.equal(plan(sub("262416-001-1", "Under Review")).updates.length, 0, "rev 1 in the log, rev 0 in the email: not the same row");
  assert.equal(plan(sub("262416-001-0", "Returned")).updates.length, 0);
  const FORMA = mail("224300 - Homeport II - Submittal #202 was provided for your information", FORMA_BODY, { from_address: "no-reply@mail.forma.autodesk.com", email_date: "2026-11-02T14:41:00Z" });
  const forma = (number, extra) => planIntake([FORMA], { caPortal: { platform: "Autodesk Build" }, ...sub(number, "Received", "—", extra) }, "p1", { vendors: ["Procore", "Autodesk Forma", "Newforma"], since: "2026-10-20" });
  assert.equal(forma("237313.13-202-2").updates[0].to, "Returned", "spec-based log number, same revision");
  assert.equal(forma("237313.13-202-1").updates.length, 0, "other revision");
  assert.equal(forma("SUB-202", { resubNumber: 2 }).updates[0].to, "Returned");
  assert.equal(forma("SUB-202", { resubNumber: 0 }).updates.length, 0, "SUB-202 holds rev 0, the email is rev 2");
  const NFC = mail("Submittal Responded to and Closed: SAPX196006.00_SUNY StonyBrook TblrQud - Dampers - Submittal:233300-004-0:FCqqN", "", { from_address: "x@pagethink.com", email_date: "2026-10-30T10:00:00Z" });
  const nf = planIntake([NFC], { caPortal: { platform: "Newforma" }, ...sub("233300-004-0", "Under Review") }, "p1", { vendors: ["Procore", "Autodesk Forma", "Newforma"], since: "2026-10-20" });
  assert.equal(nf.updates[0].to, "Returned");
  assert.equal(planIntake([NFC], sub("233300-004-0", "Under Review"), "p1", { vendors: ["Procore", "Autodesk Forma", "Newforma"], since: "2026-10-20" }).updates.length, 0, "an unconfirmed project reads Procore only");
});

test("applyStatusUpdates: a person's edit since the plan wins", async () => {
  const { applyStatusUpdates } = await import("./caIntake.js");
  const upd = [{ kind: "rfi", id: "r1", from: "Open", to: "Closed", patch: { status: "Closed" }, intakeStatus: { from: "Open", to: "Closed" } }];
  const r = applyStatusUpdates({ rfis: [{ id: "r1", status: "Responded" }], submittals: [] }, upd);
  assert.deepEqual([r.applied, r.rfis[0].status, r.rfis[0].intakeStatus], [0, "Responded", undefined]);
});

test("status updates: an undone change is not re-applied from the same event, a newer one may", async () => {
  const { planIntake } = await import("./caIntake.js");
  const CLOSED = mail("J1, P: RFI Closed, #RFI-91, Condensate", "", { email_date: "2026-10-30T10:00:00Z" });
  const undone = { rfis: [{ id: "r", number: "RFI-091", status: "Open", intakeStatus: { undone: true, eventDate: "2026-10-30" } }], submittals: [] };
  assert.equal(planIntake([CLOSED], undone, "p1", { since: "2026-10-20" }).updates.length, 0);
  const LATER = mail("J1, P: RFI Closed, #RFI-91, Condensate", "", { email_date: "2026-11-05T10:00:00Z" });
  assert.equal(planIntake([CLOSED, LATER], undone, "p1", { since: "2026-10-20" }).updates.length, 1);
});

/* ---------- Kahua (NYC SCA), from real filed mail on Q119 (2025-01..2026-10) ---------- */
const kmail = (subject, body = "", extra = {}) => mail(subject, body, { from_address: "outbox@kahua.com", from_name: "Sahdia Khwaja (via Kahua)", ...extra });
const K_RESP_BODY = "Sara,\n\n\nAction required for RFI CI00033 on C000016114-MC0034 - Q119 (IS119Q) - Reso A Computer Lab Upgrade.\n\nSubject:\n\"Q119 (RFI#33) Data Points\"\n\nQuestion:\n\"As per contract drawing E201.00, there is (1) data point shown at each floor box.\nPlease review and advise.\n\n\"\n\nAdditional Information:\n\"\"\n\nReturn for clarification Reason:\n\"\"\n\nPlease see full information in the CAMP.\n";
const K_SUB_BODY = "Melissa,\n\n\nSubmittal 16730-003 was returned with response Revise Resubmit.\nPlease review and add a new review cycle to for this submittal.\n\nProject Number: C000016114-MC0034\nProject: Q119 (IS119Q) - Reso A Computer Lab Upgrade\nSubmittal Number: 16730-003\nSubmittal: Q119-16730-003-001-Data Cabling Product Data R1\n\nSubmittal Link: Open In Kahua \n";

test("Kahua RFIs: RFI# and CI number are one key; events never close an RFI", async () => {
  const { parseKahuaRfi } = await import("./caIntake.js");
  const n = parseKahuaRfi(kmail("CI00034 Q119 (RFI#34) Exposed Rough Carpentry", "This Message was sent to multiple recipients", { from_name: "Richard Chen (via Kahua)" }));
  assert.deepEqual([n.extNum, n.kahuaId, n.event, n.title, n.askedBy], ["34", "CI00034", "New RFI", "Exposed Rough Carpentry", "Richard Chen"]);
  const early = parseKahuaRfi(kmail("RFI  - Q119 (RFI#3) Casement Millwork - Additional Clarification on C000016114-MC0034 - Q119 (IS119Q) - Reso A Computer Lab Upgrade"));
  assert.deepEqual([early.extNum, early.kahuaId, early.title], ["3", "", "Casement Millwork - Additional Clarification"]);
  const r = parseKahuaRfi(kmail("RFI CI00033 - Q119 (RFI#33) Data Points response received on C000016114-MC0034 - Q119 (IS119Q) - Reso A Computer Lab Upgrade", K_RESP_BODY));
  assert.deepEqual([r.extNum, r.event, r.title], ["33", "Response Received", "Data Points"]);
  assert.match(r.question, /^As per contract drawing E201\.00/);
  const back = parseKahuaRfi(kmail("RFI CI00020 for  Q119 C000016114-MC0034 D021838 has been returned", "Return Reason: please attached latest response"));
  assert.deepEqual([back.extNum, back.event], ["20", "Returned to Us"]);
  for (const s of ["Kahua Weekly Summary", "Meeting Minutes for C000016114-MC0034 - Q119 (IS119Q) - Reso A Computer Lab Upgrade, Job Progress : 00002",
    "CAMP Submittal: 16730-003 Returned in Project C000016114-MC0034", "RE: CI00034 Q119 (RFI#34) Exposed Rough Carpentry"])
    assert.equal(parseKahuaRfi(kmail(s)), null, s);
});

test("Kahua submittals: returned with stamp and revision; reviewer task = received", async () => {
  const { parseKahuaSub } = await import("./caIntake.js");
  const s = parseKahuaSub(kmail("CAMP Submittal: 16730-003 Returned in Project C000016114-MC0034", K_SUB_BODY, { from_name: "Enoch Bethi (via Kahua)" }));
  assert.deepEqual([s.extNum, s.rev, s.status, s.stamp, s.title, s.specSection], ["16730-003", 1, "Returned", "Revise and Resubmit", "Data Cabling Product Data R1", "16730"]);
  const t = parseKahuaSub(kmail("03542-001 Official Reviewer Task on Q119 (IS119Q) - Reso A Computer Lab Upgrade", "You have a Task: 03542-001 Official Reviewer Task"));
  assert.deepEqual([t.extNum, t.rev, t.status, t.stamp], ["03542-001", 0, "Received", ""]);
  assert.equal(parseKahuaSub(kmail("Kahua Weekly Summary")), null);
  assert.equal(parseKahuaSub(kmail("CI00034 Q119 (RFI#34) Exposed Rough Carpentry")), null);
});

test("Kahua against the Q119 log: matched by number, returned submittal moves forward, RFI follow-ups never close", async () => {
  const { planIntake, platformOfEmail, intakeVendorsFor } = await import("./caIntake.js");
  assert.equal(platformOfEmail({ from_address: "outbox@kahua.com" }), "Kahua");
  assert.deepEqual(intakeVendorsFor({ caPortal: { platform: "Kahua" } }), ["Kahua"]);
  const proj = { caPortal: { platform: "Kahua" },
    rfis: [{ id: "a", number: "RFI-034", title: "CI00034 Q119 (RFI#34) Exposed Rough Carpentry", status: "Open" }, { id: "b", number: "020", title: "Carpentry Millwork", status: "Closed" }],
    submittals: [{ id: "s", number: "16730-003-1", status: "Under Review", stamp: "—" }] };
  const emails = [
    kmail("CI00034 Q119 (RFI#34) Exposed Rough Carpentry", "", { email_date: "2026-10-28T10:00:00Z" }),
    kmail("RFI CI00020 for  Q119 C000016114-MC0034 D021838 has been returned", "", { email_date: "2026-10-29T10:00:00Z" }),
    kmail("RFI CI00035 - Q119 (RFI#35) Ceiling Grid response received on C000016114-MC0034 - Q119", K_RESP_BODY, { email_date: "2026-10-30T10:00:00Z" }),
    kmail("CAMP Submittal: 16730-003 Returned in Project C000016114-MC0034", K_SUB_BODY, { email_date: "2026-10-30T10:00:00Z" }),
  ];
  const plan = planIntake(emails, proj, "p1", { vendors: ["Procore", "Autodesk Forma", "Newforma", "Kahua"], since: "2026-10-20", at: "T" });
  assert.deepEqual(plan.rfis.map((r) => [r.number, r.title, r.intake.vendor]), [["RFI-035", "Ceiling Grid", "Kahua"]], "only the new RFI is created");
  assert.deepEqual(plan.updates.map((u) => [u.number, u.from, u.to, u.patch.stamp]), [["16730-003-1", "Under Review", "Returned", "Revise and Resubmit"]]);
  assert.equal(planIntake(emails, { ...proj, caPortal: null }, "p1", { vendors: ["Procore", "Autodesk Forma", "Newforma", "Kahua"], since: "2026-10-20" }).rfis.length, 0, "unconfirmed: Procore only");
});
