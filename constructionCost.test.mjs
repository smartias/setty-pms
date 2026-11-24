// Tests for constructionCost.js: the dated construction cost history beside
// the Fee Calculator, and the per-$1M RFI measure built on it.
//
//   node --test constructionCost.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  COST_SOURCES, costLogOf, latestConstructionCost, isCostCheckMilestone, flagCostCheck,
  pendingCostChecks, skipCostCheck, planCostCheck, rfisPerMillion, costSourceLabel,
  looksLikeCostDocument, planCostDocFlags, openCostDocFlags, dismissCostDocFlag, costDocFlagsOf, COST_DOC_FLAG_MAX,
  planCostEstimateReview, compareEstimates, costEstimateReviewsOf, latestCostEstimateReview, costReviewState,
  markCostReviewRequested, markCostReviewStarted, ESTIMATE_DISCIPLINES, estimateDisciplineLabel,
} from "./constructionCost.js";

const stamp = (n = 1) => ({ at: `2027-01-0${n}T12:00:00.000Z`, id: "e" + n, by: "PM", via: "pms" });
const project = (over = {}) => ({
  id: "p1", manualConstructionCost: 0,
  milestones: [
    { id: "m-sd", type: "billable", phase: "SD", name: "SD Submission", pctComplete: 100 },
    { id: "m-dd", type: "billable", phase: "DD", name: "100% DD Submission", pctComplete: 40 },
    { id: "m-co", type: "billable", phase: "__CO__", coId: "co1", name: "CO 1" },
    { id: "m-nb", type: "non-billable", phase: "DD", name: "Kickoff" },
    { id: "m-x", type: "billable", phase: "CD", name: "CD Submission", cancelled: true },
  ],
  ...over,
});

test("nothing on record reads as null, never the SF rule of thumb", () => {
  const p = project({ squareFootage: 50000, buildingCategory: "Office" });
  assert.deepEqual(latestConstructionCost(p), { value: null, at: null, source: null, deliverable: null, basis: null, checks: 0 });
});

test("with no history the Fee Calculator's typed cost is the fallback", () => {
  const l = latestConstructionCost(project({ manualConstructionCost: 18000000 }));
  assert.equal(l.value, 18000000);
  assert.equal(l.basis, "fee-calculator");
});

test("an entry is appended and the Fee Calculator's number is not touched", () => {
  const p = project({ manualConstructionCost: 18000000 });
  const plan = planCostCheck(p, { value: 21500000.4, source: "cost-estimate", document: "DD Estimate.pdf", milestoneId: "m-dd" }, stamp());
  assert.equal(plan.ok, true);
  assert.equal(plan.project.manualConstructionCost, 18000000);
  assert.equal(p.constructionCostLog, undefined, "input project is not mutated");
  assert.equal(plan.entry.value, 21500000);
  assert.equal(plan.entry.deliverable, "100% DD Submission");
  assert.equal(plan.entry.phase, "DD");
  assert.equal(plan.entry.unchanged, false);
  assert.equal(plan.previous.basis, "fee-calculator");
  assert.equal(plan.changePct, 19.4);
  const l = latestConstructionCost(plan.project);
  assert.equal(l.value, 21500000);
  assert.equal(l.basis, "log");
  assert.equal(l.checks, 1);
});

test("unchanged confirms the figure on record, and is refused when there is none", () => {
  assert.equal(planCostCheck(project(), { unchanged: true, source: "cost-estimate" }, stamp()).ok, false);
  const first = planCostCheck(project(), { value: 9000000, source: "proposal" }, stamp(1)).project;
  const plan = planCostCheck(first, { unchanged: true, source: "cost-estimate", deliverable: "SD" }, stamp(2));
  assert.equal(plan.ok, true);
  assert.equal(plan.entry.value, 9000000);
  assert.equal(plan.entry.unchanged, true);
  assert.equal(plan.changePct, 0);
  assert.equal(plan.entry.milestoneId, "m-sd");
  assert.equal(costLogOf(plan.project).length, 2);
});

test("a fee-sized number, a missing source or a missing stamp is refused", () => {
  assert.equal(planCostCheck(project(), { value: 9500, source: "proposal" }, stamp()).ok, false);
  assert.equal(planCostCheck(project(), { value: "abc", source: "proposal" }, stamp()).ok, false);
  assert.equal(planCostCheck(project(), { value: 9000000 }, stamp()).ok, false);
  assert.equal(planCostCheck(project(), { value: 9000000, source: "guess" }, stamp()).ok, false);
  assert.equal(planCostCheck(project(), { value: 9000000, source: "bid" }, {}).ok, false);
});

test("a deliverable that matches no milestone is kept as text", () => {
  const plan = planCostCheck(project(), { value: 9000000, source: "owner-budget", deliverable: "Board presentation" }, stamp());
  assert.equal(plan.entry.milestoneId, null);
  assert.equal(plan.entry.deliverable, "Board presentation");
});

test("the newest entry wins whatever order the log is stored in", () => {
  const p = project({ constructionCostLog: [
    { id: "b", at: "2027-03-01T00:00:00Z", value: 12000000, source: "cost-estimate" },
    { id: "a", at: "2027-01-01T00:00:00Z", value: 10000000, source: "proposal" },
    { id: "bad", at: "2027-04-01T00:00:00Z", value: 0 },
  ] });
  assert.equal(latestConstructionCost(p).value, 12000000);
  assert.deepEqual(costLogOf(p).map((e) => e.id), ["a", "b"]);
});

test("only billable base-contract milestones are flagged for a cost check", () => {
  const p = project();
  assert.equal(isCostCheckMilestone(p.milestones[0]), true);
  for (const id of ["m-co", "m-nb", "m-x", "nope"]) assert.equal(flagCostCheck(p, id), p, id);
  const flagged = flagCostCheck(p, "m-dd");
  assert.deepEqual(pendingCostChecks(flagged).map((m) => m.id), ["m-dd"]);
  assert.equal(flagCostCheck(flagged, "m-dd"), flagged, "already flagged: same reference");
});

test("recording against a flagged milestone clears the flag; skip clears it without an entry", () => {
  const flagged = flagCostCheck(project(), "m-dd");
  const plan = planCostCheck(flagged, { value: 9000000, source: "cost-estimate", milestoneId: "m-dd" }, stamp());
  assert.equal(pendingCostChecks(plan.project).length, 0);
  const skipped = skipCostCheck(flagged, "m-dd");
  assert.equal(pendingCostChecks(skipped).length, 0);
  assert.equal(skipped.constructionCostLog, undefined);
  const plain = project();
  assert.equal(skipCostCheck(plain, "m-dd"), plain, "nothing flagged: same reference");
});

test("RFIs per $1M leaves out projects with no cost and says which", () => {
  const r = rfisPerMillion([
    { project: "A", preventable: 30, cost: 20000000 },
    { project: "B", preventable: 10, cost: 5000000 },
    { project: "C", preventable: 99, cost: null },
  ]);
  assert.equal(r.perMillion, 1.6);
  assert.equal(r.preventable, 40);
  assert.equal(r.constructionValue, 25000000);
  assert.equal(r.projectsWithCost, 2);
  assert.deepEqual(r.missingCost, ["C"]);
  assert.equal(rfisPerMillion([{ project: "C", preventable: 3, cost: 0 }]).perMillion, null);
});

test("source labels", () => {
  assert.equal(costSourceLabel("cost-estimate"), "Cost estimate");
  assert.equal(costSourceLabel("nope"), "Other");
  assert.ok(COST_SOURCES.length >= 5);
});

test("a file that reads like a construction cost estimate is recognized by name", () => {
  const yes = [
    "100% DD Cost Estimate.pdf", "SAPX_CD_Estimate_2027-03-01.xlsx", "Opinion of Probable Construction Cost.pdf",
    "OPC rev2.xlsx", "Bid Tabulation.pdf", "Construction Budget.xlsx", "GMP - Amendment 1.pdf", "MEP estimate.xls",
  ];
  for (const name of yes) assert.equal(looksLikeCostDocument({ name, folderPath: "Incoming/2027-03-01" }), true, name);
  const no = [
    "Fee Estimate.xlsx", "Setty Proposal - Cost Estimate.pdf", "Load Estimate.xlsx", "Energy estimate.pdf",
    "Estimated schedule.pdf", "Hours estimate.xlsx", "Cost Estimate.png", "M-101.pdf", "Invoice 12 - estimate.pdf",
  ];
  for (const name of no) assert.equal(looksLikeCostDocument({ name, folderPath: "Incoming" }), false, name);
  assert.equal(looksLikeCostDocument({ name: "Cost Estimate.pdf", folderPath: "Contract/Fee" }), false, "the firm's own commercial folders");
  assert.equal(looksLikeCostDocument({ name: "Cost Estimate", ext: "pdf", folderPath: "" }), true, "ext given apart from the name");
  assert.equal(looksLikeCostDocument(null), false);
});

test("newly saved cost documents are flagged once, and never again once answered", () => {
  const now = "2027-03-02T08:00:00.000Z";
  const docs = [
    { itemId: "d1", name: "DD Cost Estimate.pdf", folderPath: "Incoming", webUrl: "https://setty.sharepoint.com/x", seenAt: "2027-03-01T20:00:00Z" },
    { itemId: "d2", name: "M-101.pdf", folderPath: "Outgoing" },
    { itemId: "d3", name: "Bid Tab.xlsx", folderPath: "Bid", webUrl: "javascript:alert(1)" },
  ];
  const p0 = project();
  const plan = planCostDocFlags(p0, docs, now);
  assert.deepEqual(plan.added.map((f) => f.itemId), ["d1", "d3"]);
  assert.equal(plan.added[1].webUrl, null, "only https links are stored");
  assert.equal(p0.costDocFlags, undefined, "input project is not mutated");
  assert.equal(openCostDocFlags(plan.project).length, 2);
  const again = planCostDocFlags(plan.project, docs, now);
  assert.equal(again.project, plan.project, "nothing new: same reference, so nothing is written");
  const dismissed = dismissCostDocFlag(plan.project, "d3");
  assert.deepEqual(openCostDocFlags(dismissed).map((f) => f.itemId), ["d1"]);
  assert.equal(planCostDocFlags(dismissed, docs, now).project, dismissed, "a dismissed file is not flagged again");
  assert.equal(dismissCostDocFlag(dismissed, "d3"), dismissed);
  const rec = planCostCheck(dismissed, { value: 21000000, source: "cost-estimate", document: "DD Cost Estimate.pdf" }, stamp());
  assert.equal(openCostDocFlags(rec.project).length, 0, "recording a figure answers the open flags");
  const f1 = costDocFlagsOf(rec.project).find((f) => f.itemId === "d1");
  assert.equal(f1.status, "recorded");
  assert.equal(f1.entryId, rec.entry.id);
  assert.equal(planCostDocFlags(rec.project, docs, now).project, rec.project);
});

test("the flag list is capped and open flags are the last to go", () => {
  const closed = Array.from({ length: COST_DOC_FLAG_MAX }, (_, i) => ({ itemId: "old" + i, name: "x", status: "dismissed" }));
  const plan = planCostDocFlags(project({ costDocFlags: closed }), [{ itemId: "new", name: "CD Cost Estimate.pdf" }], "2027-01-01T00:00:00Z");
  const flags = costDocFlagsOf(plan.project);
  assert.equal(flags.length, COST_DOC_FLAG_MAX);
  assert.equal(flags[flags.length - 1].itemId, "new");
  assert.equal(flags[0].itemId, "old1");
});

const dd = {
  document: { name: "50% DD Cost Estimate.pdf", webUrl: "https://setty.sharepoint.com/dd50.pdf" },
  deliverable: "DD", estimateDate: "2027-02-10", preparedBy: "Estimator Co", total: 20000000,
  totalBasis: "With 10% design contingency and escalation to mid-2028",
  disciplines: [
    { discipline: "mechanical", amount: 3000000, basis: "Division 23 with trade markups" },
    { discipline: "electrical", amount: 2400000 },
    { discipline: "plumbing", amount: 900000 },
  ],
};

test("a cost estimate review is saved with discipline totals and records the total in the history", () => {
  const p0 = project({ costDocFlags: [{ itemId: "d1", name: "50% DD Cost Estimate.pdf", status: "open" }] });
  const plan = planCostEstimateReview(p0, dd, stamp(1));
  assert.equal(plan.ok, true);
  assert.equal(p0.costEstimateReviews, undefined, "input project is not mutated");
  assert.equal(plan.review.mepTotal, 6300000);
  assert.equal(plan.review.mepShare, 31.5);
  assert.equal(plan.previous, null);
  assert.deepEqual(plan.changes, [], "nothing to compare the first estimate with");
  assert.equal(plan.recorded.value, 20000000);
  assert.equal(plan.recorded.source, "cost-estimate");
  assert.equal(plan.recorded.document, "50% DD Cost Estimate.pdf");
  assert.equal(latestConstructionCost(plan.project).value, 20000000);
  assert.equal(openCostDocFlags(plan.project).length, 0, "the flag for the document is answered");
  assert.equal(plan.project.manualConstructionCost, 0, "the Fee Calculator is not touched");
  assert.equal(latestCostEstimateReview(plan.project).id, plan.review.id);
});

test("the next estimate is compared with the previous one, discipline by discipline", () => {
  const first = planCostEstimateReview(project(), dd, stamp(1)).project;
  const plan = planCostEstimateReview(first, {
    document: { name: "100% DD Cost Estimate.pdf" }, total: 22000000,
    disciplines: [
      { discipline: "mechanical", amount: 3600000 },
      { discipline: "electrical", amount: 2400000 },
      { discipline: "fireProtection", amount: 400000 },
    ],
  }, stamp(2));
  assert.equal(plan.ok, true);
  assert.equal(plan.review.comparedTo.document, "50% DD Cost Estimate.pdf");
  const by = Object.fromEntries(plan.changes.map((c) => [c.key, c]));
  assert.deepEqual([by.total.from, by.total.to, by.total.delta, by.total.deltaPct], [20000000, 22000000, 2000000, 10]);
  assert.equal(by.mechanical.deltaPct, 20);
  assert.equal(by.electrical.delta, 0);
  assert.deepEqual([by.plumbing.from, by.plumbing.to, by.plumbing.delta], [900000, null, null], "dropped from the breakdown: not comparable, not a saving");
  assert.deepEqual([by.fireProtection.from, by.fireProtection.to, by.fireProtection.deltaPct], [null, 400000, null]);
  assert.equal(costEstimateReviewsOf(plan.project).length, 2);
  assert.equal(costLogOf(plan.project).length, 2);
  assert.deepEqual(compareEstimates(null, plan.review), []);
});

test("recordTotal:false, or no total, leaves the cost history alone", () => {
  const a = planCostEstimateReview(project(), { ...dd, recordTotal: false }, stamp());
  assert.equal(a.recorded, null);
  assert.equal(costLogOf(a.project).length, 0);
  const b = planCostEstimateReview(project(), { document: { name: "MEP estimate.xlsx" }, disciplines: [{ discipline: "plumbing", amount: 500000 }] }, stamp());
  assert.equal(b.ok, true);
  assert.equal(b.review.total, null);
  assert.equal(b.review.mepShare, null);
  assert.equal(b.recorded, null);
});

test("reconciliation findings are kept with their sheets; a run that could not happen says why", () => {
  const plan = planCostEstimateReview(project(), { ...dd, reconciliation: { against: "2027-02-01_100% DD", findings: [
    { severity: "high", discipline: "mechanical", issue: "Estimate carries 2 chillers; M-601 schedules 3.", estimate: "2 x 400 ton", drawings: "CH-1, CH-2, CH-3", sheets: ["M-601"] },
    { severity: "nope", discipline: "structural", issue: "Generator pad not priced.", sheets: "E-101" },
    { issue: "" },
  ] } }, stamp());
  const f = plan.review.reconciliation.findings;
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].sheets, ["M-601"]);
  assert.deepEqual([f[1].severity, f[1].discipline, f[1].sheets], ["medium", null, []]);
  const none = planCostEstimateReview(project(), { ...dd, reconciliation: { notRun: "No issued set in the index." } }, stamp());
  assert.equal(none.review.reconciliation.notRun, "No issued set in the index.");
  assert.equal(planCostEstimateReview(project(), dd, stamp()).review.reconciliation, null, "not asked for");
});

test("bad reviews are refused with a reason", () => {
  const bad = (over) => planCostEstimateReview(project(), { ...dd, ...over }, stamp());
  assert.equal(bad({ document: {} }).ok, false);
  assert.equal(bad({ total: 9000 }).ok, false);
  assert.equal(bad({ total: undefined, disciplines: [] }).ok, false);
  assert.equal(bad({ disciplines: [{ discipline: "structural", amount: 1 }] }).ok, false);
  assert.equal(bad({ disciplines: [{ discipline: "plumbing", amount: 1 }, { discipline: "plumbing", amount: 2 }] }).ok, false);
  assert.equal(bad({ disciplines: [{ discipline: "plumbing", amount: -5 }] }).ok, false);
  assert.match(bad({ disciplines: [{ discipline: "mechanical", amount: 25000000 }] }).error, /more than the total/);
  assert.equal(planCostEstimateReview(project(), dd, {}).ok, false);
  assert.equal(bad({ document: { name: "x.pdf", webUrl: "javascript:alert(1)" } }).review.document.webUrl, null);
});

test("request, started and ready states", () => {
  const now = Date.parse("2027-01-01T12:10:00.000Z");
  assert.equal(costReviewState(project(), now).state, "none");
  const req = markCostReviewRequested(project(), { at: "2027-01-01T12:00:00.000Z", by: "PM", document: "DD Cost Estimate.pdf", reconcile: true });
  assert.deepEqual(costReviewState(req, now), { state: "waiting", mins: 10, by: "PM", document: "DD Cost Estimate.pdf" });
  assert.equal(req.costEstimateReviewRequested.reconcile, true);
  const started = markCostReviewStarted(req, { at: "2027-01-01T12:04:00.000Z", by: "PM" });
  assert.equal(costReviewState(started, now).state, "reviewing");
  assert.equal(costReviewState(started, now).mins, 6);
  const done = planCostEstimateReview(started, dd, { at: "2027-01-01T12:09:00.000Z", id: "r1", by: "PM" }).project;
  assert.equal(costReviewState(done, now).state, "ready");
  const again = markCostReviewRequested(done, { at: "2027-01-01T12:09:30.000Z", by: "PM" });
  assert.equal(costReviewState(again, now).state, "waiting", "a re-send after a review waits again");
});

test("discipline labels", () => {
  assert.deepEqual(ESTIMATE_DISCIPLINES.slice(0, 3).map((d) => d.key), ["mechanical", "electrical", "plumbing"]);
  assert.equal(estimateDisciplineLabel("plumbing"), "Plumbing");
});

// Drift anchors: the page loads the module and flags a milestone at 100%.
test("SettyPMS.html loads the module and uses it where milestones complete", () => {
  const html = readFileSync(new URL("./SettyPMS.html", import.meta.url), "utf8");
  assert.ok(html.includes('import * as ConstructionCost from "./constructionCost.js";'));
  assert.ok(html.includes("window.ConstructionCost = ConstructionCost;"));
  assert.ok(html.split("costCheckOnComplete(").length - 1 >= 3, "defined once and called from the Schedule tab and the Dashboard");
  assert.ok(html.includes("function ConstructionCostPanel("));
});
