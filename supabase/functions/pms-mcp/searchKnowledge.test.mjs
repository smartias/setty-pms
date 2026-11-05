// Tests for search_knowledge's filtering in index.ts — the in-memory filter,
// the slim projection, and the load-bearing serving rules (approved-only by
// default, own-submissions gated on identity, project visibility applied).
//
//   node supabase/functions/pms-mcp/searchKnowledge.test.mjs
//
// The functions are COPIED below, same reason as the other pms-mcp tests:
// index.ts boots a server at import. Drift checks at the bottom.

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

// ── copies from index.ts ────────────────────────────────────────────────────
const knowledgeTrades = (r) => {
  const set = Array.isArray(r.disciplines) ? r.disciplines.filter(Boolean) : [];
  return set.length ? set : (r.discipline ? [r.discipline] : []);
};
function filterKnowledge(rows, f) {
  const has = (v, needle) => String(v ?? "").toLowerCase().includes(needle);
  let out = rows;
  if (f.agency) { const a = f.agency.toLowerCase().trim(); out = out.filter((r) => has(r.agency, a)); }
  if (f.discipline) { const d = f.discipline.toLowerCase().trim(); out = out.filter((r) => knowledgeTrades(r).some((t) => has(t, d))); }
  if (f.query) {
    const q = f.query.toLowerCase().trim();
    out = out.filter((r) =>
      [r.lesson_summary, r.agency, ...knowledgeTrades(r), r.system, r.issue_type, r.source_reference,
       Array.isArray(r.tags) ? r.tags.join(" ") : r.tags]
        .some((v) => has(v, q)));
  }
  return out;
}
const slimLesson = (r) => ({
  lessonId: r.lesson_id, project: r.project_id || undefined, agency: r.agency || undefined,
  discipline: r.discipline || undefined,
  disciplines: knowledgeTrades(r).length > 1 ? knowledgeTrades(r) : undefined,
  summary: r.lesson_summary,
  source: r.source_reference || undefined, date: (r.date_added || "").slice(0, 10) || undefined,
  status: r.status,
});
function filterPractices(rows, f) {
  const has = (v, needle) => String(v ?? "").toLowerCase().includes(needle);
  let out = rows;
  if (f.discipline) { const d = f.discipline.toLowerCase().trim(); out = out.filter((r) => knowledgeTrades(r).some((t) => has(t, d))); }
  if (f.query) {
    const q = f.query.toLowerCase().trim();
    out = out.filter((r) =>
      [r.title, r.practice_text, r.coord_theme, r.system, r.issue_type, ...knowledgeTrades(r)]
        .some((v) => has(v, q)));
  }
  return out;
}
const slimPractice = (r) => ({
  practiceId: r.practice_id, title: r.title, discipline: r.discipline || undefined,
  disciplines: knowledgeTrades(r).length > 1 ? knowledgeTrades(r) : undefined,
  system: r.system || undefined, theme: r.coord_theme || undefined,
  practice: r.practice_text, confidence: r.confidence || undefined,
  date: (r.date_added || "").slice(0, 10) || undefined, status: r.status,
});

// ── fixtures ────────────────────────────────────────────────────────────────
const ROWS = [
  { lesson_id: "1", project_id: "SAPX196006.00", agency: "SUNY", discipline: "Mechanical",
    lesson_summary: "HTHW conversion requires the campus utilities office to witness pressure tests.",
    source_reference: "RFI 042", tags: ["hthw"], status: "approved", date_added: "2026-05-02T10:00:00Z" },
  { lesson_id: "2", project_id: null, agency: "DASNY", discipline: null,
    lesson_summary: "DASNY requires wet stamps on fire protection narratives; PDF signatures were rejected twice.",
    source_reference: null, tags: [], status: "approved", date_added: "2026-06-11T10:00:00Z" },
  { lesson_id: "3", project_id: "SAPQ226916.00", agency: null, discipline: "Electrical",
    lesson_summary: "Con Edison service letters must be re-requested if the load letter is older than 12 months.",
    source_reference: "email 2026-03-04", tags: null, status: "approved", date_added: "2026-03-05T10:00:00Z" },
];

// ── 1. Free-text query spans the row ────────────────────────────────────────
check(filterKnowledge(ROWS, { query: "wet stamps" }).length === 1, "query matches summary text");
check(filterKnowledge(ROWS, { query: "rfi 042" })[0]?.lesson_id === "1", "query matches source_reference");
check(filterKnowledge(ROWS, { query: "hthw" }).length === 1, "query matches tags");
check(filterKnowledge(ROWS, { query: "elevator" }).length === 0, "no match returns empty, not everything");

// ── 2. Facet filters and combinations ───────────────────────────────────────
check(filterKnowledge(ROWS, { agency: "dasny" }).length === 1, "agency filter is case-insensitive");
check(filterKnowledge(ROWS, { discipline: "Mech" }).length === 1, "discipline filter is substring");
check(filterKnowledge(ROWS, { agency: "SUNY", query: "pressure" }).length === 1, "filters compose (AND)");
check(filterKnowledge(ROWS, { agency: "SUNY", query: "wet stamps" }).length === 0, "composed filters exclude");
check(filterKnowledge(ROWS, {}).length === 3, "no filters returns everything");

// ── 3. Null fields never crash and never match ──────────────────────────────
check(filterKnowledge(ROWS, { discipline: "x" }).length === 0, "null discipline rows do not throw");
check(filterKnowledge([{ lesson_summary: null, tags: null }], { query: "anything" }).length === 0,
  "an all-null row simply does not match");

// ── 4. Slim projection drops empties, keeps identity ────────────────────────
const slim = slimLesson(ROWS[1]);
check(slim.project === undefined && slim.discipline === undefined, "nulls become undefined (dropped from JSON)");
check(slim.date === "2026-06-11", "date is trimmed to the day");
check(slim.lessonId === "2" && slim.status === "approved", "id and status survive");

// ── 4b. Best practices filter + projection (1.23.0) ─────────────────────────
const PRACTICES = [
  { practice_id: "p1", title: "Schedule air terminal casing gauge", discipline: "Mechanical",
    system: "Air terminals", coord_theme: "Schedules", issue_type: "Submittal",
    practice_text: "Casing gauge, attenuator and NC belong on the VAV schedule, not only in spec text.",
    confidence: "high", status: "approved", date_added: "2026-10-23T10:00:00Z" },
  { practice_id: "p2", title: "Check line-side devices against service fault current", discipline: "Electrical",
    system: null, coord_theme: "Coordination", issue_type: null,
    practice_text: "Devices tapped ahead of the main must be rated for the service fault current.",
    confidence: "medium", status: "approved", date_added: "2026-10-30T10:00:00Z" },
];
check(filterPractices(PRACTICES, { discipline: "mech" }).length === 1, "practice discipline filter is case-insensitive substring");
check(filterPractices(PRACTICES, { query: "fault current" })[0]?.practice_id === "p2", "practice query matches practice_text");
check(filterPractices(PRACTICES, { query: "schedules" }).length === 1, "practice query matches coord_theme");
check(filterPractices(PRACTICES, { query: "elevator" }).length === 0, "practice no-match returns empty");
check(filterPractices(PRACTICES, {}).length === 2, "practice no filters returns everything");
check(filterPractices([{ title: null, practice_text: null }], { query: "x" }).length === 0, "all-null practice row does not throw");
const slimP = slimPractice(PRACTICES[1]);
check(slimP.system === undefined && slimP.theme === "Coordination", "practice nulls become undefined, theme maps from coord_theme");
check(slimP.date === "2026-10-30" && slimP.practiceId === "p2", "practice id and trimmed date survive");

// ── 4c. Multi-discipline entries (1.24.0) ───────────────────────────────────
// An entry tagged with several trades is found under EACH of them; rows saved
// before the disciplines column existed fall back to the single discipline.
const MULTI = [
  { lesson_id: "m1", lesson_summary: "Coordinate sleeves through rated slabs", discipline: "Mechanical",
    disciplines: ["Mechanical", "Plumbing", "Fire Protection"], status: "approved", date_added: "2026-11-05T10:00:00Z" },
  { lesson_id: "m2", lesson_summary: "Legacy row", discipline: "Electrical", status: "approved", date_added: "2026-11-01T10:00:00Z" },
];
check(filterKnowledge(MULTI, { discipline: "plumbing" }).map(r => r.lesson_id).join() === "m1", "lesson found under a NON-primary trade");
check(filterKnowledge(MULTI, { discipline: "fire" }).length === 1, "lesson found under its third trade");
check(filterKnowledge(MULTI, { discipline: "electrical" }).map(r => r.lesson_id).join() === "m2", "legacy single-discipline row still matches");
check(filterKnowledge(MULTI, { query: "fire protection" }).length === 1, "free-text query covers every trade");
check(JSON.stringify(slimLesson(MULTI[0]).disciplines) === '["Mechanical","Plumbing","Fire Protection"]', "multi-trade lesson exposes its trades");
check(slimLesson(MULTI[1]).disciplines === undefined, "single-trade lesson output unchanged");
const MULTI_P = [{ practice_id: "pm", title: "Rated penetrations", practice_text: "x", discipline: "Plumbing",
  disciplines: ["Plumbing", "Electrical"], status: "approved" }];
check(filterPractices(MULTI_P, { discipline: "Electrical" }).length === 1, "practice found under a NON-primary trade");
check(filterPractices([{ ...MULTI_P[0], disciplines: [] }], { discipline: "Electrical" }).length === 0,
  "empty trade list falls back to the primary only");

// ── 5. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has("function filterKnowledge(rows: any[]", "filterKnowledge");
has("Array.isArray(r.tags) ? r.tags.join(\" \") : r.tags]", "tags handling in query filter");
has("const slimLesson = (r: any) => ({", "slimLesson");
has('mcp.tool("search_knowledge"', "search_knowledge is still registered");
// Serving rules that must not silently loosen:
has('const statuses = includeArchived ? "in.(approved,archived)" : "eq.approved";', "approved-only default");
has('&status=in.(suggested,rejected)&order=date_added.desc&limit=50', "mine: own suggested/rejected only");
has("visible = rows.filter((r: any) => !r.project_id || ok.has(r.project_id));", "project visibility filter");
// Best practices fold-in (1.23.0): approved-only default, same archived toggle:
has("function filterPractices(rows: any[]", "filterPractices");
has("const slimPractice = (r: any) => ({", "slimPractice");
has('"pms_best_practices?select=*&status=" +\n        (includeArchived ? "in.(approved,archived)" : "eq.approved")', "practices approved-only default");
has('"pms_lessons?select=*&status=" + statuses +', "lessons read every column (disciplines) with the approved-only status");
has("const knowledgeTrades = (r: any): string[] => {", "knowledgeTrades");
has("bestPractices: practices.slice(0, KNOWLEDGE_RESULT_CAP).map(slimPractice),", "bestPractices in the response");
// The briefing fold-in stays approved-only and per-project, and it tells the
// model how many entries exist beyond the slice it shows:
has('"source_reference,status,date_added&status=eq.approved" +\n              "&project_id=eq."', "briefing fold-in approved-only");
has("totalApprovedOnProject: lessons.total,", "briefing fold-in total count");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);
