// controlsCoverage.js — which scheduled equipment do the controls sheets
// never mention? (tool check_controls_coverage, checklist item qa-633)
//
// Input is one row per tag from pms_tag_controls_kinds: the schedule sheets,
// controls sheets and plans the tag is on, plus every short word printed on
// the controls sheets. A controls diagram usually draws one unit and calls it
// typical, so judging tag by tag would flag most of a set. The useful unit is
// the FAMILY (the tag prefix):
//
//   notMentioned   scheduled on a mechanical or plumbing schedule, drawn on a
//                  plan, and neither a tag nor the bare prefix is anywhere on
//                  a controls sheet. Either it is stand-alone (then its
//                  thermostat or switch must be on a plan) or nobody assigned
//                  it. This is what the RFIs were.
//   byTypeOnly     no tag on a controls sheet, but the prefix is printed
//                  there ("TYPICAL FCU"): covered as a type; confirm the
//                  diagram applies to every unit.
//   partlyShown    some tags of the family are on controls sheets and others
//                  are not. Often "typical of"; sometimes the odd one out
//                  (the one unit heater with no thermostat) is the finding.
//
// Things with a tag that nothing controls (grilles, drains, tanks) are left
// out by prefix; `ignore` adds to that list and `families` narrows to named
// prefixes. Every result is a question to confirm on the sheets. Pure.

// Mechanical and plumbing schedule sheets: M-601, H-003, P601, MP-601.
const MECH_SHEET = /^(?:M|H|P|MP|MH|HV|ME)[\s-]?\d/;
// Passive items: tagged and scheduled, never controlled.
export const PASSIVE = new Set([
  "RG", "SR", "SG", "EG", "TG", "RR", "ER", "SD", "CD", "LD", "RD", "ED", "TD", "FD", "AD", "OD", "CO", "FCO", "WCO", "HB", "WH",
  "G", "R", "D", "L", "LV", "ET", "AS", "BFP", "RPZ", "TR", "TP", "VB", "PRV", "WC", "LAV", "UR", "SK", "SH", "MS", "DF", "EWC", "FS",
  "F", "S", "TYPE", "NOTE", "DET", "RFI", "NEC", "NFPA", "ASHRAE", "SMACNA", "UL", "ANSI", "ASTM",
]);
const BOILERPLATE_RATIO = 0.6;
const MIN_SHEETS_FOR_RATIO = 12;

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
const nums = (list) => list.sort((a, b) => a - b);
// 1,2,3,5 -> "1 to 3, 5"
export function runs(list) {
  const n = nums([...new Set(list)]), out = [];
  for (let i = 0; i < n.length; i++) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    out.push(j > i + 1 ? `${n[i]} to ${n[j]}` : j === i + 1 ? `${n[i]}, ${n[j]}` : String(n[i]));
    i = j;
  }
  return out.join(", ");
}

// rows: [{ tag_prefix, tag_num, sched_sheets, controls_sheets, plan_sheets, sheet_count, total_sheets, controls_sheet_list, controls_words }]
// opts: { families: [...], ignore: [...] }
export function controlsCoverage(rows, opts) {
  const all = Array.isArray(rows) ? rows : [];
  const totalSheets = Number(all[0]?.total_sheets ?? 0);
  const controlsSheets = arr(all[0]?.controls_sheet_list);
  const words = new Set(arr(all[0]?.controls_words).map((w) => w.toUpperCase()));
  const only = arr(opts && opts.families).map((f) => f.toUpperCase().replace(/-.*$/, ""));
  const ignore = new Set([...PASSIVE, ...arr(opts && opts.ignore).map((f) => f.toUpperCase().replace(/-.*$/, ""))]);

  const fam = new Map();
  for (const r of all) {
    const prefix = String(r.tag_prefix || "").toUpperCase(), num = Number(r.tag_num);
    if (!prefix || !Number.isFinite(num) || ignore.has(prefix)) continue;
    if (only.length && !only.includes(prefix)) continue;
    if (totalSheets >= MIN_SHEETS_FOR_RATIO && Number(r.sheet_count ?? 0) >= totalSheets * BOILERPLATE_RATIO) continue;
    const sched = arr(r.sched_sheets).filter((s) => MECH_SHEET.test(s.toUpperCase()));
    if (!sched.length) continue;                       // only equipment on a mechanical or plumbing schedule
    const f = fam.get(prefix) || { prefix, scheduled: [], shown: [], notShown: [], onPlans: 0, schedSheets: new Set(), ctlSheets: new Set() };
    f.scheduled.push(num);
    for (const s of sched) f.schedSheets.add(s);
    const ctl = arr(r.controls_sheets);
    if (ctl.length) { f.shown.push(num); for (const s of ctl) f.ctlSheets.add(s); } else f.notShown.push(num);
    if (arr(r.plan_sheets).length) f.onPlans++;
    fam.set(prefix, f);
  }

  const notMentioned = [], byTypeOnly = [], partlyShown = [], shown = [];
  for (const f of [...fam.values()].sort((a, b) => b.scheduled.length - a.scheduled.length || a.prefix.localeCompare(b.prefix))) {
    if (!f.onPlans) continue;                          // scheduled and drawn: a model number in a schedule is neither
    const base = { family: f.prefix, scheduled: f.scheduled.length, tags: `${f.prefix}-${runs(f.scheduled)}`, scheduleSheets: [...f.schedSheets].sort() };
    if (!f.shown.length) {
      if (words.has(f.prefix)) byTypeOnly.push({ ...base, message: `No ${f.prefix} tag is on a controls sheet, but "${f.prefix}" is printed there. Confirm the diagram that names it applies to all ${f.scheduled.length}.` });
      else notMentioned.push({ ...base, message: `${f.scheduled.length} ${f.prefix} unit(s) are scheduled on ${base.scheduleSheets.join(", ")} and drawn on plans, and no controls sheet mentions ${f.prefix}. Each needs a controller named: on the BMS with a sequence, or stand-alone with its thermostat or switch on a plan.` });
    } else if (f.notShown.length) {
      partlyShown.push({ ...base, onControls: `${f.prefix}-${runs(f.shown)}`, notOnControls: `${f.prefix}-${runs(f.notShown)}`, controlsSheets: [...f.ctlSheets].sort(),
        message: `${f.prefix}-${runs(f.shown)} ${f.shown.length === 1 ? "is" : "are"} on ${[...f.ctlSheets].sort().join(", ")}; ${f.prefix}-${runs(f.notShown)} ${f.notShown.length === 1 ? "is" : "are"} not. Confirm the diagram is typical for the rest, or that each has its own control.` });
    } else shown.push(f.prefix);
  }
  return {
    sheetsRead: totalSheets, controlsSheets,
    familiesChecked: notMentioned.length + byTypeOnly.length + partlyShown.length + shown.length,
    notMentioned, byTypeOnly, partlyShown, allTagsOnControls: shown.sort(),
    flagged: notMentioned.length,
  };
}

// "BMS if applicable" and its relatives, for pms_sheet_phrase_hits (Postgres
// ARE: \y is the word boundary). A controls item that hedges is this item's
// finding, not qa-637's.
export const BMS_CONDITIONAL_PG =
  "(?:\\y(?:BMS|BAS|DDC|ATC|BUILDING\\s+(?:MANAGEMENT|AUTOMATION)\\s+SYSTEM)\\y[^.]{0,60}\\y(?:IF|WHERE|WHEN|AS)\\s+(?:APPLICABLE|AVAILABLE|PRESENT|REQUIRED|EXISTING)\\y)" +
  "|(?:\\y(?:IF|WHERE|WHEN)\\s+(?:APPLICABLE|AVAILABLE|PRESENT)\\y[^.]{0,60}\\y(?:BMS|BAS|DDC|ATC)\\y)";
