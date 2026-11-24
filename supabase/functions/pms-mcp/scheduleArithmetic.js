// scheduleArithmetic.js — do the numbers on an equipment schedule agree with
// each other? (tool check_schedule_arithmetic, checklist item qa-638)
//
// A QA reviewer cannot re-select every piece of equipment. What CAN be done
// for nothing is the arithmetic a schedule row already implies: heat = flow x
// temperature difference, kW = MBH / 3.412, amps = kW / volts, a breaker that
// sits between the unit's MCA and MOCP, a voltage the source panel actually
// has. The reviewer reads the rows (read_drawing_schedule) and passes the
// numbers; the sums are done here so no arithmetic is left to the model.
//
// It answers one question: is this row consistent with itself? It does not
// say the selection is right, that the product exists, or which number is the
// wrong one. A flag is a row for an engineer to look at.
//
// IP units, standard air (1.08 and 4.5), water (500). Pure.

export const ROW_KINDS = ["airHeating", "airSensibleCooling", "airTotalCooling", "hydronic", "kwMbh", "electricalLoad", "overcurrent", "voltage", "capacity"];
export const DEFAULT_TOLERANCE_PCT = 15;
const ROWS_MAX = 300;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r1 = (n) => Math.round(n * 10) / 10;
const pctDiff = (given, expected) => (expected ? r1(((given - expected) / Math.abs(expected)) * 100) : null);

// A capacity given in MBH, BTU/h or kW, as MBH.
function capacityMbh(row) {
  if (num(row.mbh) !== null) return row.mbh;
  if (num(row.btuh) !== null) return row.btuh / 1000;
  if (num(row.kw) !== null) return row.kw * 3.412;
  if (num(row.tons) !== null) return row.tons * 12;
  return null;
}

function compare(kind, id, given, expected, tol, unit, how) {
  const diffPct = pctDiff(given, expected);
  const flag = diffPct === null || Math.abs(diffPct) > tol;
  return {
    id, kind, status: flag ? "flag" : "ok", given: r1(given), expected: r1(expected), unit, diffPct,
    message: flag
      ? `Scheduled ${r1(given)} ${unit}, but ${how} gives ${r1(expected)} ${unit} (${diffPct > 0 ? "+" : ""}${diffPct}%).`
      : `Consistent: ${how} gives ${r1(expected)} ${unit}.`,
  };
}
const missing = (kind, id, need) => ({ id, kind, status: "cannot-check", message: `Not checked: the row does not give ${need}.` });

// Nominal voltages that mean the same system.
const NOMINAL = [[110, 115, 120], [200, 208], [220, 230, 240], [265, 277], [440, 460, 480], [575, 600]];
const nominalOf = (v) => { const g = NOMINAL.find((x) => x.includes(Math.round(v))); return g ? g[g.length - 1] : Math.round(v); };
// "480Y/277", "208/120V", "120/240" -> [480, 277]
export function systemVoltages(s) {
  return [...String(s == null ? "" : s).matchAll(/\d{3}/g)].map((m) => nominalOf(+m[0])).filter((v, i, a) => a.indexOf(v) === i);
}

// One row. Returns { id, kind, status: "ok" | "flag" | "cannot-check", ... }.
export function checkRow(row, tolerancePct) {
  const r = row || {};
  const id = String(r.id == null ? "" : r.id).slice(0, 80) || "(no tag)";
  const tol = num(tolerancePct) !== null ? Math.min(50, Math.max(2, tolerancePct)) : DEFAULT_TOLERANCE_PCT;
  const kind = r.kind;
  if (!ROW_KINDS.includes(kind)) return { id, kind: String(kind), status: "cannot-check", message: `Unknown kind. Use one of: ${ROW_KINDS.join(", ")}.` };

  if (kind === "airHeating" || kind === "airSensibleCooling") {
    const cap = capacityMbh(r);
    const dT = num(r.deltaTF) !== null ? Math.abs(r.deltaTF) : (num(r.eatF) !== null && num(r.latF) !== null ? Math.abs(r.latF - r.eatF) : null);
    if (num(r.cfm) === null || cap === null || dT === null) return missing(kind, id, "airflow, a capacity, and entering and leaving air temperatures");
    return compare(kind, id, cap, (1.08 * r.cfm * dT) / 1000, tol, "MBH", `1.08 x ${r.cfm} cfm x ${r1(dT)} F`);
  }
  if (kind === "airTotalCooling") {
    const cap = capacityMbh(r);
    const dH = num(r.deltaH) !== null ? Math.abs(r.deltaH) : (num(r.enteringH) !== null && num(r.leavingH) !== null ? Math.abs(r.enteringH - r.leavingH) : null);
    if (num(r.cfm) === null || cap === null || dH === null) return missing(kind, id, "airflow, a total capacity, and entering and leaving enthalpy");
    return compare(kind, id, cap, (4.5 * r.cfm * dH) / 1000, tol, "MBH", `4.5 x ${r.cfm} cfm x ${r1(dH)} Btu/lb`);
  }
  if (kind === "hydronic") {
    const cap = capacityMbh(r);
    const dT = num(r.deltaTF) !== null ? Math.abs(r.deltaTF) : (num(r.ewtF) !== null && num(r.lwtF) !== null ? Math.abs(r.ewtF - r.lwtF) : null);
    if (num(r.gpm) === null || cap === null || dT === null) return missing(kind, id, "flow, a capacity, and entering and leaving water temperatures");
    const factor = num(r.fluidFactor) !== null ? r.fluidFactor : 500;
    return compare(kind, id, cap, (factor * r.gpm * dT) / 1000, tol, "MBH", `${factor} x ${r.gpm} gpm x ${r1(dT)} F`);
  }
  if (kind === "kwMbh") {
    const mbh = num(r.mbh) !== null ? r.mbh : num(r.btuh) !== null ? r.btuh / 1000 : null;
    if (num(r.kw) === null || mbh === null) return missing(kind, id, "both kW and MBH");
    return compare(kind, id, mbh, r.kw * 3.412, Math.min(tol, 5), "MBH", `${r.kw} kW x 3.412`);
  }
  if (kind === "electricalLoad") {
    const phase = r.phase === 3 || r.phase === "3" ? 3 : r.phase === 1 || r.phase === "1" ? 1 : null;
    const kw = num(r.kw) !== null ? r.kw : num(r.kva) !== null ? r.kva : null;
    if (kw === null || num(r.volts) === null || phase === null || num(r.amps) === null) return missing(kind, id, "kW (or kVA), volts, phase and amps");
    const pf = num(r.kw) !== null ? (num(r.powerFactor) !== null ? r.powerFactor : 1) : 1;
    const expected = (kw * 1000) / (r.volts * (phase === 3 ? Math.sqrt(3) : 1) * pf);
    return compare(kind, id, r.amps, expected, tol, "A", `${kw} ${num(r.kw) !== null ? "kW" : "kVA"} at ${r.volts} V, ${phase}-phase${pf !== 1 ? ", pf " + pf : ""}`);
  }
  if (kind === "overcurrent") {
    if (num(r.breaker) === null || (num(r.mca) === null && num(r.mocp) === null)) return missing(kind, id, "the breaker size and the unit's MCA or MOCP");
    const problems = [];
    if (num(r.mca) !== null && r.breaker < r.mca) problems.push(`the ${r.breaker} A breaker is below the unit's minimum circuit ampacity of ${r.mca} A`);
    if (num(r.mocp) !== null && r.breaker > r.mocp) problems.push(`the ${r.breaker} A breaker is above the unit's maximum overcurrent protection of ${r.mocp} A`);
    if (num(r.mca) !== null && num(r.mocp) !== null && r.mca > r.mocp) problems.push(`MCA ${r.mca} A is above MOCP ${r.mocp} A, so one of them was copied wrong`);
    return problems.length
      ? { id, kind, status: "flag", message: problems.join("; ") + "." }
      : { id, kind, status: "ok", message: `The ${r.breaker} A breaker sits between MCA and MOCP.` };
  }
  if (kind === "voltage") {
    const sys = systemVoltages(r.sourceSystem);
    if (num(r.volts) === null || !sys.length) return missing(kind, id, "the equipment voltage and the source panel's system voltage");
    const eq = nominalOf(r.volts);
    const problems = [];
    if (!sys.includes(eq)) problems.push(`the equipment is ${r.volts} V and its source ${r.source ? r.source + " " : ""}is a ${r.sourceSystem} system`);
    const eqPhase = r.phase === 3 || r.phase === "3" ? 3 : r.phase === 1 || r.phase === "1" ? 1 : null;
    const srcPhase = r.sourcePhase === 3 || r.sourcePhase === "3" ? 3 : r.sourcePhase === 1 || r.sourcePhase === "1" ? 1 : null;
    if (eqPhase === 3 && srcPhase === 1) problems.push("the equipment is three-phase and its source is single-phase");
    return problems.length
      ? { id, kind, status: "flag", message: problems.join("; ") + "." }
      : { id, kind, status: "ok", message: `${r.volts} V is available from a ${r.sourceSystem} system.` };
  }
  // capacity: a count against what the thing serving it can take.
  if (num(r.count) === null || num(r.capacity) === null) return missing(kind, id, "a count and a capacity");
  const what = String(r.what || "items").slice(0, 60), of = String(r.of || "the equipment").slice(0, 80);
  return r.count > r.capacity
    ? { id, kind, status: "flag", given: r.count, expected: r.capacity, message: `${r.count} ${what} are shown and ${of} takes ${r.capacity}.` }
    : { id, kind, status: "ok", given: r.count, expected: r.capacity, message: `${r.count} ${what} fit within ${r.capacity}.` };
}

// The same model number under tags that describe different things: one of the
// rows was copied from the other and not changed.
// items: [{ tag, model, description }]
export function duplicateModels(items) {
  const byModel = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const model = String((it && it.model) || "").replace(/\s+/g, "").toUpperCase();
    if (model.length < 4 || /^(TBD|N\/?A|-+|BYOWNER|SEESPEC)$/.test(model)) continue;
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(it);
  }
  const out = [];
  for (const group of byModel.values()) {
    const kinds = new Set(group.map((g) => String(g.description || "").trim().toLowerCase()).filter(Boolean));
    if (group.length > 1 && kinds.size > 1) {
      out.push({ model: String(group[0].model).trim(), tags: group.map((g) => String(g.tag || "")), descriptions: [...kinds],
        message: `${group.map((g) => g.tag).join(" and ")} are scheduled as different things with the same model number ${String(group[0].model).trim()}.` });
    }
  }
  return out;
}

export function checkSchedule(input) {
  const rows = (Array.isArray(input && input.rows) ? input.rows : []).slice(0, ROWS_MAX);
  const results = rows.map((r) => checkRow(r, input.tolerancePct));
  const dup = duplicateModels(input && input.models);
  const count = (s) => results.filter((r) => r.status === s).length;
  return {
    checked: results.length, ok: count("ok"), flagged: count("flag") + dup.length, notChecked: count("cannot-check"),
    flags: [...results.filter((r) => r.status === "flag"), ...dup.map((d) => ({ id: d.tags.join(", "), kind: "duplicateModel", status: "flag", message: d.message }))],
    notCheckedRows: results.filter((r) => r.status === "cannot-check").map((r) => ({ id: r.id, kind: r.kind, message: r.message })),
    okRows: results.filter((r) => r.status === "ok").map((r) => ({ id: r.id, kind: r.kind, message: r.message })),
  };
}
