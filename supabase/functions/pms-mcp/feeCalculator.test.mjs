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
  assert.ok(page.includes('return "✎ Set via Claude";'), "the connector entry's label changed");
  assert.ok(!page.includes('e.action === "locked" ? "🔒 Locked" : "🔓 Unlocked"'), "an audit table still labels every non-lock entry as Unlocked");
});

// ── calculator inputs (1.26.0): square footage, construction cost, category ──

test("inputs alone are written, rounded, and spelled out in the audit note", async () => {
  const p = project({ squareFootage: 0, buildingCategory: "Office", manualConstructionCost: 0 });
  const r = planFeeWrite(p, { squareFootage: 45000.4, constructionCost: 18000000, buildingCategory: "university", note: "per client" }, stamp);
  assert.equal(r.ok, true);
  assert.equal(r.project.squareFootage, 45000);
  assert.equal(r.project.manualConstructionCost, 18000000);
  assert.equal(r.project.buildingCategory, "University");
  assert.equal(r.project.manualSettyFee, undefined);
  assert.equal(r.project.phases, p.phases);
  assert.deepEqual(r.summary.inputsChanged.map((c) => c.field), ["squareFootage", "constructionCost", "buildingCategory"]);
  const e = r.project.feeAuditLog.at(-1);
  assert.match(e.note, /^per client · Square footage \(blank\) → 45000 · Construction cost \(blank\) → 18000000 · Building category Office → University$/);
  assert.match(r.summary.warning, /fee the app calculates has changed/);
});

test("with a typed total, changing inputs carries no calculated-fee warning", () => {
  const r = planFeeWrite(project({ manualSettyFee: 100000 }), { squareFootage: 45000 }, stamp);
  assert.equal(r.summary.warning, undefined);
  assert.equal(r.project.manualSettyFee, 100000);
});

test("an unknown category writes nothing and returns the list", async () => {
  const { BUILDING_CATEGORIES } = await import("./feeCalculator.ts");
  const r = planFeeWrite(project(), { settyFee: 100000, buildingCategory: "Higher Ed" }, stamp);
  assert.equal(r.ok, false);
  assert.deepEqual(r.buildingCategories, BUILDING_CATEGORIES);
});

test("bad input values are refused; unchanged inputs are a no-op; a locked schedule still refuses", () => {
  assert.equal(planFeeWrite(project(), { squareFootage: 0 }, stamp).ok, false);
  assert.equal(planFeeWrite(project(), { squareFootage: 6e7 }, stamp).ok, false);
  assert.equal(planFeeWrite(project(), { constructionCost: -1 }, stamp).ok, false);
  const p = project({ squareFootage: 45000, buildingCategory: "University" });
  const same = planFeeWrite(p, { squareFootage: 45000, buildingCategory: "University" }, stamp);
  assert.equal(same.changed, false);
  assert.equal(same.project, p);
  assert.equal(planFeeWrite(project({ feeScheduleFinalized: true }), { squareFootage: 45000 }, stamp).ok, false);
});

test("the category list matches the app's cost-per-SF table", async () => {
  const { BUILDING_CATEGORIES } = await import("./feeCalculator.ts");
  const page = readFileSync(join(root, "SettyPMS.html"), "utf8");
  const m = page.match(/const RS_MEANS_COST_PER_SF = \{([\s\S]*?)\};/);
  assert.ok(m, "RS_MEANS_COST_PER_SF not found");
  assert.deepEqual(BUILDING_CATEGORIES, [...m[1].matchAll(/"([^"]+)":/g)].map((x) => x[1]));
});

// ── project type (1.26.1) ───────────────────────────────────────────────────

test("project type is matched against the app's list and written exactly", async () => {
  const { PROJECT_TYPES } = await import("./feeCalculator.ts");
  const page = readFileSync(join(root, "SettyPMS.html"), "utf8");
  const m = page.match(/const PROJECT_TYPES = \[([\s\S]*?)\];/);
  assert.ok(m, "PROJECT_TYPES not found in SettyPMS.html");
  assert.deepEqual(PROJECT_TYPES, [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));

  const p = project({ projectType: "Type II New Construction" });
  const r = planFeeWrite(p, { projectType: "type iii renovation" }, stamp);
  assert.equal(r.ok, true);
  assert.equal(r.project.projectType, "Type III Renovation");
  assert.match(r.project.feeAuditLog.at(-1).note, /Project type Type II New Construction → Type III Renovation/);
  assert.equal(planFeeWrite(p, { projectType: "Type II New Construction" }, stamp).changed, false);

  const bad = planFeeWrite(p, { squareFootage: 45000, projectType: "Higher Ed" }, stamp);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.projectTypes, PROJECT_TYPES);
});

// ── phase list (1.27.0): addPhases / removePhases ───────────────────────────

const ids = () => { let n = 0; return { ...stamp, newId: () => "new" + (++n) }; };

test("a fee with different phases reshapes the list: add, remove, set", () => {
  const p = project({ phaseSubFees: { "4": { s1: 500 }, "1": { s1: 100 } } });
  const r = planFeeWrite(p, {
    settyFee: 90000,
    addPhases: [{ code: "PRE", name: "Feasibility Study", fee: 20000, before: "SD" }],
    removePhases: ["BS", "Construction Administration", "CD"],
    phaseFees: [{ phase: "SD", fee: 30000 }, { phase: "DD", fee: 40000 }],
  }, ids());
  assert.equal(r.ok, true);
  assert.deepEqual(r.project.phases.map((x) => x.code), ["PRE", "SD", "DD"]);
  const pre = r.project.phases[0];
  assert.deepEqual(pre, { id: "new1", code: "PRE", name: "Feasibility Study", pct: 0, billable: true, fee: 0, pctComplete: 0, manualFee: 20000, startDate: null, endDate: null });
  assert.equal(r.summary.totalPhaseFee, 90000);
  assert.equal(r.summary.variance, 0);
  assert.equal(r.summary.warning, undefined);
  assert.deepEqual(r.summary.phasesRemoved.map((x) => x.code).sort(), ["BS", "CA", "CD"]);
  assert.deepEqual(r.project.phaseSubFees, { "1": { s1: 100 } });
  assert.equal(r.project.milestones, p.milestones);
  assert.match(r.project.feeAuditLog.at(-1).note, /Added phase PRE \(Feasibility Study\) · Removed phase/);
  assert.equal(p.phases.length, 5, "input mutated");
});

test("an added phase goes at the end by default", () => {
  const r = planFeeWrite(project(), { addPhases: [{ code: "CX", name: "Commissioning", fee: 9000 }] }, ids());
  assert.equal(r.project.phases.at(-1).code, "CX");
  assert.equal(r.project.phases.length, 6);
});

test("a phase with invoices, progress or % complete is not removed, and nothing else is written", () => {
  const inv = project({ invoices: [{ phase: "SD", amount: 5000 }] });
  const r1 = planFeeWrite(inv, { settyFee: 50000, removePhases: ["SD"] }, ids());
  assert.equal(r1.ok, false);
  assert.match(r1.error, /"SD" cannot be removed because an invoice is billed against it/);
  const ms = project({ milestones: [{ id: "b", type: "billable", phase: "DD", pctComplete: 40 }] });
  assert.match(planFeeWrite(ms, { removePhases: ["DD"] }, ids()).error, /milestone has progress/);
  const pc = project();
  pc.phases[2] = { ...pc.phases[2], pctComplete: 10 };
  assert.match(planFeeWrite(pc, { removePhases: ["CD"] }, ids()).error, /10% complete/);
  // a zero-progress milestone left from an earlier lock does not block
  const idle = project({ milestones: [{ id: "b", type: "billable", phase: "DD", pctComplete: 0 }] });
  assert.equal(planFeeWrite(idle, { removePhases: ["DD"] }, ids()).ok, true);
});

test("bad additions are refused", () => {
  const add = (row, extra = {}) => planFeeWrite(project(), { addPhases: [row], ...extra }, ids());
  assert.match(add({ code: "SD", name: "Study", fee: 1 }).error, /already exists/);
  assert.match(add({ code: "ST", name: "schematic design", fee: 1 }).error, /already exists/);
  assert.match(add({ code: "co", name: "Change", fee: 1 }).error, /reserved/);
  assert.match(add({ code: "TWO WORDS", name: "X", fee: 1 }).error, /not a usable phase code/);
  assert.match(add({ code: "ST", name: "", fee: 1 }).error, /needs a name/);
  assert.equal(add({ code: "ST", name: "Study", fee: 0 }).ok, false);
  assert.match(add({ code: "ST", name: "Study", fee: 1, before: "Nope" }).error, /cannot place/);
  assert.match(add({ code: "ST", name: "Study", fee: 1 }, { phaseFees: [{ phase: "ST", fee: 2 }] }).error, /being added in this call/);
  assert.match(planFeeWrite(project(), { removePhases: ["BS"], phaseFees: [{ phase: "BS", fee: 1 }] }, ids()).error, /no phase "BS"/);
  // a code freed by a removal in the same call can be reused
  assert.equal(add({ code: "BS", name: "Bidding", fee: 1 }, { removePhases: ["BS"] }).ok, true);
  assert.equal(planFeeWrite(project({ feeScheduleFinalized: true }), { removePhases: ["BS"] }, ids()).ok, false);
});

test("the tool passes the phase list changes through", () => {
  const src = readFileSync(join(here, "index.ts"), "utf8");
  const at = src.indexOf('mcp.tool("set_project_fee"');
  const body = src.slice(at, src.indexOf("\nmcp.tool(", at + 10));
  assert.ok(body.includes("addPhases, removePhases, squareFootage") && body.includes("newId: () =>"), "handler does not forward addPhases/removePhases");
});
