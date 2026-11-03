// node --test primeCa.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  settyIsPrime, numberValue, nextCaNumber, bumpHighWater, isIssued, canDeleteCaItem,
  addWorkdays, subDueDefault, subRoutingState, ballInCourt, cleanSubject,
  classifyContractorEmail, findIntakeCandidates, itemFromCandidate,
} from "./primeCa.js";

const PRIME = { prime: "Setty & Associates" };
const SUB = { prime: "Acme Architects" };

test("settyIsPrime: only when the Prime is set to a Setty name", () => {
  assert.equal(settyIsPrime(PRIME), true);
  assert.equal(settyIsPrime({ prime: "SETTY Engineering" }), true);
  assert.equal(settyIsPrime(SUB), false);
  assert.equal(settyIsPrime({ prime: "" }), false);
  assert.equal(settyIsPrime({}), false);
  assert.equal(settyIsPrime(null), false);
});

test("numberValue reads the trailing integer", () => {
  assert.equal(numberValue("RFI-012"), 12);
  assert.equal(numberValue("SUB-7"), 7);
  assert.equal(numberValue("014"), 14);
  assert.equal(numberValue("RFI-12.1"), 12);
  assert.equal(numberValue("RFI-"), null);
  assert.equal(numberValue(undefined), null);
});

test("nextCaNumber: one past the highest, never count+1", () => {
  // Old rule gave RFI-003 here and collided with the existing RFI-003.
  const items = [{ number: "RFI-001" }, { number: "RFI-003" }];
  assert.deepEqual(nextCaNumber(items, "rfi"), { number: "RFI-004", value: 4 });
  assert.deepEqual(nextCaNumber([], "submittal"), { number: "SUB-001", value: 1 });
  // A deleted RFI-009 is remembered by the high-water mark.
  assert.equal(nextCaNumber(items, "rfi", 9).number, "RFI-010");
  // Backloaded portal numbers ("091") still count.
  assert.equal(nextCaNumber([{ number: "091" }], "rfi").number, "RFI-092");
});

test("bumpHighWater keeps the max per type", () => {
  assert.deepEqual(bumpHighWater({}, "rfi", 4), { rfi: 4 });
  assert.deepEqual(bumpHighWater({ caNumberHighWater: { rfi: 9, submittal: 2 } }, "rfi", 4), { rfi: 9, submittal: 2 });
  assert.deepEqual(bumpHighWater({ caNumberHighWater: { rfi: 9 } }, "submittal", 3), { rfi: 9, submittal: 3 });
});

test("isIssued", () => {
  assert.equal(isIssued({ status: "Open" }, "rfi"), false);
  assert.equal(isIssued({ status: "Responded" }, "rfi"), true);
  assert.equal(isIssued({ status: "Open", dateResponded: "2026-11-01" }, "rfi"), true);
  assert.equal(isIssued({ status: "Under Review" }, "submittal"), false);
  assert.equal(isIssued({ status: "Returned" }, "submittal"), true);
  assert.equal(isIssued({ status: "Received", issuedAt: "x" }, "submittal"), true);
});

test("canDeleteCaItem: prime jobs keep issued and emailed items", () => {
  const issued = { status: "Responded" };
  assert.equal(canDeleteCaItem(SUB, issued, "rfi").ok, true);
  assert.equal(canDeleteCaItem({ prime: "" }, issued, "rfi").ok, true);
  const r = canDeleteCaItem(PRIME, issued, "rfi");
  assert.equal(r.ok, false);
  assert.match(r.reason, /Void/);
  assert.equal(canDeleteCaItem(PRIME, { status: "Open", sourceEmail: { recordId: "e1" } }, "rfi").ok, false);
  assert.equal(canDeleteCaItem(PRIME, { status: "Open" }, "rfi").ok, true);
});

test("addWorkdays skips weekends both ways", () => {
  assert.equal(addWorkdays("2026-11-06", 1), "2026-11-09"); // Fri → Mon
  assert.equal(addWorkdays("2026-11-09", -1), "2026-11-06"); // Mon → Fri
  assert.equal(addWorkdays("2026-11-03", 5), "2026-11-10");
  assert.equal(addWorkdays("bad", 2), "");
});

test("subDueDefault: 2 working days before the contractor, not before tomorrow", () => {
  assert.equal(subDueDefault("2026-11-13", "2026-11-03"), "2026-11-11");
  // Contractor due too soon → next working day.
  assert.equal(subDueDefault("2026-11-04", "2026-11-03"), "2026-11-04");
  assert.equal(subDueDefault("", "2026-11-06"), "2026-11-09");
  assert.equal(subDueDefault("2026-11-20", "2026-11-03", 5), "2026-11-13");
});

test("subRoutingState", () => {
  assert.equal(subRoutingState({}, "2026-11-03").state, "none");
  const r = { subRouting: { sentAt: "2026-11-01", dueDate: "2026-11-05" } };
  assert.equal(subRoutingState(r, "2026-11-05").state, "waiting");
  assert.deepEqual(subRoutingState(r, "2026-11-07"), { state: "late", daysLate: 2 });
  assert.equal(subRoutingState({ subRouting: { ...r.subRouting, respondedAt: "2026-11-04" } }, "2026-11-09").state, "responded");
});

test("ballInCourt", () => {
  const subs = [{ id: "s1", firm: "Acme Structural" }];
  assert.equal(ballInCourt({ status: "Open" }, "rfi", subs).who, "setty");
  assert.equal(ballInCourt({ status: "Closed" }, "rfi", subs).who, "none");
  assert.equal(ballInCourt({ status: "Responded" }, "rfi", subs).who, "contractor");
  assert.deepEqual(ballInCourt({ status: "Pending Sub Response", subAssigned: "s1" }, "rfi", subs), { who: "sub", label: "Sub: Acme Structural" });
  // Sent to the sub but status never moved: still the sub's.
  assert.equal(ballInCourt({ status: "Open", subRouting: { sentAt: "2026-11-01", firm: "X" } }, "rfi", subs).label, "Sub: X");
  // Sub answered: back with Setty.
  assert.equal(ballInCourt({ status: "Open", subRouting: { sentAt: "2026-11-01", respondedAt: "2026-11-02" } }, "rfi", subs).who, "setty");
  assert.equal(ballInCourt({ status: "Resubmittal Required" }, "submittal", subs).who, "contractor");
  assert.equal(ballInCourt({ status: "Under Review" }, "submittal", subs).who, "setty");
});

test("cleanSubject strips reply/forward prefixes", () => {
  assert.equal(cleanSubject("RE: FW: Fwd: RFI #12 – Duct"), "RFI #12 – Duct");
});

test("classifyContractorEmail", () => {
  assert.deepEqual(classifyContractorEmail("RFI #12 - Duct clash at grid C"), { type: "rfi", ref: "12", specSection: "", title: "Duct clash at grid C" });
  assert.equal(classifyContractorEmail("FW: RFI-014: Pump base").ref, "014");
  assert.equal(classifyContractorEmail("RFI 7 Fire damper access").ref, "7");
  assert.equal(classifyContractorEmail("New RFI: ceiling height").type, "rfi");
  const s = classifyContractorEmail("Submittal 23 05 00-01 Hangers and supports");
  assert.equal(s.type, "submittal");
  assert.equal(s.specSection, "23 05 00");
  assert.equal(classifyContractorEmail("Shop drawings for ductwork").type, "submittal");
  // Our own outgoing mail and unrelated mail.
  assert.equal(classifyContractorEmail("RFI Response: RFI-003 — Duct · Tabler"), null);
  assert.equal(classifyContractorEmail("RFI Assignment: RFI-003 — Duct"), null);
  assert.equal(classifyContractorEmail("Submittal Return — Approved: SUB-002"), null);
  assert.equal(classifyContractorEmail("Submittal — SUB-002 — Pumps · Sub Response Requested"), null);
  assert.equal(classifyContractorEmail("Meeting minutes OAC #4"), null);
  // "RFI" inside a word is not an RFI.
  assert.equal(classifyContractorEmail("Verifies the layout"), null);
});

test("findIntakeCandidates filters ours, portals, replies, logged and dismissed", () => {
  const emails = [
    { record_id: "a", subject: "RFI #1 - Duct clash", from_name: "Bob GC", from_address: "bob@gc.com", email_date: "2026-11-01T10:00:00Z" },
    { record_id: "b", subject: "Submittal 23 31 13 Ductwork", from_name: "Bob GC", from_address: "bob@gc.com", email_date: "2026-11-02T10:00:00Z" },
    { record_id: "c", subject: "RFI #2 - Pipe", from_name: "Sara", from_address: "sara@setty.com", email_date: "2026-11-02" },
    { record_id: "d", subject: "New RFI #3", from_name: "Procore", from_address: "no-reply@procoretech.com", email_date: "2026-11-02" },
    { record_id: "k", subject: "RFI 0042 - Pipe sleeve", from_name: "Ann (via Kahua)", from_address: "outbox@kahua.com", email_date: "2026-11-02" },
    { record_id: "e", subject: "RE: RFI #1 - Duct clash", from_name: "Bob GC", from_address: "bob@gc.com", email_date: "2026-11-03" },
    { record_id: "f", subject: "RFI #4 - Logged already", from_address: "bob@gc.com", email_date: "2026-11-03" },
    { record_id: "g", subject: "RFI #5 - Dismissed", from_address: "bob@gc.com", email_date: "2026-11-03" },
    { record_id: "h", subject: "Lunch?", from_address: "bob@gc.com", email_date: "2026-11-03" },
  ];
  const project = { rfis: [{ sourceEmail: { recordId: "f" } }], caIntakeDismissed: ["g"] };
  const got = findIntakeCandidates(emails, project);
  assert.deepEqual(got.map((x) => x.recordId), ["b", "a"]);
  assert.equal(got[0].type, "submittal");
  assert.equal(got[1].ref, "1");
  assert.equal(got[1].date, "2026-11-01");
});

test("itemFromCandidate fills an RFI and a submittal from the email", () => {
  const base = { id: "x", number: "RFI-004", title: "", description: "", from: "", dateReceived: "2026-11-03", dueDate: "", notes: "" };
  const cand = { recordId: "a", type: "rfi", ref: "12", title: "Duct clash", subject: "RFI #12 - Duct clash", fromName: "Bob GC", fromAddress: "bob@gc.com", date: "2026-11-02" };
  const r = itemFromCandidate(base, cand, "Please advise.\r\n\r\n\r\n\r\nThanks", 5);
  assert.equal(r.number, "RFI-004");
  assert.equal(r.title, "Duct clash");
  assert.equal(r.description, "Please advise.\n\nThanks");
  assert.equal(r.from, "Bob GC");
  assert.equal(r.dateReceived, "2026-11-02");
  assert.equal(r.dueDate, "2026-11-09");
  assert.equal(r.contractorRef, "12");
  assert.deepEqual(r.sourceEmail, { recordId: "a", subject: "RFI #12 - Duct clash", from: "bob@gc.com", date: "2026-11-02" });

  const sb = { ...base, number: "SUB-001", specSection: "" };
  const s = itemFromCandidate(sb, { ...cand, type: "submittal", ref: "", specSection: "23 31 13", title: "Submittal 23 31 13 Ductwork" }, "See attached", 10);
  assert.equal(s.description, "Submittal 23 31 13 Ductwork");
  assert.equal(s.specSection, "23 31 13");
  assert.match(s.notes, /See attached/);
});

import { parseEmails, distributionFor, caLogRows } from "./primeCa.js";

test("parseEmails pulls, lower-cases and de-dupes addresses", () => {
  assert.deepEqual(parseEmails("Bob <Bob@GC.com>; ann@x.org, bob@gc.com\nnot-an-email"), ["bob@gc.com", "ann@x.org"]);
  assert.deepEqual(parseEmails(""), []);
});

test("distributionFor: extra To first, no duplicates, To beats Cc", () => {
  const p = { caDistribution: { rfi: { to: "owner@city.gov; pm@gc.com", cc: "pm@gc.com, arch@sub.com" } } };
  assert.deepEqual(distributionFor(p, "rfi", ["super@gc.com", "owner@city.gov"]), { to: ["super@gc.com", "owner@city.gov", "pm@gc.com"], cc: ["arch@sub.com"] });
  assert.deepEqual(distributionFor(p, "submittal"), { to: [], cc: [] });
  assert.deepEqual(distributionFor({}, "rfi", [""]), { to: [], cc: [] });
});

test("caLogRows: sorted by number, every date, html stripped", () => {
  const p = {
    subconsultants: [{ id: "s1", firm: "Acme Structural" }],
    rfis: [
      { number: "RFI-010", title: "B", status: "Open", dateReceived: "2026-11-01" },
      { number: "RFI-002", title: "A", status: "Responded", contractorRef: "7", dateResponded: "2026-11-03",
        response: "<p>Use &amp; keep</p>", subAssigned: "s1",
        subRouting: { subId: "s1", sentAt: "2026-11-01", dueDate: "2026-11-02", respondedAt: "2026-11-02" },
        sourceEmail: { date: "2026-10-31", from: "bob@gc.com", subject: "RFI #7" } },
    ],
  };
  const { headers, rows } = caLogRows(p, "rfi");
  assert.equal(rows[0][0], "RFI-002");
  const col = (h) => headers.indexOf(h);
  assert.equal(rows[0][col("Contractor ref")], "7");
  assert.equal(rows[0][col("Subconsultant")], "Acme Structural");
  assert.equal(rows[0][col("Sub answered")], "2026-11-02");
  assert.equal(rows[0][col("Response")], "Use & keep");
  assert.equal(rows[0][col("Ball in court")], "Contractor");
  assert.equal(rows[0][col("Logged from email")], "2026-10-31 bob@gc.com: RFI #7");
  assert.equal(rows[1][col("Ball in court")], "Setty");
  const sh = caLogRows({ submittals: [{ number: "SUB-001", stamp: "—", specSection: "23 05 00" }] }, "submittal");
  assert.ok(sh.headers.includes("Spec section") && sh.headers.includes("Stamp"));
  assert.equal(sh.rows[0][sh.headers.indexOf("Stamp")], "");
});
