// Tests for constructionChangesView.ts: the connector's read of project.constructionChanges.
import { strict as assert } from "node:assert";
import test from "node:test";
import { changeSummary, listChanges, readChange, isSettyPrime } from "./constructionChangesView.ts";

const P = {
  prime: "Setty & Associates",
  constructionContract: { contractor: "Acme Builders", originalSum: 1000000, originalDays: 240 },
  rfis: [{ id: "r1", number: "RFI-004", title: "Duct clash", status: "Responded" }],
  subconsultants: [{ id: "s1", firm: "Acme Electrical" }],
  constructionChanges: [
    { id: "pr1", kind: "PR", number: "PR-001", title: "Add VAV-12", status: "Issued", date: "2026-10-01", dueDate: "2026-10-10", relatedRfiIds: ["r1"] },
    { id: "cor1", kind: "COR", number: "COR-001", title: "Add VAV-12", status: "Approved in CO", amountRequested: 12500, daysRequested: 5, amountRecommended: 11000, daysRecommended: 3, sourceIds: ["pr1"], coId: "co1", relatedRfiIds: ["r1"],
      description: "<p>Furnish &amp; install</p>", history: [{ at: "2026-10-12", status: "Received", by: "pm" }] },
    { id: "cor2", kind: "COR", number: "COR-002", title: "Asbestos", status: "Under Review", amountRequested: 4000, dueDate: "2026-10-20", contractorRef: "PCO 7", subAssigned: "s1" },
    { id: "co1", kind: "CO", number: "CO-001", title: "CO 1", status: "Executed", amountApproved: 11000, daysApproved: 3, sourceIds: ["cor1"] },
    { id: "asi1", kind: "ASI", number: "ASI-001", title: "Paint color", status: "Issued" },
    { kind: "BOGUS", number: "X-1" },
  ],
};
const TODAY = "2026-11-03";

test("isSettyPrime", () => {
  assert.equal(isSettyPrime(P), true);
  assert.equal(isSettyPrime({ prime: "Acme" }), false);
});

test("changeSummary: null with no changes; counts, totals, Setty's queue, overdue", () => {
  assert.equal(changeSummary({}, TODAY), null);
  const s = changeSummary(P, TODAY);
  assert.equal(s.count, 5); // the BOGUS row is ignored
  assert.deepEqual(s.byKind.COR, { total: 2, open: 1 });
  assert.deepEqual(s.byKind.ASI, { total: 1, open: 0 });
  assert.equal(s.totals.revisedContract, 1011000);
  assert.equal(s.totals.pending, 4000);
  assert.deepEqual(s.totals.contractDays, { original: 240, approved: 3, revised: 243 });
  assert.deepEqual(s.withSetty, ["COR-002 — Asbestos (Under Review)"]);
  assert.deepEqual(s.overdue.map((o) => o.item), ["PR-001 — Add VAV-12 (Issued)", "COR-002 — Asbestos (Under Review)"]);
  assert.equal(s.overdue[0].ballInCourt, "Contractor");
});

test("listChanges filters by type, open, status and text", () => {
  assert.equal(listChanges(P, {}, TODAY).count, 5);
  const cor = listChanges(P, { type: "cor" }, TODAY);
  assert.deepEqual(cor.items.map((i) => i.number), ["COR-001", "COR-002"]);
  assert.equal(cor.items[0].inChangeOrder, "CO-001");
  assert.deepEqual(cor.items[0].linked, ["PR-001"]);
  assert.equal(cor.items[0].recommended, 11000);
  assert.deepEqual(listChanges(P, { openOnly: true }, TODAY).items.map((i) => i.number), ["PR-001", "COR-002"]);
  assert.deepEqual(listChanges(P, { status: "executed" }, TODAY).items.map((i) => i.number), ["CO-001"]);
  assert.deepEqual(listChanges(P, { query: "pco 7" }, TODAY).items.map((i) => i.number), ["COR-002"]);
  assert.deepEqual(listChanges(P, { query: "furnish" }, TODAY).items.map((i) => i.number), ["COR-001"]);
});

test("readChange: by number in loose forms, with links both ways and history", () => {
  const c = readChange(P, "cor 1", TODAY);
  assert.equal(c.number, "COR-001");
  assert.equal(c.description, "Furnish & install");
  assert.deepEqual(c.linkedDocuments.map((x) => x.number), ["PR-001"]);
  assert.deepEqual(c.referencedBy.map((x) => x.number), ["CO-001"]);
  assert.deepEqual(c.relatedRFIs, [{ number: "RFI-004", title: "Duct clash", status: "Responded" }]);
  assert.equal(c.history[0].status, "Received");
  const co = readChange(P, "CO-0001", TODAY);
  assert.deepEqual(co.includes, [{ number: "COR-001", type: "COR", title: "Add VAV-12", status: "Approved in CO", amount: 11000 }]);
  assert.deepEqual(readChange(P, "PR-001", TODAY).referencedBy.map((x) => x.number), ["COR-001"]);
  assert.equal(readChange(P, "COR-002", TODAY).subconsultantReviewingPricing, "Acme Electrical");
  assert.equal(readChange(P, "COR-099", TODAY), null);
});
