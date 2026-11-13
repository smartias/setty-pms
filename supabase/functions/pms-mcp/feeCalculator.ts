// feeCalculator.ts: the rules behind set_project_fee, the connector's write
// into the PMS Fee Calculator.
//
// The app keeps a project's fee in three layers:
//   project.manualSettyFee      the Setty fee total typed over the calculated one
//   project.phases[].manualFee  a phase fee typed over its percentage share
//   project.milestones[].fee    the Schedule tab's Fee column, filled ONLY when a
//                               person clicks "Finalize & Lock Fee Schedule"
// It also keeps the four inputs the calculator derives a fee from:
//   project.squareFootage, project.buildingCategory (sets the cost per SF),
//   project.manualConstructionCost (typed over square footage x cost per SF) and
//   project.projectType (Type I..VI, new construction or renovation: the fee
//   curve and the discipline percentages)
// This module writes the first two layers and those four inputs, nothing else. It never locks, never
// touches milestones, and refuses a locked schedule: locked fees feed invoices,
// so changing them is a person's decision made in the app (Unlock & Edit).
//
// Pure TypeScript with no Deno imports so feeCalculator.test.mjs can drive it.

export type FeePhaseInput = { phase: string; fee: number };
export type FeeWriteInput = {
  settyFee?: number; phaseFees?: FeePhaseInput[]; note?: string;
  squareFootage?: number; constructionCost?: number; buildingCategory?: string; projectType?: string;
};
export type FeeInputChange = { field: "squareFootage" | "constructionCost" | "buildingCategory" | "projectType"; from: number | string | null; to: number | string };
export type FeeWriteStamp = { user: string; date: string; id: string };

export type FeePhaseView = {
  code: string | null; name: string | null; billable: boolean;
  fee: number | null; manual: boolean;
};
export type FeeWriteSummary = {
  settyFee: number | null;
  settyFeeSource: "set by this call" | "typed in the app earlier" | "calculated by the app";
  previousSettyFeeOverride: number | null;
  phases: FeePhaseView[];
  phasesChanged: Array<{ code: string | null; name: string | null; from: number | null; to: number }>;
  totalPhaseFee: number | null;
  variance: number | null;
  inputs: { squareFootage: number | null; constructionCost: number | null; buildingCategory: string | null; projectType: string | null };
  inputsChanged: FeeInputChange[];
  warning?: string;
};
export type FeeWritePlan =
  | { ok: false; error: string; nextStep?: string; phases?: Array<{ code: string | null; name: string | null; billable: boolean }>; buildingCategories?: string[]; projectTypes?: string[] }
  | { ok: true; project: any; changed: boolean; summary: FeeWriteSummary };

// The app flags a phase total that is off from the Setty fee by 50 cents or
// more (phaseFeeOk in FeeCalculator). Same threshold here.
export const FEE_VARIANCE_TOLERANCE = 0.5;
export const FEE_MAX = 1_000_000_000;
// The audit-log action this tool writes. Every reader that derives the
// contract fee filters on action === "locked", so this entry can never be
// mistaken for a lock.
export const FEE_AUDIT_ACTION = "connector-set";

// Mirrors the keys of RS_MEANS_COST_PER_SF in SettyPMS.html (the Building
// Category dropdown). The app looks the cost per SF up by this exact string, so
// anything else would silently fall back to a default rate.
export const BUILDING_CATEGORIES = [
  "Office", "Healthcare/Clinic", "Laboratory", "K-12 School", "University",
  "Warehouse/Industrial", "Retail", "Multifamily", "Hotel", "Museum/Cultural",
  "Data Center", "Recreation/Gym", "Parking Structure", "Religious", "Government",
];
// Mirrors PROJECT_TYPES in SettyPMS.html (the Project Type dropdown). The app
// looks the discipline percentages up by this exact string.
export const PROJECT_TYPES = ["Type I", "Type II", "Type III", "Type IV", "Type V", "Type VI"]
  .flatMap((t) => [`${t} New Construction`, `${t} Renovation`]);
export const SQUARE_FOOTAGE_MAX = 50_000_000;

const INPUT_LABEL = { squareFootage: "Square footage", constructionCost: "Construction cost", buildingCategory: "Building category", projectType: "Project type" };

export const roundCents = (n: number): number => Math.round(n * 100) / 100;

function moneyError(label: string, v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return `${label} must be a number.`;
  if (v <= 0) return `${label} must be greater than 0. Clearing a typed value back to the calculated one is done in the Fee Calculator (the reset arrow beside the field).`;
  if (v > FEE_MAX) return `${label} is larger than this tool accepts.`;
  return null;
}

const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase();

// Port of buildPhaseFees (SettyPMS.html): a billable phase's fee is its typed
// manualFee when there is one, else its share of the Setty fee by percentage.
export function phaseFeesFor(settyFee: number, phases: any[]): Array<{ fee: number; calcedFee: number }> {
  const total = phases.filter((p) => p?.billable).reduce((a, p) => a + (+p.pct || 0), 0);
  return phases.map((p) => {
    const calcedFee = p?.billable && total > 0 ? settyFee * ((+p.pct || 0) / total) : 0;
    const fee = p?.billable && +p.manualFee > 0 ? +p.manualFee : calcedFee;
    return { fee, calcedFee };
  });
}

const phaseLabel = (p: any) => ({ code: p?.code ?? null, name: p?.name ?? null, billable: !!p?.billable });

// Find the one phase a caller means. Code first (SD, DD, CD), then the phase
// name; both exact, ignoring case. Two phases answering to the same reference
// is an error, never a guess.
function matchPhase(phases: any[], ref: string): { idx: number } | { error: string } {
  const want = norm(ref);
  if (!want) return { error: "a phase reference is empty" };
  let hits = phases.map((p, i) => (norm(p?.code) === want ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) hits = phases.map((p, i) => (norm(p?.name) === want ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) return { error: `no phase "${ref}" on this project` };
  if (hits.length > 1) return { error: `"${ref}" matches ${hits.length} phases; use the one that is unique (code or full name)` };
  return { idx: hits[0] };
}

export function planFeeWrite(proj: any, input: FeeWriteInput, stamp: FeeWriteStamp): FeeWritePlan {
  const phases: any[] = Array.isArray(proj?.phases) ? proj.phases : [];
  const wantTotal = input.settyFee !== undefined && input.settyFee !== null;
  const wantPhases = Array.isArray(input.phaseFees) && input.phaseFees.length > 0;

  if (proj?.feeScheduleFinalized) {
    return {
      ok: false,
      error: "The fee schedule on this project is locked (finalized). Nothing was written.",
      nextStep: "A person unlocks it in the PMS: Fee Calculator, 'Unlock & Edit'. Then run this again. Fees added after signing usually belong on the Change Orders tab instead.",
    };
  }
  const wantSf = input.squareFootage !== undefined && input.squareFootage !== null;
  const wantCost = input.constructionCost !== undefined && input.constructionCost !== null;
  const wantCat = input.buildingCategory !== undefined && input.buildingCategory !== null;
  const wantType = input.projectType !== undefined && input.projectType !== null;
  if (!wantTotal && !wantPhases && !wantSf && !wantCost && !wantCat && !wantType) {
    return { ok: false, error: "Nothing to write: pass at least one of settyFee, phaseFees, squareFootage, constructionCost, buildingCategory, projectType." };
  }
  let nextType: string | null = null;
  if (wantType) {
    nextType = PROJECT_TYPES.find((t) => norm(t) === norm(input.projectType)) ?? null;
    if (!nextType) {
      return {
        ok: false,
        error: `Nothing was written: "${input.projectType}" is not a project type in the Fee Calculator.`,
        nextStep: "Project type is the firm's fee classification (Type I to Type VI) plus New Construction or Renovation, e.g. 'Type II Renovation'. It is not the kind of building (that is buildingCategory). If the user has not said which Type applies, ask them; do not guess the tier.",
        projectTypes: PROJECT_TYPES,
      };
    }
  }
  if (wantSf) {
    const bad = moneyError("squareFootage", input.squareFootage);
    if (bad) return { ok: false, error: bad };
    if (input.squareFootage! > SQUARE_FOOTAGE_MAX) return { ok: false, error: "squareFootage is larger than this tool accepts." };
  }
  if (wantCost) {
    const bad = moneyError("constructionCost", input.constructionCost);
    if (bad) return { ok: false, error: bad };
  }
  let nextCat: string | null = null;
  if (wantCat) {
    nextCat = BUILDING_CATEGORIES.find((c) => norm(c) === norm(input.buildingCategory)) ?? null;
    if (!nextCat) {
      return {
        ok: false,
        error: `Nothing was written: "${input.buildingCategory}" is not a building category in the Fee Calculator.`,
        nextStep: "Pick the closest one from buildingCategories (a college or university building is 'University'). If none clearly fits, ask the user.",
        buildingCategories: BUILDING_CATEGORIES,
      };
    }
  }
  if (wantTotal) {
    const bad = moneyError("settyFee", input.settyFee);
    if (bad) return { ok: false, error: bad };
  }

  // Resolve every phase before changing anything, so a bad reference in a
  // list of five writes none of them.
  const targets = new Map<number, number>();
  if (wantPhases) {
    if (!phases.length) return { ok: false, error: "This project has no phases in the Fee Calculator, so there is nothing to put a phase fee on. Pass settyFee alone, or add the phases in the PMS first." };
    const problems: string[] = [];
    for (const row of input.phaseFees!) {
      const bad = moneyError(`The fee for "${row?.phase}"`, row?.fee);
      if (bad) { problems.push(bad); continue; }
      const m = matchPhase(phases, row.phase);
      if ("error" in m) { problems.push(m.error); continue; }
      if (!phases[m.idx]?.billable) { problems.push(`"${row.phase}" is not a billable phase, so the app ignores a fee typed on it`); continue; }
      if (targets.has(m.idx)) { problems.push(`"${row.phase}" is listed twice`); continue; }
      targets.set(m.idx, roundCents(row.fee));
    }
    if (problems.length) {
      return { ok: false, error: "Nothing was written: " + problems.join("; ") + ".", phases: phases.map(phaseLabel) };
    }
  }

  const prevTotal = +proj?.manualSettyFee > 0 ? +proj.manualSettyFee : null;
  const nextTotal = wantTotal ? roundCents(input.settyFee!) : prevTotal;

  const phasesChanged: FeeWriteSummary["phasesChanged"] = [];
  const nextPhases = phases.map((p, i) => {
    if (!targets.has(i)) return p;
    const to = targets.get(i)!;
    const from = +p?.manualFee > 0 ? +p.manualFee : null;
    if (from === to) return p;
    phasesChanged.push({ code: p?.code ?? null, name: p?.name ?? null, from, to });
    return { ...p, manualFee: to };
  });
  const totalChanged = wantTotal && nextTotal !== prevTotal;

  // The calculator inputs. A whole number of square feet; dollars to the cent.
  const prevSf = +proj?.squareFootage > 0 ? +proj.squareFootage : null;
  const prevCost = +proj?.manualConstructionCost > 0 ? +proj.manualConstructionCost : null;
  const prevCat = typeof proj?.buildingCategory === "string" && proj.buildingCategory ? proj.buildingCategory : null;
  const nextSf = wantSf ? Math.round(input.squareFootage!) : prevSf;
  const nextCost = wantCost ? roundCents(input.constructionCost!) : prevCost;
  const finalCat = wantCat ? nextCat : prevCat;
  const prevType = typeof proj?.projectType === "string" && proj.projectType ? proj.projectType : null;
  const finalType = wantType ? nextType : prevType;
  const inputsChanged: FeeInputChange[] = [];
  if (wantSf && nextSf !== prevSf) inputsChanged.push({ field: "squareFootage", from: prevSf, to: nextSf! });
  if (wantCost && nextCost !== prevCost) inputsChanged.push({ field: "constructionCost", from: prevCost, to: nextCost! });
  if (wantCat && finalCat !== prevCat) inputsChanged.push({ field: "buildingCategory", from: prevCat, to: finalCat! });
  if (wantType && finalType !== prevType) inputsChanged.push({ field: "projectType", from: prevType, to: finalType! });

  const changed = totalChanged || phasesChanged.length > 0 || inputsChanged.length > 0;

  // What the Fee Calculator will show. With no typed total the Setty fee is
  // computed in the app from construction cost and discipline percentages,
  // which the connector does not reproduce, so only typed phase fees are known.
  const computed = nextTotal !== null ? phaseFeesFor(nextTotal, nextPhases) : null;
  const view: FeePhaseView[] = nextPhases.map((p, i) => {
    const manual = !!p?.billable && +p?.manualFee > 0;
    return {
      ...phaseLabel(p),
      fee: computed ? roundCents(computed[i].fee) : manual ? +p.manualFee : null,
      manual,
    };
  });
  const totalPhaseFee = computed
    ? roundCents(computed.reduce((a, c, i) => a + (nextPhases[i]?.billable ? c.fee : 0), 0))
    : null;
  const variance = totalPhaseFee !== null && nextTotal !== null && phases.some((p) => p?.billable)
    ? roundCents(totalPhaseFee - nextTotal) : null;

  const summary: FeeWriteSummary = {
    settyFee: nextTotal,
    settyFeeSource: wantTotal ? "set by this call" : prevTotal !== null ? "typed in the app earlier" : "calculated by the app",
    previousSettyFeeOverride: prevTotal,
    phases: view,
    phasesChanged,
    totalPhaseFee,
    variance,
    inputs: { squareFootage: nextSf, constructionCost: nextCost, buildingCategory: finalCat, projectType: finalType },
    inputsChanged,
  };
  if (variance !== null && Math.abs(variance) >= FEE_VARIANCE_TOLERANCE) {
    summary.warning =
      `The phase fees add up to ${totalPhaseFee}, which is ${variance > 0 ? "over" : "under"} the Setty fee of ${nextTotal} by ${Math.abs(variance)}. ` +
      "The Fee Calculator will show the same mismatch. Tell the user and fix the total or the phase fees before anyone locks the schedule.";
  } else if (nextTotal === null && wantPhases) {
    summary.warning =
      "No Setty fee total is typed on this project, so the app is still calculating the total from construction cost. " +
      "The phase fees were written, but they may not add up to that calculated total. Pass settyFee too if the user gave one.";
  }

  if (inputsChanged.length && nextTotal === null) {
    summary.warning = (summary.warning ? summary.warning + " " : "") +
      "No Setty fee total is typed on this project, so the fee the app calculates has changed with these inputs. " +
      "The connector cannot reproduce that calculation: the user sees the new fee in the Fee Calculator.";
  }

  if (!changed) return { ok: true, project: proj, changed: false, summary };

  const entry = {
    id: stamp.id,
    action: FEE_AUDIT_ACTION,
    user: stamp.user,
    date: stamp.date,
    via: "pms-mcp",
    // The audit table shows fee columns and this note, so input changes are
    // spelled out here or nobody reading the log would see them.
    note: [String(input.note ?? "").trim(), ...inputsChanged.map((c) => `${INPUT_LABEL[c.field]} ${c.from ?? "(blank)"} → ${c.to}`)].filter(Boolean).join(" · "),
    ...(nextTotal !== null ? { settyFee: nextTotal } : {}),
    ...(totalPhaseFee !== null ? { totalPhaseFee } : {}),
    changes: {
      ...(totalChanged ? { settyFee: { from: prevTotal, to: nextTotal } } : {}),
      ...(phasesChanged.length ? { phases: phasesChanged } : {}),
      ...(inputsChanged.length ? { inputs: inputsChanged } : {}),
    },
  };
  const project = {
    ...proj,
    ...(totalChanged ? { manualSettyFee: nextTotal } : {}),
    ...(phasesChanged.length ? { phases: nextPhases } : {}),
    ...(inputsChanged.some((c) => c.field === "squareFootage") ? { squareFootage: nextSf } : {}),
    ...(inputsChanged.some((c) => c.field === "constructionCost") ? { manualConstructionCost: nextCost } : {}),
    ...(inputsChanged.some((c) => c.field === "buildingCategory") ? { buildingCategory: finalCat } : {}),
    ...(inputsChanged.some((c) => c.field === "projectType") ? { projectType: finalType } : {}),
    feeAuditLog: [...(Array.isArray(proj?.feeAuditLog) ? proj.feeAuditLog : []), entry],
  };
  return { ok: true, project, changed: true, summary };
}
