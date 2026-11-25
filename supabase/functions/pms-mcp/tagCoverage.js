// tagCoverage.js — is every tag on the plans scheduled, and every scheduled
// tag drawn? (tool check_tag_schedule_coverage, checklist item qa-622)
//
// Input is one row per tag from pms_tag_sheet_kinds: the sheets the tag is
// on, split into schedule sheets, plans and other sheets (details, risers).
// The text of a drawing is full of things shaped like a tag that are not
// equipment: sheet references (M-601), code sections (NEC-110), model numbers
// in a schedule (GBSF-025), RFI numbers in a revision cloud. So a tag is only
// judged inside a FAMILY that the set itself shows to be equipment: a prefix
// with at least one member that is both scheduled and drawn on a plan.
//
//   notScheduled        on a plan, not on any schedule sheet, in a family
//                       whose other members are scheduled        (strong)
//   notOnPlans          on a schedule sheet, on no plan, in a family whose
//                       other members are on plans               (strong)
//   familiesNotScheduled  a prefix on two or more plan sheets with no member
//                       on any schedule sheet: the schedule may be missing,
//                       or it is not equipment            (for the reviewer)
//
// Every result is a question to confirm on the sheet. Pure.

// Discipline letter(s) and exactly three digits is a sheet number.
const SHEETLIKE = /^(A|AD|C|E|EL|ES|FA|FP|G|H|I|L|M|MD|P|PD|S|SP|T|TS)$/;
// Codes, standards and document references that are written like a tag.
const NOT_EQUIPMENT = new Set(["NEC", "NFPA", "ASTM", "ANSI", "ASME", "UL", "IBC", "IMC", "IPC", "IECC", "IFC", "ADA", "ASHRAE", "SMACNA", "NEMA", "IEEE", "AWWA", "CSA", "ISO", "RFI", "ASI", "PCO", "PLAN", "ZONE", "AREA", "TYPE", "NOTE", "DETAIL", "DET", "SECT", "PHASE", "REV", "ADD", "BULL", "PART", "DIV", "FIG", "NO", "SK", "ALT", "OPT", "ITEM", "ROOM", "RM", "LEVEL", "GRID", "COL", "DWG", "SHT", "SIM", "TYP", "MIN", "MAX", "AWG", "MCM", "PVC", "EMT", "RGS", "IMC", "SCH", "CAT", "USB", "GFI", "GFCI", "AFF"]);
const BOILERPLATE_RATIO = 0.6;
const MIN_SHEETS_FOR_RATIO = 12;
const LIST_MAX = 120;

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
const tagOf = (r) => `${r.tag_prefix}-${r.tag_num}`;

// rows: [{ tag_prefix, tag_num, spellings, sched_sheets, plan_sheets, other_sheets, sheet_count, total_sheets, schedule_sheet_list, plan_sheet_count }]
// opts: { families: ["UH", "EF"] to look at only those prefixes }
export function tagCoverage(rows, opts) {
  const all = Array.isArray(rows) ? rows : [];
  const totalSheets = Number(all[0]?.total_sheets ?? 0);
  const scheduleSheets = arr(all[0]?.schedule_sheet_list);
  const planSheetCount = Number(all[0]?.plan_sheet_count ?? 0);
  const only = arr(opts && opts.families).map((f) => f.toUpperCase().replace(/-.*$/, ""));

  const tags = [];
  for (const r of all) {
    const prefix = String(r.tag_prefix || "").toUpperCase(), num = Number(r.tag_num);
    if (!prefix || !Number.isFinite(num)) continue;
    if (NOT_EQUIPMENT.has(prefix)) continue;
    const sched = arr(r.sched_sheets), plans = arr(r.plan_sheets), other = arr(r.other_sheets);
    // The sheet lists are capped by the database function; sheet_count is not.
    const sheets = Math.max(Number(r.sheet_count ?? 0), new Set([...sched, ...plans, ...other]).size);
    // A sheet number, when it is spelled with three digits: M-601 is a sheet, M-6 may be a tag.
    if (SHEETLIKE.test(prefix) && arr(r.spellings).every((s) => /-\d{3}$/.test(s))) continue;
    // On most of the set: title-block text, not equipment.
    if (totalSheets >= MIN_SHEETS_FOR_RATIO && sheets >= totalSheets * BOILERPLATE_RATIO) continue;
    if (only.length && !only.includes(prefix)) continue;
    tags.push({ prefix, num, tag: tagOf({ tag_prefix: prefix, tag_num: num }), spellings: arr(r.spellings), sched, plans, other });
  }

  const fam = new Map();
  for (const t of tags) {
    const f = fam.get(t.prefix) || { prefix: t.prefix, members: 0, both: 0, scheduled: 0, onPlans: 0, planSheets: new Set(), tags: [] };
    f.members++;
    if (t.sched.length) f.scheduled++;
    if (t.plans.length) { f.onPlans++; for (const s of t.plans) f.planSheets.add(s); }
    if (t.sched.length && t.plans.length) f.both++;
    f.tags.push(t);
    fam.set(t.prefix, f);
  }

  const byTag = (a, b) => a.prefix.localeCompare(b.prefix) || a.num - b.num;
  const notScheduled = [], notOnPlans = [], familiesNotScheduled = [], writtenTwoWays = [];
  for (const f of fam.values()) {
    if (f.both > 0) {
      for (const t of f.tags.sort(byTag)) {
        if (!t.sched.length && t.plans.length) {
          notScheduled.push({ tag: t.tag, onPlans: t.plans, ...(t.other.length ? { alsoOn: t.other } : {}),
            message: `${t.tag} is on ${t.plans.join(", ")} and on no schedule sheet. ${f.scheduled} other ${f.prefix} tag(s) are scheduled.` });
        } else if (t.sched.length && !t.plans.length) {
          notOnPlans.push({ tag: t.tag, scheduledOn: t.sched, ...(t.other.length ? { alsoOn: t.other } : {}),
            message: `${t.tag} is scheduled on ${t.sched.join(", ")} and on no plan${t.other.length ? " (it is on " + t.other.join(", ") + ")" : ""}. ${f.onPlans} other ${f.prefix} tag(s) are on plans.` });
        }
        // FCU-01 on one sheet and FCU-1 on another.
        const forms = new Set(t.spellings.map((s) => s.replace(/^.*-/, "")));
        if (forms.size > 1) writtenTwoWays.push({ tag: t.tag, spellings: t.spellings });
      }
    } else if (f.scheduled === 0 && f.planSheets.size >= 2) {
      familiesNotScheduled.push({ prefix: f.prefix, tags: f.tags.sort(byTag).slice(0, 12).map((t) => t.tag), tagCount: f.members, planSheets: [...f.planSheets].sort().slice(0, 8),
        message: `${f.members} ${f.prefix} tag(s) are on ${f.planSheets.size} plan sheet(s) and none is on a schedule sheet.` });
    }
  }
  familiesNotScheduled.sort((a, b) => b.tagCount - a.tagCount);
  const families = [...fam.values()].filter((f) => f.both > 0).map((f) => f.prefix).sort();
  return {
    sheetsRead: totalSheets, scheduleSheets, planSheets: planSheetCount,
    familiesChecked: families, tagsChecked: [...fam.values()].filter((f) => f.both > 0).reduce((n, f) => n + f.members, 0),
    notScheduled: notScheduled.slice(0, LIST_MAX), notOnPlans: notOnPlans.slice(0, LIST_MAX),
    familiesNotScheduled: familiesNotScheduled.slice(0, 40), writtenTwoWays: writtenTwoWays.slice(0, 40),
    flagged: notScheduled.length + notOnPlans.length,
    ...(notScheduled.length > LIST_MAX || notOnPlans.length > LIST_MAX ? { truncated: true } : {}),
  };
}
