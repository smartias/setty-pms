// Status rules for RFIs and submittals (caStatus.js), plus checks that the
// PMS and the Tracker load the module instead of carrying their own lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  statusForStamp, issuedStatus, applyStatusRules, isOverdue, isDoneStatus, doneDateKey, localISO,
  RFI_STATUSES, SUBMITTAL_STATUSES, DONE_STATUSES,
} from "./caStatus.js";

const TODAY = "2026-11-24";

test("stamp decides the status; a blank stamp decides nothing", () => {
  assert.equal(statusForStamp("Approved"), "Returned");
  assert.equal(statusForStamp("Approved as Noted"), "Returned");
  assert.equal(statusForStamp("Revise and Resubmit"), "Resubmittal Required");
  assert.equal(statusForStamp("Rejected"), "Resubmittal Required");
  assert.equal(statusForStamp("—"), "");
  assert.equal(statusForStamp(""), "");
  assert.equal(statusForStamp(undefined), "");
});

test("an issued submittal takes its status from the stamp; an issued RFI is Responded", () => {
  assert.equal(issuedStatus("submittal", "Approved"), "Returned");
  assert.equal(issuedStatus("submittal", "Rejected"), "Resubmittal Required");
  assert.equal(issuedStatus("submittal", "—"), "Returned");
  assert.equal(issuedStatus("rfi", ""), "Responded");
});

test("picking a stamp does not move the status: the item stays open until it is sent", () => {
  const prev = { status: "Under Review", stamp: "—", dateReturned: "" };
  const out = applyStatusRules(prev, { ...prev, stamp: "Revise and Resubmit" }, "submittal", TODAY);
  assert.equal(out.status, "Under Review");
  assert.ok(!out.dateReturned);
});

test("setting Resubmittal Required by hand dates it", () => {
  const out = applyStatusRules({ status: "Received" }, { status: "Resubmittal Required" }, "submittal", TODAY);
  assert.equal(out.dateReturned, TODAY);
});

test("answered statuses get a date only when it is empty", () => {
  const r = applyStatusRules({ status: "Open" }, { status: "Responded" }, "rfi", TODAY);
  assert.equal(r.dateResponded, TODAY);
  const c = applyStatusRules({ status: "Open" }, { status: "Closed" }, "rfi", TODAY);
  assert.equal(c.dateResponded, TODAY);
  const kept = applyStatusRules({ status: "Open", dateResponded: "2026-11-01" }, { status: "Responded", dateResponded: "2026-11-01" }, "rfi", TODAY);
  assert.equal(kept.dateResponded, "2026-11-01");
  const s = applyStatusRules({ status: "Received" }, { status: "Returned" }, "submittal", TODAY);
  assert.equal(s.dateReturned, TODAY);
});

test("Void, routing to a sub and reopening add no date", () => {
  assert.ok(!applyStatusRules({ status: "Open" }, { status: "Void" }, "rfi", TODAY).dateResponded);
  assert.ok(!applyStatusRules({ status: "Open" }, { status: "Pending Sub Response" }, "rfi", TODAY).dateResponded);
  assert.ok(!applyStatusRules({ status: "Received" }, { status: "Pending Sub Review" }, "submittal", TODAY).dateReturned);
  const reopened = applyStatusRules({ status: "Responded", dateResponded: "2026-11-01" }, { status: "Open", dateResponded: "2026-11-01" }, "rfi", TODAY);
  assert.equal(reopened.dateResponded, "2026-11-01"); // never deletes what someone recorded
});

test("no status change, no date", () => {
  const out = applyStatusRules({ status: "Responded" }, { status: "Responded", notes: "x" }, "rfi", TODAY);
  assert.ok(!out.dateResponded);
});

test("overdue starts the day after the due date", () => {
  assert.equal(isOverdue({ status: "Open", dueDate: "2026-11-24" }, TODAY), false);
  assert.equal(isOverdue({ status: "Open", dueDate: "2026-11-23" }, TODAY), true);
  assert.equal(isOverdue({ status: "Open", dueDate: "2026-11-25" }, TODAY), false);
  assert.equal(isOverdue({ status: "Open", dueDate: "" }, TODAY), false);
});

test("done statuses and unconfirmed intake are never overdue", () => {
  for (const status of DONE_STATUSES) {
    assert.equal(isOverdue({ status, dueDate: "2026-01-01" }, TODAY), false, status);
  }
  assert.equal(isOverdue({ status: "Resubmittal Required", dueDate: "2026-01-01" }, TODAY), false);
  assert.equal(isOverdue({ status: "Open", dueDate: "2026-01-01", intakeReviewed: false }, TODAY), false);
  for (const status of ["Open", "Pending Sub Response", "Received", "Under Review", "Pending Sub Review"]) {
    assert.equal(isOverdue({ status, dueDate: "2026-01-01" }, TODAY), true, status);
  }
});

test("every status is either done or still ours", () => {
  assert.deepEqual(RFI_STATUSES.filter((s) => !isDoneStatus("rfi", s)), ["Open", "Pending Sub Response"]);
  assert.deepEqual(SUBMITTAL_STATUSES.filter((s) => !isDoneStatus("submittal", s)), ["Received", "Under Review", "Pending Sub Review"]);
  assert.equal(doneDateKey("rfi"), "dateResponded");
  assert.equal(doneDateKey("submittal"), "dateReturned");
});

test("localISO is the local calendar day", () => {
  assert.equal(localISO(new Date(2026, 10, 24, 23, 30)), "2026-11-24");
});

test("the PMS and the Tracker load caStatus.js and apply it", () => {
  const pms = readFileSync(new URL("./SettyPMS.html", import.meta.url), "utf8");
  const tracker = readFileSync(new URL("./RFISubmittalSync_Preview.html", import.meta.url), "utf8");
  for (const [name, html] of [["SettyPMS.html", pms], ["RFISubmittalSync_Preview.html", tracker]]) {
    assert.match(html, /import \* as CaStatus from "\.\/caStatus\.js"/, name + " imports caStatus.js");
    assert.match(html, /CaStatus\.applyStatusRules\(/, name + " dates a status change");
  }
  assert.match(pms, /CaStatus\.isOverdue\(/, "the PMS uses the shared overdue rule");
  assert.match(pms, /CaStatus\.issuedStatus\(/, "the PMS takes the issued status from the stamp");
  // The Tracker counts overdue as open AND past due; its open list must leave out every done status.
  const open = /const RFI_OPEN=(\[[^\]]*\]), SUB_OPEN=(\[[^\]]*\])/.exec(tracker);
  assert.ok(open, "Tracker open lists found");
  for (const s of [...JSON.parse(open[1]), ...JSON.parse(open[2])]) assert.ok(!DONE_STATUSES.includes(s), s + " is open in the Tracker but done in caStatus.js");
});
