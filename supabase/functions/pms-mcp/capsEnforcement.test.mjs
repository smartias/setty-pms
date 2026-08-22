// Phase B capability enforcement: capFor precedence pick, fee-key detection
// boundaries, and the deep redactor.
//
// Run: node supabase/functions/pms-mcp/capsEnforcement.test.mjs
//
// The functions are COPIES (index.ts is not importable under node); a drift
// detector below compares the copies against the shipped bodies, with TS
// annotations normalised away, and fails the run if they diverge.

let failures = 0;
function check(ok, msg) {
  if (!ok) { failures++; console.error("FAIL: " + msg); }
}

// ── copies of the shipped functions ─────────────────────────────────────────

const FEE_KEY_EXACT = new Set([
  "fee", "fees", "feetype", "feestructure", "feeschedulefinalized", "feeauditlog",
  "feecalculatorsubs", "phasesubfees", "lockedsettyfee", "manualsettyfee",
  "manualconstructioncost", "manualrsmeanscostpersf", "reimbursablebudget",
  "invoices", "invoiced", "billingmethod", "hourlyrates",
  "contractrateschedule", "contractrateschedulelockedat", "ceilingvalue", "contractvalue",
]);
const FEE_KEY_PATTERN = /^fee[A-Z_]|[a-z0-9](Fee|Fees)$/;
const isFeeKey = (k) => FEE_KEY_EXACT.has(k.toLowerCase()) || FEE_KEY_PATTERN.test(k);
const FEE_REDACTED = "[redacted: requires fees.view]";
function redactFees(v) {
  if (Array.isArray(v)) return v.map(redactFees);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = isFeeKey(k) ? FEE_REDACTED : redactFees(val);
    return out;
  }
  return v;
}
function capFor(res, cap, projectNumber) {
  if (res.isAdmin) return true;
  const pn = (projectNumber ?? "").trim();
  const proj = pn ? res.projects?.[pn] : undefined;
  if (proj && typeof proj[cap] === "boolean") return proj[cap];
  return res.caps?.[cap] === true;
}

// ── capFor: verdict picking (precedence itself lives in SQL) ────────────────

const engineer = {
  email: "e@setty.com", role: "engineer", isAdmin: false,
  caps: { "projects.view": true, "fees.view": false },
  projects: { "SAPX196006.00": { "projects.view": true, "fees.view": true } },
};
check(capFor(engineer, "projects.view") === true, "firm-level allow holds with no project ref");
check(capFor(engineer, "fees.view") === false, "firm-level deny holds with no project ref");
check(capFor(engineer, "fees.view", "SAPX196006.00") === true, "per-project allow beats firm-level deny");
check(capFor(engineer, "fees.view", "SAPX999999.00") === false, "project without overrides falls back to firm verdict");
check(capFor(engineer, "nonexistent.cap") === false, "unknown capability denies");
check(capFor(engineer, "fees.view", "  ") === false, "blank project ref is treated as no ref");
check(capFor({ isAdmin: true, caps: {}, projects: {} }, "anything", "any") === true, "admin allows everything");

const denied = {
  email: "d@setty.com", role: "qaqc", isAdmin: false,
  caps: { "projects.view": true },
  projects: { "ZZTEST-000": { "projects.view": false } },
};
check(capFor(denied, "projects.view", "ZZTEST-000") === false, "per-project view deny beats firm-level allow");
check(capFor(denied, "projects.view", "SAPX196006.00") === true, "deny on one project does not leak onto others");

// ── isFeeKey: boundaries ────────────────────────────────────────────────────

for (const k of ["fee", "fees", "feeType", "feeStructure", "phaseSubFees", "lockedSettyFee",
  "manualSettyFee", "totalFee", "subFees", "ceilingValue", "invoices", "invoiced",
  "billingMethod", "hourlyRates", "contractRateSchedule", "reimbursableBudget",
  "manualConstructionCost", "fee_lines", "FEE"]) {
  check(isFeeKey(k), `fee key not detected: ${k}`);
}
for (const k of ["feedback", "coffee", "name", "status", "projectNumber", "feet",
  "safeesomething", "profeessional", "notes", "freeform"]) {
  check(!isFeeKey(k), `false positive fee key: ${k}`);
}

// ── redactFees: deep behavior ───────────────────────────────────────────────

const payload = {
  name: "Tabler Quad", projectNumber: "SAPX196006.00", feeType: "lump-sum",
  lockedSettyFee: 1234567, invoices: [{ number: "INV-1", amount: 100 }],
  milestones: [{ name: "50% CD", fee: 5000, dueDate: "2026-09-01" }],
  nested: { deep: { hourlyRates: { pm: 210 } } },
  termContracts: [{ name: "SCA Master", ceilingValue: 9999999 }],
};
const red = redactFees(payload);
check(red.name === "Tabler Quad" && red.projectNumber === "SAPX196006.00", "non-fee fields survive untouched");
check(red.feeType === FEE_REDACTED, "feeType redacted");
check(red.lockedSettyFee === FEE_REDACTED, "lockedSettyFee redacted");
check(red.invoices === FEE_REDACTED, "whole invoices array replaced, not walked");
check(red.milestones[0].fee === FEE_REDACTED && red.milestones[0].name === "50% CD", "milestone fee redacted, siblings intact");
check(red.nested.deep.hourlyRates === FEE_REDACTED, "deeply nested fee object redacted");
check(red.termContracts[0].ceilingValue === FEE_REDACTED, "ceilingValue redacted inside arrays");
check(payload.lockedSettyFee === 1234567, "input object is not mutated");
check(redactFees("plain string") === "plain string" && redactFees(null) === null, "scalars pass through");

// ── drift detection against index.ts ────────────────────────────────────────

import { readFileSync } from "node:fs";

function extractBody(src, fnName) {
  const start = src.indexOf("function " + fnName);
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}
const normalise = (body) => body
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n")
  .replace(/: ResolvedCaps/g, "").replace(/: Record<string, any>/g, "")
  .replace(/: string \| null/g, "").replace(/\?: string \| null/g, "")
  .replace(/: any\[\]/g, "").replace(/: any/g, "").replace(/: string/g, "").replace(/: boolean/g, "")
  .replace(/\s+/g, " ").trim();

const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const here = readFileSync(new URL(import.meta.url), "utf8");
for (const fn of ["redactFees", "capFor"]) {
  const a = extractBody(shipped, fn);
  const b = extractBody(here, fn);
  check(a !== null, `could not find ${fn} in index.ts — extractor needs updating`);
  check(b !== null, `could not find ${fn} in this test file — extractor needs updating`);
  check(a !== null && b !== null && normalise(a) === normalise(b),
    `${fn} has DRIFTED from index.ts. Sync the copy in this test and re-run.`);
}
// The pattern and the exact set are consts, not functions — anchor them
// literally so an edit there fails loudly here.
for (const anchor of [
  "/^fee[A-Z_]|[a-z0-9](Fee|Fees)$/",
  '"contractrateschedulelockedat", "ceilingvalue", "contractvalue",',
  '"[redacted: requires fees.view]"',
]) {
  check(shipped.includes(anchor), "fee-detection anchor missing from index.ts (drift): " + anchor);
}

console.log(failures ? `\n${failures} assertions FAILED` : "\nall assertions pass (caps enforcement)");
process.exit(failures ? 1 : 0);
