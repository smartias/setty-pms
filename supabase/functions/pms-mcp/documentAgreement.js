// documentAgreement.js — do the documents say the same thing about the same
// item? (tool check_document_agreement, checklist item qa-632)
//
// qa-632 asks that plan, schedule, detail and specification agree on the
// small items: circuit numbers, materials, ratings, mounting heights. The
// RFIs behind it were never subtle once two statements sat side by side: a
// detail with an aluminum jacket and a spec calling for stainless, a note
// limiting strobes to 110 cd with 177 cd devices drawn, a plan circuit the
// panel schedule gives to another room. The work is collecting the
// statements; the comparing is mechanical, so it is done here and not left
// to the model.
//
// Two inputs:
//   statements  what each document says about one attribute of one subject
//               ("outdoor duct / jacket material": detail 5/M701 says
//               aluminum, spec 233113 says stainless steel)
//   circuits    for one panel, the circuits as drawn on the plans against
//               the rows of its panel schedule
//
// It answers one question: do these statements agree? It does not say which
// document is right. A conflict is a question for the engineer. Pure.

const STATEMENTS_MAX = 600;
const PANELS_MAX = 60;
const CIRCUITS_MAX = 400;

const str = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const keyOf = (v) => str(v, 200).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const r2 = (n) => Math.round(n * 100) / 100;

// ── Materials ────────────────────────────────────────────────────────────────
// Each entry: [canonical name, pattern]. Order matters: the first match wins,
// so the specific ones (stainless) come before the general ones (steel).
const MATERIALS = [
  ["stainless steel", /\bSTAINLESS\b|\bS\.?S\.?T?\b|\b(?:TYPE\s*)?(?:304|316)L?\b/],
  ["galvanized steel", /\bGALV(?:ANIZED|ANNEALED)?\b|\bG-?(?:60|90)\b|\bGSM\b|\bG\.?I\.?\b/],
  ["aluminum", /\bALUM(?:INUM|INIUM)?\b|\bAL\b/],
  ["black steel", /\bBLACK\s+(?:STEEL|IRON)\b|\bBLK\.?\s+STL\b|\bB\.?I\.?\b/],
  ["carbon steel", /\bCARBON\s+STEEL\b|\bC\.?S\.?\b/],
  ["cast iron", /\bCAST\s+IRON\b|\bC\.?I\.?\b/],
  ["ductile iron", /\bDUCTILE\b|\bD\.?I\.?P?\b/],
  ["copper", /\bCOPPER\b|\bCU\b/],
  ["brass", /\bBRASS\b/],
  ["bronze", /\bBRONZE\b/],
  ["CPVC", /\bCPVC\b/],
  ["PVC", /\bPVC\b/],
  ["PEX", /\bPEX\b/],
  ["HDPE", /\bHDPE\b/],
  ["polypropylene", /\bPOLYPROPYLENE\b|\bPP-?R?\b/],
  ["fiberglass", /\bFIBERGLASS\b|\bFRP\b|\bFIBROUS\s+GLASS\b/],
  ["mineral wool", /\bMINERAL\s+(?:WOOL|FIBER)\b/],
  ["elastomeric", /\bELASTOMERIC\b/],
  ["polymer concrete", /\bPOLYMER\s+CONCRETE\b/],
  ["concrete", /\bCONCRETE\b/],
  ["steel", /\bSTEEL\b|\bSTL\b/],
];
// Things that are stated alongside a material and conflict on their own.
const QUALIFIERS = [
  ["double wall", /\bDOUBLE[\s-]*WALL\b|\bDW\b/], ["single wall", /\bSINGLE[\s-]*WALL\b/],
  ["lined", /\b(?:ACOUSTICAL(?:LY)?\s+)?LINED\b|\bLINING\b/], ["unlined", /\bUNLINED\b|\bNO\s+LINING\b/],
  ["flexible connection", /\bFLEX(?:IBLE)?\s+CONN(?:ECTION|ECTOR)?S?\b/], ["hard connection", /\bHARD[\s-]*(?:MOUNTED|CONNECTED|CONNECTION)\b|\bRIGID\s+CONNECTION\b/],
];
const OPPOSITES = [["double wall", "single wall"], ["lined", "unlined"], ["flexible connection", "hard connection"]];
const GRADE = /\b(304L?|316L?|G-?60|G-?90|TYPE\s*[KLM]|SCH(?:EDULE)?\.?\s*\d+)\b/;

export function readMaterial(value) {
  const s = str(value, 400).toUpperCase();
  const m = MATERIALS.find(([, re]) => re.test(s));
  const quals = QUALIFIERS.filter(([, re]) => re.test(s)).map(([name]) => name);
  const g = s.match(GRADE);
  return { material: m ? m[0] : null, grade: g ? g[1].replace(/\s+/g, " ").replace(/^SCHEDULE/, "SCH").replace("G-", "G") : null, qualifiers: quals };
}

// ── Quantities ───────────────────────────────────────────────────────────────
// A number with a unit, in a common base so 4'-0" and 48 in. compare equal.
const UNITS = [
  ["in", /^(?:"|''|IN(?:CH(?:ES)?)?\.?)$/, 1, "in"], ["ft", /^(?:'|FT\.?|FEET|FOOT)$/, 12, "in"],
  ["ga", /^(?:GA\.?|GAGE|GAUGE)$/, 1, "ga"], ["cd", /^(?:CD|CANDELA)$/, 1, "cd"],
  ["A", /^(?:A|AMP|AMPS|AMPERES?)$/, 1, "A"], ["kA", /^(?:KA|KAIC|K\s*AIC)$/, 1, "kA"],
  ["V", /^(?:V|VOLT|VOLTS)$/, 1, "V"], ["W", /^(?:W|WATT|WATTS)$/, 1, "W"],
  ["psi", /^(?:PSI|PSIG)$/, 1, "psi"], ["F", /^(?:F|°F|DEG\s*F)$/, 1, "F"],
  ["pct", /^%$/, 1, "pct"], ["mm", /^MM$/, 1 / 25.4, "in"], ["hp", /^(?:HP)$/, 1, "hp"],
  ["cfm", /^CFM$/, 1, "cfm"], ["gpm", /^GPM$/, 1, "gpm"],
];
export function readQuantity(value) {
  const s = str(value, 200).toUpperCase().replace(/A\.?F\.?F\.?|ABOVE\s+FINISHED\s+FLOOR/g, " ").replace(/^\+/, "").trim();
  // 4'-6", 4' 6", 4'-0"
  let m = s.match(/^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:"|'')?(?:\s|$)/);
  if (m) return { value: r2(+m[1] * 12 + (m[2] ? +m[2] : 0)), unit: "in" };
  // 1-1/2", 3/4"
  m = s.match(/^(?:(\d+)[\s-]+)?(\d+)\s*\/\s*(\d+)\s*(.*)$/);
  if (m && +m[3]) { const u = unitOf(m[4]); if (u) return { value: r2(((m[1] ? +m[1] : 0) + +m[2] / +m[3]) * u.factor), unit: u.base }; }
  m = s.match(/^(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(.*)$/);
  if (!m) return null;
  const u = unitOf(m[2]);
  if (!u) return null;
  return { value: r2(+m[1].replace(/,/g, "") * u.factor), unit: u.base };
}
function unitOf(rest) {
  const first = String(rest || "").trim().split(/[\s,;(]/)[0];
  const u = UNITS.find(([, re]) => re.test(first));
  return u ? { factor: u[2], base: u[3] } : null;
}

// ── Statements ───────────────────────────────────────────────────────────────
// statements: [{ subject, attribute, source, value, limit, silent }]
//   limit   "max" | "min": this statement is a limit the others must respect
//           (a note saying strobes are 110 cd maximum)
//   silent  true: this source should state it and does not (spec part 3 says
//           nothing about a coating that part 2 lists)
// Returns { groups, conflicts, notCompared }. A group is one subject+attribute.
export function compareStatements(statements) {
  const groups = new Map();
  for (const s of (Array.isArray(statements) ? statements : []).slice(0, STATEMENTS_MAX)) {
    const subject = str(s && s.subject, 160), source = str(s && s.source, 160);
    if (!subject || !source) continue;
    const attribute = str(s.attribute, 80) || "value";
    const k = keyOf(subject) + "|" + keyOf(attribute);
    if (!groups.has(k)) groups.set(k, { subject, attribute, statements: [] });
    const value = str(s.value, 300);
    const silent = s.silent === true || (!value && s.silent !== false);
    groups.get(k).statements.push({
      source, value, silent, limit: s.limit === "max" || s.limit === "min" ? s.limit : null,
      quantity: silent ? null : readQuantity(value), mat: silent ? null : readMaterial(value),
    });
  }
  const out = [];
  for (const g of groups.values()) out.push(judgeGroup(g));
  return {
    groups: out.length,
    conflicts: out.filter((g) => g.status === "conflict"),
    notCompared: out.filter((g) => g.status === "not-compared"),
    agreed: out.filter((g) => g.status === "agree").length,
  };
}

function judgeGroup(g) {
  const said = g.statements.filter((s) => !s.silent), silent = g.statements.filter((s) => s.silent);
  const base = { subject: g.subject, attribute: g.attribute, statements: g.statements.map((s) => ({ source: s.source, value: s.silent ? "(not stated)" : s.value, ...(s.limit ? { limit: s.limit } : {}) })) };
  const problems = [];
  if (silent.length && said.length) {
    problems.push(`${said.map((s) => s.source).join(" and ")} state${said.length === 1 ? "s" : ""} it; ${silent.map((s) => s.source).join(" and ")} do${silent.length === 1 ? "es" : ""} not.`);
  }
  if (said.length < 2) {
    return problems.length ? { ...base, status: "conflict", kind: "silent", message: problems.join(" ") }
      : { ...base, status: "not-compared", message: said.length ? "Only one document states it, so there is nothing to compare it with." : "No document states it." };
  }
  // Limits first: a stated maximum or minimum against every other quantity.
  const limits = said.filter((s) => s.limit && s.quantity), plain = said.filter((s) => !s.limit);
  for (const L of limits) {
    for (const s of plain) {
      if (!s.quantity || s.quantity.unit !== L.quantity.unit) continue;
      if (L.limit === "max" && s.quantity.value > L.quantity.value) problems.push(`${L.source} sets a maximum of ${L.value}; ${s.source} shows ${s.value}.`);
      if (L.limit === "min" && s.quantity.value < L.quantity.value) problems.push(`${L.source} sets a minimum of ${L.value}; ${s.source} shows ${s.value}.`);
    }
  }
  const kind = limits.length ? "limit" : plain.every((s) => s.quantity) ? "quantity" : plain.some((s) => s.mat.material || s.mat.qualifiers.length) ? "material" : "text";
  // With a limit in the group the other statements are things held to it (a
  // 15 cd and a 177 cd strobe are different devices), so they are not also
  // compared with each other.
  if (plain.length >= 2 && !limits.length) {
    if (plain.every((s) => s.quantity)) {
      const units = new Set(plain.map((s) => s.quantity.unit));
      if (units.size > 1) return { ...base, status: "not-compared", message: "The statements are in different units, so they were not compared." };
      const vals = new Set(plain.map((s) => s.quantity.value));
      if (vals.size > 1) problems.push(plain.map((s) => `${s.source}: ${s.value}`).join("; ") + ".");
    } else if (plain.some((s) => s.mat.material || s.mat.qualifiers.length)) {
      const named = plain.filter((s) => s.mat.material);
      const mats = new Set(named.map((s) => s.mat.material));
      // "steel" alone does not contradict a more specific steel.
      const specific = [...mats].filter((m) => m !== "steel");
      if (specific.length > 1 || (specific.length === 1 && mats.has("steel") && !/steel/.test(specific[0]))) {
        problems.push(named.map((s) => `${s.source}: ${s.mat.material}`).join("; ") + ".");
      } else {
        const grades = new Set(named.filter((s) => s.mat.grade).map((s) => s.mat.grade));
        if (grades.size > 1) problems.push(named.filter((s) => s.mat.grade).map((s) => `${s.source}: ${s.mat.grade}`).join("; ") + ".");
      }
      for (const [a, b] of OPPOSITES) {
        const A = plain.filter((s) => s.mat.qualifiers.includes(a)), B = plain.filter((s) => s.mat.qualifiers.includes(b));
        if (A.length && B.length) problems.push(`${A.map((s) => s.source).join(" and ")}: ${a}; ${B.map((s) => s.source).join(" and ")}: ${b}.`);
      }
      // One document names a construction (double wall, lined) the others, naming a material, leave out.
      for (const q of ["double wall", "lined"]) {
        const A = plain.filter((s) => s.mat.qualifiers.includes(q)), B = plain.filter((s) => !s.mat.qualifiers.includes(q) && s.mat.material);
        if (A.length && B.length && !problems.some((p) => p.includes(q))) problems.push(`${A.map((s) => s.source).join(" and ")} call${A.length === 1 ? "s" : ""} for ${q}; ${B.map((s) => s.source).join(" and ")} do${B.length === 1 ? "es" : ""} not mention it.`);
      }
    } else {
      const texts = new Set(plain.map((s) => keyOf(s.value)));
      if (texts.size > 1) problems.push(plain.map((s) => `${s.source}: ${s.value}`).join("; ") + ".");
    }
  }
  return problems.length ? { ...base, status: "conflict", kind, message: problems.join(" ") } : { ...base, status: "agree", kind };
}

// ── Circuits ─────────────────────────────────────────────────────────────────
// "15,17" / "14 & 16" / "55, 57, 59" / "1-5" (a range only with THRU or when
// written "1 THRU 5": a bare hyphen is a multi-pole pair, both ends only).
export function readCircuits(v) {
  if (typeof v === "number" && Number.isFinite(v)) return [String(Math.round(v))];
  const s = str(v, 120).toUpperCase().replace(/CKTS?\.?|CIRCUITS?|#/g, " ");
  const out = [];
  for (const part of s.split(/[,;&/]|\bAND\b/)) {
    const t = part.trim();
    if (!t) continue;
    const thru = t.match(/^(\d+)\s*(?:THRU|THROUGH|TO)\s*(\d+)$/);
    if (thru && +thru[2] >= +thru[1] && +thru[2] - +thru[1] <= 84) { for (let n = +thru[1]; n <= +thru[2]; n++) out.push(String(n)); continue; }
    for (const m of t.matchAll(/[A-Z]?\d+[A-Z]?/g)) out.push(m[0]);
  }
  return [...new Set(out)];
}
const SPARE = /^(?:SPARE|SPACE|SPACES|BLANK|--+|-|N\/?A|NOT\s+USED|PROVISION)?$/;
const NOISE = new Set(["RECEPTACLE", "RECEPTACLES", "RECEPT", "RECEPTS", "REC", "RECS", "RCPT", "RCPTS", "ROOM", "RM", "THE", "AND", "FOR", "IN", "AT", "OF", "TO", "DUPLEX", "QUAD", "POWER", "CIRCUIT", "CKT", "LOAD", "PANEL", "TYP", "NEW", "EXISTING"]);
const words = (v) => keyOf(v).split(" ").filter((w) => w && !NOISE.has(w));
const roomNumbers = (v) => words(v).filter((w) => /^[A-Z]?\d{3,4}[A-UX-Z]?$/.test(w));   // 105B, 307, B214; not 120V or 500W

// circuits: [{ panel, plansComplete, plan: [{ circuit, load, sheet, count }], schedule: [{ circuit, load, breaker, count }] }]
//   plansComplete  true when every plan the panel serves was read, so a
//                  scheduled circuit found on no plan is itself a finding
export function compareCircuits(panels) {
  const flags = [], notCompared = [];
  let compared = 0;
  for (const p of (Array.isArray(panels) ? panels : []).slice(0, PANELS_MAX)) {
    const panel = str(p && p.panel, 60) || "(panel not named)";
    const sched = new Map();
    for (const row of (Array.isArray(p.schedule) ? p.schedule : []).slice(0, CIRCUITS_MAX)) {
      for (const c of readCircuits(row && row.circuit)) if (!sched.has(c)) sched.set(c, { load: str(row.load, 160), breaker: str(row.breaker, 40), count: typeof row.count === "number" ? row.count : null });
    }
    if (!sched.size) { notCompared.push({ panel, message: "No panel schedule rows were passed, so the plans were not compared with it." }); continue; }
    const onPlan = new Map();
    for (const e of (Array.isArray(p.plan) ? p.plan : []).slice(0, CIRCUITS_MAX)) {
      const sheet = str(e && e.sheet, 40), load = str(e && e.load, 160);
      for (const c of readCircuits(e && e.circuit)) {
        compared++;
        if (!onPlan.has(c)) onPlan.set(c, []);
        onPlan.get(c).push({ sheet, load });
        const row = sched.get(c);
        const where = `${panel}-${c}${sheet ? " on " + sheet : ""}${load ? " (" + load + ")" : ""}`;
        if (!row) { flags.push({ panel, circuit: c, kind: "not-on-schedule", message: `${where} is drawn on the plan, but the panel schedule has no circuit ${c}.` }); continue; }
        if (SPARE.test(row.load.toUpperCase())) { flags.push({ panel, circuit: c, kind: "scheduled-as-spare", message: `${where} is drawn on the plan, but the panel schedule lists circuit ${c} as ${row.load || "blank"}.` }); continue; }
        if (load) {
          const pr = roomNumbers(load), sr = roomNumbers(row.load);
          const shared = words(load).some((w) => words(row.load).includes(w));
          if (pr.length && sr.length && !pr.some((r) => sr.includes(r))) flags.push({ panel, circuit: c, kind: "different-room", message: `${where}: the panel schedule gives circuit ${c} to "${row.load}".` });
          else if (!shared) flags.push({ panel, circuit: c, kind: "different-load", message: `${where}: the panel schedule describes circuit ${c} as "${row.load}". Confirm they are the same load.` });
        }
        if (typeof e.count === "number" && row.count !== null && e.count !== row.count) {
          flags.push({ panel, circuit: c, kind: "different-count", message: `${where}: ${e.count} drawn on the plan, ${row.count} on the panel schedule.` });
        }
      }
    }
    if (p.plansComplete === true) {
      for (const [c, row] of sched) {
        if (onPlan.has(c) || SPARE.test(row.load.toUpperCase())) continue;
        flags.push({ panel, circuit: c, kind: "not-on-plan", message: `${panel}-${c} is scheduled as "${row.load}", but no plan shows a circuit ${c} for this panel.` });
      }
    }
  }
  return { compared, flags, notCompared };
}

// Everything in one call.
export function checkAgreement(input) {
  const s = compareStatements(input && input.statements);
  const c = compareCircuits(input && input.circuits);
  return {
    statementGroups: s.groups, agreed: s.agreed, conflicts: s.conflicts, statementsNotCompared: s.notCompared,
    circuitsCompared: c.compared, circuitFlags: c.flags, circuitsNotCompared: c.notCompared,
    flagged: s.conflicts.length + c.flags.length,
  };
}
