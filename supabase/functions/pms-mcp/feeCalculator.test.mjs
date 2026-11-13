// Tests for feeCalculator.ts (the rules behind set_project_fee) plus drift
// anchors on the tool registration in index.ts and the audit-log label in the app.
//
//   node --test supabase/functions/pms-mcp/feeCalculator.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { planFeeWrite, phaseFeesFor, FEE_AUDIT_ACTION } from "./feeCalculator.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const stamp = { user: "pm@setty.com", date: "2026-11-13T12:00:00.000Z", id: "a1" };

const project = (over = {}) => ({
  id: "p1", projectNumber: "SAPX260001.00", feeScheduleFinalized: false,
  phases: [
    { id: "1", code: "SD", name: "Schematic Design", pct: 0.15, billable: true },
    { id: "2", code: "DD", name: "Design Development", pct: 0.25, billable: true },
    { id: "3", code: "CD", name: "Construction Documents", pct: 0.35, billable: true },
    { id: "4", code: "BS", name: "Bid Phase", pct: 0.05, billable: true },
    { id: "5", code: "CA", name: "Construction Administration", pct: 0.20, billable: true },
  ],
  milestones: [{ id: "m1", type: "non-billable", name: "Kickoff" }],
  ...over,
});

test("a locked schedule is refused and nothing changes", () => {
  const p = project({ feeScheduleFinalized: true });
  const r = planFeeWrite(p, { settyFee: 100000 }, stamp);
  assert.equal(r.ok, false);
  assert.match(r.error, /locked/);
  assert.match(r.nextStep, /Unlock & Edit/);
});

test("a total alone sets manualSettyFee and splits by percentage", () => {
  const p = project();
  const r = planFeeWrite(p, { settyFee: 100000, note: "per signed proposal" }, stamp);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.project.manualSettyFee, 100000);
  assert.equal(r.project.phases, p.phases, "phases untouched when only the total is set");
  assert.deepEqual(r.summary.phases.map((x) => x.fee), [15000, 25000, 35000, 5000, 20000]);
  assert.equal(r.summary.totalPhaseFee, 100000);
  assert.equal(r.summary.variance, 0);
  assert.equal(r.summary.warning, undefined);
  assert.equal(r.summary.settyFeeSource, "set by this call");
});

test("it never locks, never touches milestones, and leaves the input alone", () => {
  const p = project();
  const before = JSON.stringify(p);
  const r = planFeeWrite(p, { settyFee: 100000, phaseFees: [{ phase: "SD", fee: 15000 }] }, stamp);
  assert.equal(JSON.stringify(p), before, "input project mutated");
  assert.equal(r.project.feeScheduleFinalized, false);
  assert.equal(r.project.lockedSettyFee, undefined);
  assert.equal(r.project.milestones, p.milestones);
});

test("phase fees match by code or name, ignoring case, and round to cents", () => {
  const r = planFeeWrite(project(), {
    settyFee: 100000,
    phaseFees: [{ phase: "sd", fee: 20000.005 }, { phase: "design development", fee: 20000 }],
  }, stamp);
  assert.equal(r.ok, true);
  assert.equal(r.project.phases[0].manualFee, 20000.01);
  assert.equal(r.project.phases[1].manualFee, 20000);
  assert.equal(r.project.phases[2].manualFee, undefined);
  assert.deepEqual(r.summary.phasesChanged.map((c) => c.code), ["SD", "DD"]);
});

test("a full phase list that matches the total carries no warning", () => {
  const r = planFeeWrite(project(), {
    settyFee: 120000,
    phaseFees: [
      { phase: "SD", fee: 18000 }, { phase: "DD", fee: 30000 }, { phase: "CD", fee: 42000 },
      { phase: "BS", fee: 6000 }, { phase: "CA", fee: 24000 },
    ],
  }, stamp);
  assert.equal(r.summary.totalPhaseFee, 120000);
  assert.equal(r.summary.variance, 0);
  assert.equal(r.summary.warning, undefined);
});

test("a phase total that misses the Setty fee is written but flagged", () => {
  const r = planFeeWrite(project(), {
    settyFee: 100000,
    phaseFees: [
      { phase: "SD", fee: 20000 }, { phase: "DD", fee: 30000 }, { phase: "CD", fee: 40000 },
      { phase: "BS", fee: 5000 }, { phase: "CA", fee: 20000 },
    ],
  }, stamp);
  assert.equal(r.ok, true);
  assert.equal(r.summary.totalPhaseFee, 115000);
  assert.equal(r.summary.variance, 15000);
  assert.match(r.summary.warning, /over the Setty fee/);
});

test("phase fees with no typed total say the total is still calculated", () => {
  const r = planFeeWrite(project(), { phaseFees: [{ phase: "SD", fee: 18000 }] }, stamp);
  assert.equal(r.ok, true);
  assert.equal(r.project.manualSettyFee, undefined);
  assert.equal(r.summary.settyFee, null);
  assert.equal(r.summary.settyFeeSource, "calculated by the app");
  assert.deepEqual(r.summary.phases.map((x) => x.fee), [18000, null, null, null, null]);
  assert.match(r.summary.warning, /still calculating/);
});

test("one bad row in a list writes none of them and names the phases", () => {
  const r = planFeeWrite(project(), {
    phaseFees: [{ phase: "SD", fee: 18000 }, { phase: "Commissioning", fee: 5000 }],
  }, stamp);
  assert.equal(r.ok, false);
  assert.match(r.error, /no phase "Commissioning"/);
  assert.equal(r.phases.length, 5);
});

test("non-billable, duplicate, ambiguous and non-positive rows are refused", () => {
  const nb = project();
  nb.phases[3] = { ...nb.phases[3], billable: false };
  assert.match(planFeeWrite(nb, { phaseFees: [{ phase: "BS", fee: 1 }] }, stamp).error, /not a billable phase/);
  assert.match(planFeeWrite(project(), { phaseFees: [{ phase: "SD", fee: 1 }, { phase: "Schematic Design", fee: 2 }] }, stamp).error, /listed twice/);
  const dup = project();
  dup.phases[1] = { ...dup.phases[1], code: "SD" };
  assert.match(planFeeWrite(dup, { phaseFees: [{ phase: "SD", fee: 1 }] }, stamp).error, /matches 2 phases/);
  assert.equal(planFeeWrite(project(), { settyFee: 0 }, stamp).ok, false);
  assert.equal(planFeeWrite(project(), { settyFee: -5 }, stamp).ok, false);
  assert.equal(planFeeWrite(project(), { settyFee: Number.NaN }, stamp).ok, false);
  assert.equal(planFeeWrite(project(), {}, stamp).ok, false);
  assert.match(planFeeWrite(project({ phases: [] }), { phaseFees: [{ phase: "SD", fee: 1 }] }, stamp).error, /no phases/);
});

test("the same values twice is a no-op: same reference back, no audit entry", () => {
  const first = planFeeWrite(project(), { settyFee: 100000, phaseFees: [{ phase: "SD", fee: 15000 }] }, stamp);
  const again = planFeeWrite(first.project, { settyFee: 100000, phaseFees: [{ phase: "SD", fee: 15000 }] }, stamp);
  assert.equal(again.changed, false);
  assert.equal(again.project, first.project);
  assert.equal(again.project.feeAuditLog.length, 1);
});

test("the audit entry names the caller and can never read as a lock", () => {
  const p = project({ manualSettyFee: 90000, feeAuditLog: [{ id: "x", action: "unlocked" }] });
  const r = planFeeWrite(p, { settyFee: 100000, note: "  revised per client email  " }, stamp);
  const e = r.project.feeAuditLog.at(-1);
  assert.equal(r.project.feeAuditLog.length, 2);
  assert.equal(e.action, FEE_AUDIT_ACTION);
  assert.notEqual(e.action, "locked");
  assert.equal(e.user, "pm@setty.com");
  assert.equal(e.note, "revised per client email");
  assert.deepEqual(e.changes.settyFee, { from: 90000, to: 100000 });
  assert.equal(r.summary.previousSettyFeeOverride, 90000);
  // The app derives the contract fee from entries with action === "locked".
  assert.equal(r.project.feeAuditLog.filter((x) => x.action === "locked" && x.settyFee).length, 0);
});

test("phaseFeesFor matches the app's buildPhaseFees", () => {
  const page = readFileSync(join(root, "SettyPMS.html"), "utf8");
  const m = page.match(/function buildPhaseFees\(settyFee, phases\) \{[\s\S]*?\r?\n\}/);
  assert.ok(m, "buildPhaseFees not found in SettyPMS.html");
  const appFn = new Function(m[0] + "; return buildPhaseFees;")();
  const phases = project().phases.map((p, i) => (i === 2 ? { ...p, manualFee: 50000 } : i === 3 ? { ...p, billable: false } : p));
  const mine = phaseFeesFor(123456.78, phases);
  const theirs = appFn(123456.78, phases);
  theirs.forEach((t, i) => {
    assert.equal(mine[i].fee, t.fee, "fee differs at phase " + i);
    assert.equal(mine[i].calcedFee, t.calcedFee, "calcedFee differs at phase " + i);
  });
});

test("set_project_fee is registered, signed-in only, permission-gated and version-guarded", () => {
  const src = readFileSync(join(here, "index.ts"), "utf8");
  const at = src.indexOf('mcp.tool("set_project_fee"');
  assert.ok(at > 0, "tool missing");
  const body = src.slice(at, src.indexOf("\nmcp.tool(", at + 10));
  assert.ok(body.includes('c.kind !== "user" || !c.email'), "must refuse the shared-secret lane");
  assert.ok(body.includes('capFor(caps, "fees.view", pn)') && body.includes('capFor(caps, "projects.edit", pn)'), "must need fees.view AND projects.edit on the project");
  assert.ok(body.includes("updateProjectRecord(pid"), "must go through the version-guarded record write");
  assert.ok(body.includes("planFeeWrite("), "rules must come from feeCalculator.ts");
  assert.ok(!/milestones\s*:/.test(body) && !body.includes("feeScheduleFinalized: true") && !body.includes("lockedSettyFee"), "must never lock or write milestones");
});

test("the app labels the connector's audit entry instead of calling it an unlock", () => {
  const page = readFileSync(join(root, "SettyPMS.html"), "utf8");
  assert.ok(page.includes("function feeAuditLabel("), "feeAuditLabel missing");
  assert.ok(page.includes('"' + FEE_AUDIT_ACTION + '"'), "the app does not know the connector's audit action");
  assert.ok(!page.includes('e.action === "locked" ? "🔒 Locked" : "🔓 Unlocked"'), "an audit table still labels every non-lock entry as Unlocked");
});
