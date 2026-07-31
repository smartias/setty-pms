// Tests for scoreMeetingDoc() in index.ts — the heuristic project_briefing uses
// to pick a project's meeting minutes out of its SharePoint folders.
//
//   node supabase/functions/pms-mcp/scoreMeetingDoc.test.mjs
//
// The function is COPIED below rather than imported: index.ts is a single-file
// edge function whose top level constructs the MCP server and calls Deno.serve,
// so importing it would boot a server. Keep the copy in lockstep with index.ts —
// if you change the scoring there, change it here and re-run.
//
// Every name in the fixtures below is real, pulled from pms_project_emails
// attachment names and the SharePoint folder listings for 280 Broadway,
// Homeport II, Riverbank, DFRB Softball, New Lots and Philly WNBA. The point of
// the fixtures is that the firm has no single naming convention: minutes are
// variously "... - Minutes.pdf", "Meeting minutes", "Mtg 001 Minutes_Final.pdf",
// "_Notes.pdf", and — on 280 Broadway — "Design Meeting #16.pdf", which says
// neither "minutes" nor "notes".

function scoreMeetingDoc(name) {
  const n = name.toLowerCase().replace(/[_.\-]+/g, " ");
  let s = 0;
  if (/minutes?/.test(n)) s += 10;
  if (/\bnotes?\b/.test(n)) s += 8;
  if (/meeting|\bmtg\b/.test(n)) s += 6;
  if (/\b(design|progress|coordination|oac|kick\s*-?\s*off|kickoff|workshop|site\s*visit|bi.?weekly)\b/.test(n)) s += 3;
  if (/agendas?/.test(n)) s -= 4;
  if (/\b(sign[\s_-]*in|attendance|roster|invite|calendar)\b/.test(n)) s -= 8;
  return s;
}

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log("FAIL  " + msg); } };

// 1. Minutes must outrank the agenda filed beside them for the SAME meeting.
// This is the case that matters most and the one that used to break: because
// "_" is a word character, \bagenda\b never matched "_Agenda_2026-07-29.pdf",
// so the agenda scored HIGHER than the minutes. Hence the separator fold.
const pairs = [
  ["20260729 - Homeport II - OAC Meeting 060 - Minutes.pdf",
   "20260729 - Homeport II - OAC Meeting 060 - Agenda.pdf"],
  ["20260715 - Homeport II - OAC Meeting 059 - Minutes.pdf",
   "20260715 - Homeport II - OAC Meeting 059 - Agenda.pdf"],
  ["20260204_DFRB Softball Progress Meeting 30 - MINUTES.pdf",
   "20260204_DFRB Softball Progress Meeting 30 - Agenda.pdf"],
  ["2023_1018_Riverbank State Park South End Courts - Biweekly Meeting minutes.docx",
   "2023_1018_Agenda_Biweekly Meeting_South End Courts.pdf"],
  ["2026.07.29_Design Meeting #16.pdf",
   "2020.40-01_280 Bway_CGA Bi-Weekly Mtg 16_Agenda_2026-07-29.pdf"],
  ["2026.07.29_Design Meeting #16.pdf",
   "PW316EL Progress Meeting Agenda #16_CGA_2026-06-09.pdf"],
];
for (const [minutes, agenda] of pairs) {
  check(scoreMeetingDoc(minutes) > scoreMeetingDoc(agenda),
    `minutes(${scoreMeetingDoc(minutes)}) must beat agenda(${scoreMeetingDoc(agenda)}) — ${minutes}`);
}

// 2. Real meeting records that must SURVIVE the score > 0 filter.
// "OAMeeting2" and "Mtg_28" are why the meeting test is unanchored and why
// "mtg" is a recognised abbreviation.
const keep = [
  "2026.07.29_Design Meeting #16.pdf",
  "260714_Mtg_28.docx",
  "230530_NewLots_OAMeeting2.pdf",
  "240417_NewLots_Consultant KickOff Meeting.pdf",
  "2022-05-04_Minutes_FuelPresentation_1.0.pdf",
  "2023-11-08_Mtg 001 Minutes_Final.pdf",
  "2024 12 13 - BPL New Lots, All-Consultant Coordination Minutes.pdf",
  "2026_0601 Philly WNBA_Schematic Design Tip-Off_Notes.pdf",
  "2026 01 08_OGS_FCA_Kick Off_Meeting Minutes.docx",
  "2025.10.01 Meeting Minutes - NCC TV Studio Renovation.pdf",
  "2026-07-21_MEETING Project Progress Meeting No 19.docx",
  "2023_0920_Riverbank State Park South End Courts - Kick Off Mtg Minutes.docx",
  "20240424 - Homeport II Phase 2 - OAC Meeting 001.pdf",
  // Emails-folder subfolder names, which are scored the same way.
  "2026_07_17 Meeting minutes",
  "2026_07_29 2020.40-01 280 Bway Bi-Weekly Meeting",
  "2025-11-03_Design Kick-Off Meeting",
];
for (const n of keep) check(scoreMeetingDoc(n) > 0, `should survive (scored ${scoreMeetingDoc(n)}) — ${n}`);

// 3. Noise sharing the same folders that must be FILTERED OUT.
const drop = [
  "Sankeerth_NS_Project_Handover_May2026.pdf",
  "2026_06_23 schedule",
  "2026_02_03 Risk Register",
  "2026-06-16_Option 1 and 2 Cost Estimate",
  "2026_05_21 C401 Form - 280 Broadway",
  "2026_07_29 agenda and Schedule",
  "20250304_PreconstructionAgenda.docx",
  "2026-04-15 Con Edison Steam Package.pdf",
  "STTQ-01-M.pdf",
  "Owner Comments.xlsx",
];
for (const n of drop) check(scoreMeetingDoc(n) <= 0, `should be filtered (scored ${scoreMeetingDoc(n)}) — ${n}`);


// ---------------------------------------------------------------------------
// nameDate() — mirrors index.ts. Ordering depends on it because Graph's
// lastModifiedDateTime is unreliable: Tabler's 41 meeting folders were bulk
// migrated and all report the same June-2026 timestamp.
function nameDate(name) {
  const n = name.replace(/[_.]+/g, "-");
  for (const m of n.matchAll(/(20\d{2})-?(\d{2})-?(\d{2})/g)) {
    if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  for (const m of n.matchAll(/\b(\d{2})(\d{2})(\d{2})\b/g)) {
    if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `20${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

const dates = [
  ["2024-10-25_Meeting Notes", "2024-10-25"],
  ["2026.07.29_Design Meeting #16.pdf", "2026-07-29"],
  ["2026_07_17 Meeting minutes", "2026-07-17"],
  ["20260729 - Homeport II - OAC Meeting 060 - Minutes.pdf", "2026-07-29"],
  ["2023_0920_Riverbank State Park South End Courts - Kick Off Mtg Minutes.docx", "2023-09-20"],
  ["260602_Mtg_25.pdf", "2026-06-02"],
  ["2019-05-15_Meeting Agenda", "2019-05-15"],
  ["2026-06-18 Ex. Thermacor piping shop", "2026-06-18"],
  // The project number 2020.40-01 looks like a date and leads the string; the
  // real meeting date is at the END. Taking the first match would give 2020-40-01.
  ["2020.40-01_280 Bway_CGA Bi-Weekly Mtg 16_Agenda_2026-07-29.pdf", "2026-07-29"],
  // No date at all -> null, so the caller falls back to the folder or Graph.
  ["2007 HTHW Underground design package", null],
  ["Sankeerth_NS_Project_Handover_May2026.pdf", null],
  ["Owner Comments.xlsx", null],
];
for (const [name, want] of dates) {
  const got = nameDate(name);
  check(got === want, `nameDate expected ${want} got ${got} — ${name}`);
}

// Ordering regression: identical scores, timestamps flattened by the migration.
// Only the name date can put these in the right order.
const tabler = ["2019-05-22_Meeting Notes", "2024-10-25_Meeting Notes", "2024-06-14_Meeting Notes"]
  .map((n) => ({ n, date: nameDate(n), score: scoreMeetingDoc(n) }))
  .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.score - a.score));
check(tabler[0].n === "2024-10-25_Meeting Notes",
  `newest Tabler meeting should sort first, got ${tabler[0].n}`);
check(new Set(["2019-05-22_Meeting Notes","2024-10-25_Meeting Notes","2024-06-14_Meeting Notes"]
  .map((n) => scoreMeetingDoc(n))).size === 1, "Tabler folder scores should all tie, proving date does the work");

const total = pairs.length + keep.length + drop.length + dates.length + 2;
console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (${pairs.length} minutes-vs-agenda pairs, ${keep.length} records kept, ` +
    `${drop.length} noise names dropped, ${dates.length} dates parsed, 2 ordering checks)`);
process.exit(failures ? 1 : 0);
