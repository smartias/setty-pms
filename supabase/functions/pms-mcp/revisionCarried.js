// revisionCarried.js — was a revision's change carried to the sheets that
// were not re-issued? (tool check_revision_carried, checklist item qa-634)
//
// Input is pms_set_tag_changes for one addendum or bulletin folder: each tag
// ADDED to or REMOVED from a sheet in the set, compared with that sheet's
// previous revision, and where else the tag is shown now.
//
//   removedStillShown   removed from every sheet of the set that had it, and
//                       a sheet NOT in the set still shows it: the schedule,
//                       the riser, the other discipline's plan. This is the
//                       bulletin that took dampers off the fire alarm sheet
//                       and left their power on the electrical sheet.
//   addedOnOneSheet     added on one sheet of the set and shown nowhere else
//                       in the project: new equipment with no schedule row,
//                       no power, no riser entry.
//
// A tag removed from one sheet and still on another sheet of the same set was
// moved or kept on purpose, and is not reported. Tags only: a changed note,
// size or quantity is not seen. Every result is two sheets to open. Pure.

const SHEETLIKE = /^(A|AD|C|E|EL|ES|FA|FP|G|H|I|L|M|MD|P|PD|S|SP|T|TS)$/;
const NOT_EQUIPMENT = new Set(["NEC", "NFPA", "ASTM", "ANSI", "ASME", "UL", "IBC", "IMC", "IPC", "IECC", "IFC", "ADA", "ASHRAE", "SMACNA", "NEMA", "IEEE", "AWWA", "CSA", "ISO",
  "RFI", "ASI", "PCO", "BULL", "ADD", "REV", "SK", "PLAN", "ZONE", "AREA", "TYPE", "NOTE", "DETAIL", "DET", "SECT", "PHASE", "PART", "DIV", "FIG", "NO", "ALT", "OPT", "ITEM",
  "ROOM", "RM", "LEVEL", "GRID", "COL", "DWG", "SHT", "SIM", "TYP", "MIN", "MAX", "AWG", "MCM", "PVC", "EMT", "RGS", "SCH", "CAT", "RS", "USB", "GFI", "GFCI", "AFF"]);

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);

// rows: [{ sheet_no, change: "added" | "removed" | "-", tag_prefix, tag_num, in_set_sheets, elsewhere_sheets, previous_set, sheets_in_set, sheets_with_previous, set_date }]
export function revisionCarried(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const sheetsInSet = Number(all[0]?.sheets_in_set ?? 0), withPrevious = Number(all[0]?.sheets_with_previous ?? 0);
  const setDate = all[0]?.set_date ? String(all[0].set_date).slice(0, 10) : null;
  const tags = new Map();
  const changedSheets = new Set();
  for (const r of all) {
    if (r.change !== "added" && r.change !== "removed") continue;
    const prefix = String(r.tag_prefix || "").toUpperCase(), num = Number(r.tag_num);
    if (!prefix || !Number.isFinite(num) || NOT_EQUIPMENT.has(prefix)) continue;
    if (SHEETLIKE.test(prefix) && num >= 100) continue;          // M-601: a sheet reference
    const tag = `${prefix}-${num}`, sheet = String(r.sheet_no || "");
    changedSheets.add(sheet);
    const t = tags.get(tag) || { tag, removedFrom: [], addedTo: [], inSet: new Set(), elsewhere: new Set(), previousSets: new Set() };
    (r.change === "removed" ? t.removedFrom : t.addedTo).push(sheet);
    for (const s of arr(r.in_set_sheets)) t.inSet.add(s);
    for (const s of arr(r.elsewhere_sheets)) t.elsewhere.add(s);
    if (r.previous_set) t.previousSets.add(String(r.previous_set));
    tags.set(tag, t);
  }
  const removedStillShown = [], addedOnOneSheet = [];
  let removed = 0, added = 0;
  for (const t of [...tags.values()].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }))) {
    if (t.removedFrom.length) removed++;
    if (t.addedTo.length) added++;
    // Still on another sheet of the set (other than where it was just added back): moved or kept, not removed.
    const stillInSet = [...t.inSet].filter((s) => !t.removedFrom.includes(s));
    if (t.removedFrom.length && !t.addedTo.length && !stillInSet.length && t.elsewhere.size) {
      const where = [...t.elsewhere].sort();
      removedStillShown.push({ tag: t.tag, removedFrom: t.removedFrom.sort(), stillOn: where,
        message: `${t.tag} was removed from ${t.removedFrom.sort().join(", ")} in this set. ${where.join(", ")} ${where.length === 1 ? "was" : "were"} not re-issued and still show${where.length === 1 ? "s" : ""} it.` });
    }
    if (t.addedTo.length === 1 && !t.removedFrom.length && !stillInSet.filter((s) => s !== t.addedTo[0]).length && !t.elsewhere.size) {
      addedOnOneSheet.push({ tag: t.tag, addedOn: t.addedTo[0],
        message: `${t.tag} was added on ${t.addedTo[0]} in this set and is on no other sheet. Confirm nothing else needs it: a schedule row, a power connection, a riser or controls entry.` });
    }
  }
  return {
    setDate, sheetsInSet, sheetsCompared: withPrevious, newSheets: Math.max(0, sheetsInSet - withPrevious),
    sheetsWithTagChanges: changedSheets.size, tagsRemoved: removed, tagsAdded: added,
    removedStillShown: removedStillShown.slice(0, 120), addedOnOneSheet: addedOnOneSheet.slice(0, 120),
    flagged: removedStillShown.length,
  };
}
