// node --test constructionChanges.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  money, days, nextChangeNumber, newChange, withChange, setStatus, isIssued, canDelete, ballInCourt,
  corFromSources, coLineAmount, eligibleForCo, setCoMembers, executeCo, voidCo, changeTotals, changeLogRows, STATUSES,
} from "./constructionChanges.js";

const ctx = (id) => ({ id, today: "2026-11-03", at: "2026-11-03T10:00:00Z", by: "pm@setty.com" });

test("money and days parse what people type", () => {
  assert.equal(money("$12,500.456"), 12500.46);
  assert.equal(money("-1,000"), -1000);
  assert.equal(money(""), null);
  assert.equal(money("abc"), null);
  assert.equal(money(7), 7);
  assert.equal(days("14 days"), 14);
  assert.equal(days(""), null);
});

test("numbers run per kind and survive deletes", () => {
  let p = {};
  p = withChange(p, newChange(p, "COR", {}, ctx("a")));
  p = withChange(p, newChange(p, "COR", {}, ctx("b")));
  p = withChange(p, newChange(p, "ASI", {}, ctx("c")));
  assert.deepEqual(p.constructionChanges.map((c) => c.number), ["COR-001", "COR-002", "ASI-001"]);
  // Delete COR-002: the next COR is still COR-003.
  p = { ...p, constructionChanges: p.constructionChanges.filter((c) => c.id !== "b") };
  assert.equal(nextChangeNumber(p, "COR").number, "COR-003");
  assert.equal(nextChangeNumber(p, "CO").number, "CO-001");
});

test("newChange starts each kind in its first status with a history line", () => {
  const c = newChange({}, "COR", { title: "Extra dampers" }, ctx("x"));
  assert.equal(c.status, "Received");
  assert.equal(c.title, "Extra dampers");
  assert.deepEqual(c.history, [{ at: "2026-11-03T10:00:00Z", by: "pm@setty.com", status: "Received", note: "Created" }]);
  assert.equal(newChange({}, "PR", {}, ctx("y")).status, "Draft");
  for (const k of Object.keys(STATUSES)) assert.ok(STATUSES[k].includes(newChange({}, k, {}, ctx("z")).status));
});

test("setStatus appends history and ignores no-ops", () => {
  const c = newChange({}, "PR", {}, ctx("x"));
  const d = setStatus(c, "Issued", { at: "t2", by: "me", note: "sent" });
  assert.equal(d.status, "Issued");
  assert.deepEqual(d.history[1], { at: "t2", by: "me", status: "Issued", from: "Draft", note: "sent" });
  assert.equal(setStatus(d, "Issued", {}), d);
});

test("delete rules: drafts only; CORs and CO members never", () => {
  assert.equal(canDelete(newChange({}, "ASI", {}, ctx("a"))).ok, true);
  assert.equal(canDelete({ kind: "ASI", status: "Issued" }).ok, false);
  assert.equal(canDelete({ kind: "COR", status: "Received" }).ok, false);
  assert.equal(canDelete({ kind: "CCD", status: "Draft", coId: "co1" }).ok, false);
  assert.equal(canDelete({ kind: "CO", status: "Draft" }).ok, true);
  assert.equal(isIssued({ kind: "CO", status: "Sent for Signature" }), true);
});

test("ball in court by kind and status", () => {
  assert.equal(ballInCourt({ kind: "PR", status: "Issued" }).label, "Contractor");
  assert.equal(ballInCourt({ kind: "PR", status: "Pricing Received" }).label, "Setty");
  assert.equal(ballInCourt({ kind: "COR", status: "Pending Sub Review" }).label, "Sub");
  assert.equal(ballInCourt({ kind: "COR", status: "Recommended" }).label, "Owner");
  assert.equal(ballInCourt({ kind: "CCD", status: "Signed by Owner" }).label, "Contractor");
  assert.equal(ballInCourt({ kind: "CO", status: "Sent for Signature" }).label, "Owner");
  assert.equal(ballInCourt({ kind: "CO", status: "Executed" }).who, "none");
  assert.equal(ballInCourt({ kind: "ASI", status: "Issued" }).who, "none");
});

test("corFromSources links the PR and carries its RFIs", () => {
  const pr = { id: "pr1", kind: "PR", title: "Add VAV-12", discipline: "Mechanical", relatedRfiIds: ["r1"] };
  const asi = { id: "asi1", kind: "ASI", title: "x", relatedRfiIds: ["r1", "r2"] };
  const c = corFromSources({}, [pr, asi], ctx("c1"));
  assert.equal(c.kind, "COR");
  assert.equal(c.title, "Add VAV-12");
  assert.deepEqual(c.sourceIds, ["pr1", "asi1"]);
  assert.deepEqual(c.relatedRfiIds, ["r1", "r2"]);
});

test("coLineAmount prefers Setty's recommendation, then the request", () => {
  assert.deepEqual(coLineAmount({ kind: "COR", amountRequested: 1000, daysRequested: 5, amountRecommended: 800 }), { amount: 800, days: 5 });
  assert.deepEqual(coLineAmount({ kind: "COR", amountRequested: "1,000" }), { amount: 1000, days: 0 });
  assert.deepEqual(coLineAmount({ kind: "CCD", amountEstimate: 500 }), { amount: 500, days: 0 });
  assert.deepEqual(coLineAmount({ kind: "PR" }), { amount: 0, days: 0 });
});

const sample = () => [
  { id: "cor1", kind: "COR", status: "Recommended", amountRequested: 1200, amountRecommended: 1000, daysRecommended: 3 },
  { id: "cor2", kind: "COR", status: "Under Review", amountRequested: 4000 },
  { id: "cor3", kind: "COR", status: "Recommended", amountRequested: 300, coId: "coX" }, // in a voided CO
  { id: "ccd1", kind: "CCD", status: "Signed by Owner", amountEstimate: 2500 },
  { id: "co1", kind: "CO", status: "Draft" },
  { id: "coX", kind: "CO", status: "Void" },
];

test("eligibleForCo: recommended CORs and signed CCDs not in a live CO", () => {
  const ids = eligibleForCo(sample(), "co1").map((c) => c.id);
  assert.deepEqual(ids, ["cor1", "cor3", "ccd1"]);
});

test("setCoMembers sums the members and marks them; dropping clears coId", () => {
  let ch = setCoMembers(sample(), "co1", ["cor1", "ccd1"]);
  const co = ch.find((c) => c.id === "co1");
  assert.equal(co.amountApproved, 3500);
  assert.equal(co.daysApproved, 3);
  assert.deepEqual(co.sourceIds, ["cor1", "ccd1"]);
  assert.equal(ch.find((c) => c.id === "cor1").coId, "co1");
  ch = setCoMembers(ch, "co1", ["cor1"]);
  assert.equal(ch.find((c) => c.id === "ccd1").coId, "");
  assert.equal(ch.find((c) => c.id === "co1").amountApproved, 1000);
});

test("executeCo closes members; voidCo releases them", () => {
  let ch = setCoMembers(sample(), "co1", ["cor1", "ccd1"]);
  const ex = executeCo(ch, "co1", { at: "t", by: "me" });
  assert.equal(ex.find((c) => c.id === "co1").status, "Executed");
  assert.equal(ex.find((c) => c.id === "cor1").status, "Approved in CO");
  assert.equal(ex.find((c) => c.id === "ccd1").status, "Finalized in CO");
  assert.equal(ex.find((c) => c.id === "cor2").status, "Under Review");
  const vo = voidCo(ch, "co1", { at: "t" });
  assert.equal(vo.find((c) => c.id === "co1").status, "Void");
  assert.equal(vo.find((c) => c.id === "cor1").coId, "");
});

test("changeTotals: original, approved, pending, projected", () => {
  let ch = setCoMembers(sample(), "co1", ["cor1"]);
  ch = executeCo(ch, "co1", {});
  ch.push({ id: "co2", kind: "CO", status: "Sent for Signature", amountApproved: 700 });
  const t = changeTotals({ constructionContract: { originalSum: "100,000", originalDays: 180 }, constructionChanges: ch });
  assert.equal(t.original, 100000);
  assert.equal(t.approved, 1000);
  assert.equal(t.approvedDays, 3);
  assert.equal(t.revised, 101000);
  assert.equal(t.revisedDays, 183);
  assert.equal(t.pendingCo, 700);
  assert.equal(t.ccdOpen, 2500);
  // cor2 (4000 requested) + cor3 (300, its CO is void)
  assert.equal(t.corOpen, 4300);
  assert.equal(t.corOpenCount, 2);
  assert.equal(t.projected, 101000 + 700 + 2500 + 4300);
  assert.equal(t.pctApproved, 1);
  assert.equal(t.pctProjected, 8.5);
  assert.equal(changeTotals({}).pctApproved, null);
});

test("changeLogRows: grouped by kind, links resolved, history readable", () => {
  const p = {
    rfis: [{ id: "r1", number: "RFI-004" }],
    constructionChanges: [
      { id: "co1", kind: "CO", number: "CO-001", status: "Executed", amountApproved: 1000, sourceIds: ["cor1"] },
      { id: "cor1", kind: "COR", number: "COR-002", status: "Approved in CO", coId: "co1", amountRequested: 1200, sourceIds: ["pr1"], relatedRfiIds: ["r1"],
        description: "<p>Add &amp; relocate</p>", history: [{ at: "2026-11-01T09:00:00Z", status: "Received", by: "pm" }, { at: "2026-11-03", status: "Approved in CO" }] },
      { id: "pr1", kind: "PR", number: "PR-001", status: "Closed" },
    ],
  };
  const { headers, rows } = changeLogRows(p);
  assert.deepEqual(rows.map((r) => r[0]), ["PR-001", "COR-002", "CO-001"]);
  const col = (h) => headers.indexOf(h);
  const cor = rows[1];
  assert.equal(cor[col("Change order")], "CO-001");
  assert.equal(cor[col("Linked documents")], "PR-001");
  assert.equal(cor[col("Related RFIs")], "RFI-004");
  assert.equal(cor[col("Requested $")], "1200.00");
  assert.equal(cor[col("Description")], "Add & relocate");
  assert.equal(cor[col("Status history")], "2026-11-01 Received (pm); 2026-11-03 Approved in CO");
  assert.equal(rows[2][col("Linked documents")], "COR-002");
});
