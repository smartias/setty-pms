// Tests for K5 team-activity awareness in index.ts — the topic distillation
// and the per-teammate aggregation project_briefing folds in, and the privacy
// line they must hold: presence (who/when/tools/topic words), never verbatim
// queries, never the caller's own rows.
//
//   node supabase/functions/pms-mcp/teamActivity.test.mjs
//
// The functions are COPIED below, same reason as the other pms-mcp tests:
// index.ts boots a server at import. Drift checks at the bottom.

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

// ── copies from index.ts ────────────────────────────────────────────────────
const ACTIVITY_MAX_PEOPLE = 5;
const ACTIVITY_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "at", "with", "about",
  "what", "who", "when", "where", "how", "is", "are", "was", "were", "me", "my", "our",
  "get", "find", "show", "give", "list", "all", "any", "current", "latest", "recent",
  "status", "project", "projects", "please",
]);
function activityTopics(queries, cap = 6) {
  const freq = new Map();
  for (const q of queries) {
    for (const w of String(q || "").toLowerCase().split(/[^a-z0-9#&-]+/)) {
      if (w.length < 3 || ACTIVITY_STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap).map(([w]) => w);
}
function summarizeTeamActivity(rows, selfEmail, refs) {
  const refSet = new Set(refs.filter(Boolean).map((r) => String(r).toLowerCase().trim()));
  const self = (selfEmail || "").toLowerCase();
  const byPerson = new Map();
  for (const r of rows) {
    const email = String(r.caller_email || "").toLowerCase();
    const ref = String(r.project_number || "").toLowerCase().trim();
    if (!email || email === self || !ref || !refSet.has(ref)) continue;
    const e = byPerson.get(email) ?? { calls: 0, lastActive: "", tools: new Set(), queries: [] };
    e.calls++;
    if (String(r.created_at || "") > e.lastActive) e.lastActive = String(r.created_at || "");
    if (r.tool) e.tools.add(String(r.tool));
    if (r.query) e.queries.push(String(r.query));
    byPerson.set(email, e);
  }
  return [...byPerson.entries()]
    .map(([email, e]) => ({
      teammate: email, calls: e.calls, lastActive: e.lastActive || null,
      tools: [...e.tools].slice(0, 6),
      ...(e.queries.length ? { topics: activityTopics(e.queries) } : {}),
    }))
    .sort((a, b) => String(b.lastActive).localeCompare(String(a.lastActive)))
    .slice(0, ACTIVITY_MAX_PEOPLE);
}

// ── fixtures ────────────────────────────────────────────────────────────────
const T = (n) => `2026-09-01T${String(n).padStart(2, "0")}:00:00Z`;
const row = (email, ref, tool, query, hour) =>
  ({ caller_email: email, project_number: ref, tool, query, created_at: T(hour) });
const ROWS = [
  row("shari@setty.com", "SAPX196006.00", "search_drawings", "fire protection narrative phase 3", 9),
  row("shari@setty.com", "SAPX196006.00", "read_document", null, 10),
  row("shari@setty.com", "Tabler Quad", "project_briefing", "what is the status of the fire protection submittal", 11),
  row("anthony@setty.com", "SAPX196006.00", "search_emails", "hydraulic calc comments", 8),
  row("anthony@setty.com", "SAPQ226916.00", "get_project", null, 12),      // different project
  row("me@setty.com", "SAPX196006.00", "project_briefing", "catch me up", 12), // the caller
  row(null, "SAPX196006.00", "search_notes", "orphan", 7),                  // no identity
];
const REFS = ["SAPX196006.00", "Tabler Quad"];   // number AND name both match

// ── 1. Aggregation: who, how much, most recent first ────────────────────────
const out = summarizeTeamActivity(ROWS, "me@setty.com", REFS);
check(out.length === 2, "two teammates found (self and other-project rows excluded)");
check(out[0].teammate === "shari@setty.com", "most recently active teammate first");
check(out[0].calls === 3, "name-typed refs count toward the same project");
check(out[0].lastActive === T(11), "lastActive is the newest row");
check(out[1].teammate === "anthony@setty.com" && out[1].calls === 1,
  "a teammate's rows on OTHER projects are not counted");

// ── 2. The privacy line: presence, never transcripts ────────────────────────
const flat = JSON.stringify(out);
check(!flat.includes("what is the status of the fire protection submittal"),
  "verbatim queries never appear in the output");
check(out[0].topics.includes("fire") && out[0].topics.includes("protection"),
  "distilled topic words do appear");
check(!flat.includes("me@setty.com"), "the caller never appears in their own briefing");
check(!flat.includes("catch me up"), "the caller's own queries never leak either");
check(out[1].topics.every((t) => !"hydraulic calc comments".split(" ").every(() => false)) &&
      !flat.includes("SAPQ226916.00"),
  "nothing from a different project's rows leaks through a shared teammate");

// ── 3. Topic distillation ───────────────────────────────────────────────────
check(activityTopics(["what is the current status of the DASNY submittal", "DASNY submittal comments"])
  .slice(0, 2).join(",") === "dasny,submittal", "frequency wins; stopwords and short words drop");
check(activityTopics(["review 2026 sheet E211"]).includes("e211") &&
      !activityTopics(["review 2026 sheet E211"]).includes("2026"),
  "sheet numbers survive, bare years do not");
check(activityTopics([]).length === 0 && activityTopics([null, ""]).length === 0,
  "empty and null queries produce no topics");

// ── 4. Caps hold ────────────────────────────────────────────────────────────
const many = Array.from({ length: 9 }, (_, i) => row(`u${i}@setty.com`, "SAPX196006.00", "get_project", null, i + 1));
check(summarizeTeamActivity(many, null, REFS).length === ACTIVITY_MAX_PEOPLE,
  "at most ACTIVITY_MAX_PEOPLE teammates are listed");
check(activityTopics(["a b c one two three four five six seven eight nine".replace(/\b\w\b/g, "")], 6).length <= 6,
  "topics cap at 6");

// ── 5. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has("const ACTIVITY_MAX_PEOPLE = 5;", "people cap");
has('if (w.length < 3 || ACTIVITY_STOPWORDS.has(w) || /^\\d+$/.test(w)) continue;', "topic word filter");
has("if (!email || email === self || !ref || !refSet.has(ref)) continue;", "self/ref exclusion");
has("...(e.queries.length ? { topics: activityTopics(e.queries) } : {}),", "topics-not-queries projection");
has("summarizeTeamActivity(\n      activityRows, currentCaller().email, [p.projectNumber, p.name]);", "briefing wiring excludes the caller");
has("&caller_email=not.is.null&order=created_at.desc&limit=", "telemetry fetch shape");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);
