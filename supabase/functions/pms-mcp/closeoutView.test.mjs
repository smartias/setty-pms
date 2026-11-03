// Tests for closeoutView.ts: the connector's read of project.closeout.
import { strict as assert } from "node:assert";
import test from "node:test";
import { closeoutSummary, listCloseout } from "./closeoutView.ts";

const P = {
  subconsultants: [{ id: "s1", firm: "Acme TAB" }],
  closeout: { startedAt: "2026-10-01", items: [
    { id: "a", category: "O&M Manual", title: "O&M manuals", status: "Accepted", dateReceived: "2026-10-05", dateAccepted: "2026-10-09" },
    { id: "b", category: "Warranty", title: "Warranties", status: "Revise and Resubmit", dueDate: "2026-10-30", responsible: "Acme Mech", comments: "Missing compressor letter",
      history: [{ at: "2026-10-01", status: "Not Received", note: "Added" }, { at: "2026-10-20", status: "Revise and Resubmit", from: "Received", by: "pm" }] },
    { id: "c", category: "Test & Balance", title: "TAB report", status: "Under Review", reviewerSubId: "s1", specSection: "23 05 93", discipline: "Mechanical" },
    { id: "d", category: "Completion Certificate", title: "Certificate of Substantial Completion", status: "Not Received" },
    { id: "e", category: "Attic Stock / Spare Parts", title: "Spare belts", status: "Not Received", required: false },
    { id: "f", category: "Training", title: "Owner training", status: "Not Required" },
    null,
  ] },
};
const TODAY = "2026-11-03";

test("closeoutSummary: null until started; progress and queues", () => {
  assert.equal(closeoutSummary({}, TODAY), null);
  assert.equal(closeoutSummary({ closeout: { items: [] } }, TODAY), null);
  const s = closeoutSummary(P, TODAY);
  assert.equal(s.progress.requiredItems, 4);
  assert.equal(s.progress.accepted, 1);
  assert.equal(s.progress.pctAccepted, 25);
  assert.equal(s.progress.withContractor, 1);
  assert.equal(s.progress.readyForFinalCompletion, false);
  assert.deepEqual(s.owedByContractor, ["Warranties (Revise and Resubmit)"]);
  assert.deepEqual(s.withSetty, ["Certificate of Substantial Completion (Not Received)"]);
  assert.deepEqual(s.overdue, [{ item: "Warranties (Revise and Resubmit)", dueDate: "2026-10-30", ballInCourt: "Contractor (Acme Mech)" }]);
});

test("listCloseout: ordered by category, filters, details", () => {
  const all = listCloseout(P, {}, TODAY);
  assert.equal(all.count, 6);
  assert.deepEqual(all.items.map((i) => i.category), ["O&M Manual", "Warranty", "Attic Stock / Spare Parts", "Training", "Test & Balance", "Completion Certificate"]);
  const tab = all.items.find((i) => i.item === "TAB report");
  assert.equal(tab.reviewedBySub, "Acme TAB");
  assert.equal(tab.ballInCourt, "Sub: Acme TAB");
  assert.equal(tab.specSection, "23 05 93");
  assert.equal(all.items.find((i) => i.item === "Spare belts").required, false);
  assert.equal(all.items[1].overdue, true);
  assert.equal(all.items[1].history, undefined);
  assert.deepEqual(listCloseout(P, { openOnly: true }, TODAY).items.map((i) => i.item), ["Warranties", "Spare belts", "TAB report", "Certificate of Substantial Completion"]);
  assert.deepEqual(listCloseout(P, { category: "warranty" }, TODAY).items.map((i) => i.item), ["Warranties"]);
  assert.deepEqual(listCloseout(P, { category: "test" }, TODAY).items.map((i) => i.item), ["TAB report"]);
  assert.deepEqual(listCloseout(P, { status: "accepted" }, TODAY).items.map((i) => i.item), ["O&M manuals"]);
  assert.deepEqual(listCloseout(P, { query: "compressor" }, TODAY).items.map((i) => i.item), ["Warranties"]);
  const h = listCloseout(P, { query: "compressor", includeHistory: true }, TODAY).items[0].history;
  assert.equal(h.length, 2);
  assert.equal(h[1].from, "Received");
});
