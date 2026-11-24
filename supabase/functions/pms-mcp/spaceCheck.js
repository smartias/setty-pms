// spaceCheck.js — does it fit? (tool check_space_fit, checklist items qa-614
// and qa-070)
//
// The largest group of preventable RFIs in the log is "ceiling space, chases
// and access" (qa-614). Read one by one, about a third of them need a person
// to judge a congested route. The rest are sums nobody did: a ceiling drawn
// higher than the duct, pipe and light under the beam allow; a closet too
// shallow for the equipment and its working space; a shaft narrower than the
// risers in it. The reviewer reads the dimensions off the sheets and passes
// them; the sums are done here so no arithmetic, and no feet-and-inches
// conversion, is left to the model.
//
// Three kinds:
//   plenum        the space between a ceiling and the structure above it,
//                 against what is drawn stacked in it at that spot
//   fit           one dimension of a room, closet, shaft, pit or corridor
//                 (its width) against the things that have to sit side by
//                 side along it
//   workingSpace  the clear space in front of electrical equipment against
//                 the NEC 110.26(A) minimums
//
// It answers "do these numbers fit?". It does not find the tight spots (the
// reviewer chooses the locations), does not know what else is in the space
// that was not passed, and does not replace a section through the spot.
//
// Dimensions are inches, or a string as drawn: 9'-6", 9'-6 1/2", 114", 9.5'.
// Pure.

export const SPACE_KINDS = ["plenum", "fit", "workingSpace"];
export const DEFAULT_TIGHT_IN = 2;
const ROWS_MAX = 300;
const PARTS_MAX = 30;

const r1 = (n) => Math.round(n * 10) / 10;

// A dimension as inches. A number is inches already. Returns null when the
// value cannot be read, never a guess.
export function toInches(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  let s = v.toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/''/g, '"');
  s = s.replace(/\b(a\.?f\.?f\.?|above finished floor|clear|min\.?|minimum)\b/g, " ");
  s = s.replace(/\s*(feet|foot|ft)\.?/g, "'").replace(/\s*(inches|inch|in)\.?/g, '"').replace(/\s+/g, " ").trim();
  if (!s || !/\d/.test(s)) return null;
  const m = /^(?:(\d+(?:\.\d+)?)')?[\s-]*(?:(\d+(?:\.\d+)?)(?![\d/]))?[\s-]*(?:(\d+)\/(\d+))?\s*"?$/.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  if (m[3] !== undefined && !+m[4]) return null;
  return (m[1] ? +m[1] * 12 : 0) + (m[2] ? +m[2] : 0) + (m[3] !== undefined ? +m[3] / +m[4] : 0);
}

// 114 -> 9'-6", 20.5 -> 1'-8.5"
export function feetInches(inches) {
  const total = r1(Math.abs(inches));
  const ft = Math.floor(total / 12);
  const rest = r1(total - ft * 12);
  return `${inches < 0 ? "-" : ""}${ft}'-${rest}"`;
}
const inch = (n) => `${r1(n)} in.`;

const label = (s, fallback) => String(s == null || s === "" ? fallback : s).slice(0, 80);
const cannot = (id, kind, message) => ({ id, kind, status: "cannot-check", message });

// Parts that add up along one direction. Each: { what, size | depth,
// insulation (thickness, counted on both sides), slopeInPerFt + runFt (the
// drop of a sloped pipe over its run) }.
function sumParts(list) {
  const parts = (Array.isArray(list) ? list : []).slice(0, PARTS_MAX);
  if (!parts.length) return { error: "nothing was passed to add up" };
  const out = [];
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] || {};
    const what = label(p.what, `item ${i + 1}`);
    const size = toInches(p.size != null ? p.size : p.depth);
    if (size === null) return { error: `the size of ${what} could not be read` };
    let each = size;
    const bits = [inch(size)];
    if (p.insulation != null) {
      const ins = toInches(p.insulation);
      if (ins === null) return { error: `the insulation thickness on ${what} could not be read` };
      each += 2 * ins;
      bits.push(`2 x ${inch(ins)} insulation`);
    }
    if (p.slopeInPerFt != null || p.runFt != null) {
      const slope = typeof p.slopeInPerFt === "number" && p.slopeInPerFt >= 0 ? p.slopeInPerFt : null;
      const run = typeof p.runFt === "number" && p.runFt >= 0 ? p.runFt : null;
      if (slope === null || run === null) return { error: `${what} needs both its slope (in. per ft) and its run (ft)` };
      each += slope * run;
      bits.push(`${inch(slope * run)} of fall over ${r1(run)} ft`);
    }
    total += each;
    out.push({ what, inches: r1(each), ...(bits.length > 1 ? { from: bits.join(" + ") } : {}) });
  }
  return { parts: out, total };
}

const tightOf = (row, tightIn) => {
  const t = toInches(row.tightIn != null ? row.tightIn : tightIn);
  return t === null ? DEFAULT_TIGHT_IN : Math.min(24, t);
};

function verdict(id, kind, available, needed, tight, where, extra) {
  const margin = r1(available - needed);
  const status = margin < 0 ? "flag" : margin < tight ? "tight" : "ok";
  const sums = `${where} has ${inch(available)} (${feetInches(available)}) and what is drawn needs ${inch(needed)}`;
  const message =
    status === "flag" ? `Does not fit: ${sums}, ${inch(-margin)} short.`
      : status === "tight" ? `Tight: ${sums}, leaving ${inch(margin)}. Nothing is left for hangers, supports or tolerance.`
        : `Fits: ${sums}, leaving ${inch(margin)}.`;
  return { id, kind, status, availableIn: r1(available), neededIn: r1(needed), marginIn: margin, message, ...extra };
}

// The plenum at one spot. Available comes from, in order: `plenum` when a
// section dimensions it; `structureBottomAff` (underside of the beam, duct
// bank or slab above the floor) minus `ceilingHeight`; or `floorToFloor`
// minus `structureDepth` (slab and beam together) minus `ceilingHeight`.
// `beamDepth` is taken off the last two; without it (and without `noBeam`)
// a row that fits is marked toDeckOnly.
function checkPlenum(row, id, tightIn) {
  const kind = "plenum";
  const given = (k) => row[k] != null && row[k] !== "";
  const read = {};
  for (const k of ["plenum", "structureBottomAff", "floorToFloor", "structureDepth", "ceilingHeight", "allowance", "beamDepth"]) {
    if (!given(k)) continue;
    read[k] = toInches(row[k]);
    if (read[k] === null) return cannot(id, kind, `Not checked: ${k} ("${String(row[k]).slice(0, 30)}") could not be read as a dimension.`);
  }
  let available, how;
  if (read.plenum != null) {
    available = read.plenum; how = "the plenum dimensioned on the section";
  } else if (read.structureBottomAff != null && read.ceilingHeight != null) {
    available = read.structureBottomAff - read.ceilingHeight;
    how = `underside of structure at ${feetInches(read.structureBottomAff)} less the ceiling at ${feetInches(read.ceilingHeight)}`;
  } else if (read.floorToFloor != null && read.structureDepth != null && read.ceilingHeight != null) {
    available = read.floorToFloor - read.structureDepth - read.ceilingHeight;
    how = `${feetInches(read.floorToFloor)} floor to floor less ${inch(read.structureDepth)} of structure less the ceiling at ${feetInches(read.ceilingHeight)}`;
  } else {
    const lacks = read.ceilingHeight == null ? "the ceiling height"
      : read.floorToFloor == null && read.structureBottomAff == null ? "the floor-to-floor height or the underside of structure"
        : "the structure depth";
    return cannot(id, kind, `Not checked: the row does not give ${lacks}.`);
  }
  // A beam, girder or joist that crosses below the deck at this spot. The
  // elevations on an RCP or wall section usually stop at the deck or plank,
  // so without this the sum is to the deck only, and a pass is not a pass
  // where steel crosses. A dimensioned `plenum` is taken as already clear.
  let toDeckOnly = false;
  if (read.plenum == null) {
    if (read.beamDepth != null) {
      available -= read.beamDepth;
      if (read.beamDepth > 0) how += ` less a ${inch(read.beamDepth)} beam below it`;
    } else if (row.noBeam !== true) toDeckOnly = true;
  }
  const sum = sumParts(row.stack);
  if (sum.error) return cannot(id, kind, `Not checked: ${sum.error}.`);
  if (available <= 0) {
    return { id, kind, status: "flag", availableIn: r1(available), neededIn: r1(sum.total), marginIn: r1(available - sum.total),
      message: `The numbers leave no plenum at all (${how} is ${inch(available)}). Check they were read from the right place before anything else.`, availableFrom: how, stack: sum.parts };
  }
  const needed = sum.total + (read.allowance || 0);
  const extra = { availableFrom: how, stack: sum.parts, ...(read.allowance ? { allowanceIn: r1(read.allowance) } : {}) };
  const v = verdict(id, kind, available, needed, tightOf(row, tightIn), "the plenum", extra);
  if (v.status === "flag" && read.ceilingHeight != null) {
    v.ceilingToFit = feetInches(read.ceilingHeight + (available - needed));
    v.message += ` As drawn it would take a ceiling at ${v.ceilingToFit}, not ${feetInches(read.ceilingHeight)}.`;
  }
  if (toDeckOnly) {
    v.toDeckOnly = true;
    if (v.status !== "flag") v.message += " Measured to the underside of the deck or slab only: no beam depth was given, so this is not a pass where a beam crosses. Pass beamDepth, or noBeam when the framing plan shows none.";
  }
  return v;
}

// One dimension of a room, closet, shaft or pit against what sits along it.
function checkFit(row, id, tightIn) {
  const kind = "fit";
  if (row.available == null || row.available === "") return cannot(id, kind, "Not checked: the row does not give the dimension available.");
  const available = toInches(row.available);
  if (available === null) return cannot(id, kind, `Not checked: available ("${String(row.available).slice(0, 30)}") could not be read as a dimension.`);
  const sum = sumParts(row.parts);
  if (sum.error) return cannot(id, kind, `Not checked: ${sum.error}.`);
  return verdict(id, kind, available, sum.total, tightOf(row, tightIn), label(row.of, "the space"), { parts: sum.parts });
}

// NEC 110.26(A)(1): depth of working space by nominal voltage to ground and
// condition 1, 2 or 3. Inches.
const DEPTH_TABLE = [
  { max: 150, depth: [36, 36, 36], band: "0 to 150 V to ground" },
  { max: 600, depth: [36, 42, 48], band: "151 to 600 V to ground" },
  { max: 1000, depth: [36, 48, 60], band: "601 to 1000 V to ground" },
];
const MIN_WIDTH_IN = 30;
const MIN_HEADROOM_IN = 78;

// "480Y/277" -> 277, "208/120V" -> 120, "240" -> 240
export function voltsToGroundOf(system) {
  const n = [...String(system == null ? "" : system).matchAll(/\d{3,4}/g)].map((m) => +m[0]);
  return n.length ? Math.min(...n) : null;
}

function checkWorkingSpace(row, id) {
  const kind = "workingSpace";
  const dims = {};
  for (const k of ["depth", "width", "equipmentWidth", "headroom", "equipmentHeight"]) {
    if (row[k] == null || row[k] === "") continue;
    dims[k] = toInches(row[k]);
    if (dims[k] === null) return cannot(id, kind, `Not checked: ${k} ("${String(row[k]).slice(0, 30)}") could not be read as a dimension.`);
  }
  if (dims.depth == null && dims.width == null && dims.headroom == null) {
    return cannot(id, kind, "Not checked: the row gives no clear depth, width or headroom in front of the equipment.");
  }
  const problems = [], passed = [], open = [];
  if (dims.depth != null) {
    const vg = typeof row.voltsToGround === "number" && row.voltsToGround > 0 ? row.voltsToGround : voltsToGroundOf(row.system);
    const band = vg === null ? null : DEPTH_TABLE.find((b) => vg <= b.max);
    const cond = [1, 2, 3].includes(+row.condition) ? +row.condition : null;
    if (vg === null) open.push("the depth was not checked: no voltage to ground or system voltage was given");
    else if (!band) open.push(`the depth was not checked: ${vg} V to ground is above 1000 V, where NEC 110.34 applies instead`);
    else if (cond !== null) {
      const need = band.depth[cond - 1];
      if (dims.depth < need) problems.push(`the clear depth is ${inch(dims.depth)} and ${band.band}, condition ${cond}, needs ${inch(need)} (${feetInches(need)})`);
      else passed.push(`depth ${inch(dims.depth)} against ${inch(need)} (${band.band}, condition ${cond})`);
    } else if (dims.depth < band.depth[0]) {
      problems.push(`the clear depth is ${inch(dims.depth)} and ${band.band} needs at least ${inch(band.depth[0])} under any condition`);
    } else if (dims.depth >= band.depth[2]) {
      passed.push(`depth ${inch(dims.depth)} meets ${inch(band.depth[2])}, the most any condition asks at ${band.band}`);
    } else {
      open.push(`the depth of ${inch(dims.depth)} depends on the condition: ${band.band} needs ${band.depth.map((d, i) => `${inch(d)} for condition ${i + 1}`).join(", ")}. Say what faces the equipment (1: nothing live or grounded; 2: a grounded surface such as concrete or masonry; 3: other live equipment)`);
    }
  }
  if (dims.width != null) {
    const need = Math.max(MIN_WIDTH_IN, dims.equipmentWidth || 0);
    if (dims.width < need) problems.push(`the clear width is ${inch(dims.width)} and needs ${inch(need)} (30 in. or the width of the equipment, whichever is more)`);
    else passed.push(`width ${inch(dims.width)} against ${inch(need)}`);
  }
  if (dims.headroom != null) {
    const need = Math.max(MIN_HEADROOM_IN, dims.equipmentHeight || 0);
    if (dims.headroom < need) problems.push(`the headroom is ${inch(dims.headroom)} and needs ${inch(need)} (6'-6" or the height of the equipment, whichever is more)`);
    else passed.push(`headroom ${inch(dims.headroom)} against ${inch(need)}`);
  }
  const sentence = (a) => { const s = a.join("; "); return s.charAt(0).toUpperCase() + s.slice(1) + "."; };
  if (problems.length) return { id, kind, status: "flag", message: sentence(problems) + (open.length ? " Also: " + open.join("; ") + "." : "") };
  if (open.length) return { id, kind, status: "cannot-check", message: sentence(open) + (passed.length ? " Checked and met: " + passed.join("; ") + "." : "") };
  return { id, kind, status: "ok", message: "Meets the NEC 110.26(A) minimum: " + passed.join("; ") + "." };
}

// One row. Returns { id, kind, status: "ok" | "tight" | "flag" | "cannot-check", ... }.
export function checkSpaceRow(row, tightIn) {
  const r = row || {};
  const id = String(r.id == null ? "" : r.id).slice(0, 120) || "(no location)";
  const out = r.kind === "plenum" ? checkPlenum(r, id, tightIn)
    : r.kind === "fit" ? checkFit(r, id, tightIn)
      : r.kind === "workingSpace" ? checkWorkingSpace(r, id)
        : cannot(id, String(r.kind), `Unknown kind. Use one of: ${SPACE_KINDS.join(", ")}.`);
  // "12 in." at the end of a sentence would otherwise read "12 in..".
  out.message = out.message.replace(/\bin\.\./g, "in.");
  return out;
}

export function checkSpace(input) {
  const rows = (Array.isArray(input && input.rows) ? input.rows : []).slice(0, ROWS_MAX);
  const results = rows.map((r) => checkSpaceRow(r, input.tightIn));
  const of = (s) => results.filter((r) => r.status === s);
  return {
    checked: results.length, ok: of("ok").length, tight: of("tight").length, flagged: of("flag").length, notChecked: of("cannot-check").length,
    // Plenum rows that passed without a beam depth: reported, not counted as clean.
    toDeckOnly: results.filter((r) => r.toDeckOnly && r.status !== "flag").length,
    flags: of("flag"),
    tightRows: of("tight"),
    notCheckedRows: of("cannot-check").map((r) => ({ id: r.id, kind: r.kind, message: r.message })),
    okRows: of("ok").map((r) => ({ id: r.id, kind: r.kind, message: r.message, ...(r.toDeckOnly ? { toDeckOnly: true } : {}) })),
  };
}
