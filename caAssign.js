// caAssign.js — who to suggest as the assignee of an RFI or submittal.
//
// The CA team logs the item and assigns it to the engineer for its discipline.
// SettyPMS.html (window.CaAssign) and the Tracker both import this file. The
// Outlook add-in (setty-pms-addin taskpane.js, suggestAssignees) carries the
// same rule: change both together.
//
// The rule:
//   - a team member matches when `disciplines` (or the older single
//     `discipline`) lists the item's discipline, or their role names it
//     ("Electrical Engineer");
//   - managers (PM, deputy PM, director, president, CA specialist) are not
//     suggested by discipline: on most teams they carry every discipline;
//   - one or two matches are suggested; three or more are left for the person
//     to pick (assigning a whole department assigns it to nobody);
//   - no match, no discipline, Multi-Discipline or Other falls back to the PM.
//
// Pure: no DOM, no fetch.

const DISCIPLINE_WORDS = {
  "mechanical": /mech|hvac/i, "electrical": /elec/i, "plumbing": /plumb/i,
  "fire protection": /fire/i, "technology": /technolog|low.?voltage|telecom|\bav\b/i,
};
const MANAGER_ROLE = /project manager|director|president|principal|ca specialist/i;

const nameOf = (m) => String((m && (m.name || m.role)) || "").trim();

// team: project.teamMembers. pmName: the project's PM by name, when the
// project records one; otherwise the member whose role is Project Manager.
// Returns { ids, names, basis, matches }, basis one of:
//   "discipline"  ids are the engineer(s) for the discipline
//   "many"        three or more match; ids is empty
//   "pm-no-match" nobody on the team has the discipline; ids is the PM
//   "pm"          no usable discipline; ids is the PM
//   "none"        nothing to suggest
export function suggestAssignees(team, discipline, pmName) {
  const list = (Array.isArray(team) ? team : []).filter((m) => m && m.id);
  const want = String(discipline || "").trim().toLowerCase();
  const pmKey = String(pmName || "").trim().toLowerCase();
  const pm = (pmKey && list.find((m) => String(m.name || "").trim().toLowerCase() === pmKey))
    || list.find((m) => /^project manager$/i.test(String(m.role || "").trim())) || null;
  const fallback = (basis) => ({ ids: pm ? [pm.id] : [], names: pm ? [nameOf(pm)] : [], basis: pm ? basis : "none", matches: 0 });
  const word = DISCIPLINE_WORDS[want];
  if (!want || !word) return fallback("pm");
  const listed = (m) => [...(Array.isArray(m.disciplines) ? m.disciplines : []), m.discipline].some((d) => String(d || "").trim().toLowerCase() === want);
  const matches = list.filter((m) => !MANAGER_ROLE.test(String(m.role || "")) && (listed(m) || word.test(String(m.role || ""))));
  if (!matches.length) return fallback("pm-no-match");
  if (matches.length > 2) return { ids: [], names: [], basis: "many", matches: matches.length };
  return { ids: matches.map((m) => m.id), names: matches.map(nameOf), basis: "discipline", matches: matches.length };
}

// One line for the screen, or "" when there is nothing to say.
export function suggestionLabel(s, discipline) {
  if (!s) return "";
  const d = String(discipline || "").trim();
  switch (s.basis) {
    case "discipline": return `Suggested for ${d}: ${s.names.join(", ")}`;
    case "many": return `${s.matches} ${d} people on this team: pick who owns it`;
    case "pm-no-match": return `No ${d} engineer on the team list. Suggested: ${s.names.join(", ")} (PM)`;
    case "pm": return `Suggested: ${s.names.join(", ")} (PM)`;
    default: return "";
  }
}
