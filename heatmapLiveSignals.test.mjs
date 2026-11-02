// Tests for the heatmap's live CA/QA signal handling in SettyIntelligence.html:
// caCounts() must PREFER the live PMS CA log over the register snapshot when a
// project has any logged items (the sources overlap for backloaded items, so
// adding would double-count), and fall back cleanly when it has none.
//
//   node heatmapLiveSignals.test.mjs
//
// The functions are COPIED below (SettyIntelligence.html is plain script in an
// HTML file); drift checks at the bottom pin the shipped source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── copies from SettyIntelligence.html ──────────────────────────────────────
const state = { heat: { live: {} } };
const liveSig = num => (state.heat.live || {})[String(num || "").trim().toUpperCase()] || null;
function caCounts(r) {
  const s = liveSig(r.num);
  if (s && ((s.rfis_total || 0) + (s.subs_total || 0)) > 0) {
    return { live: true, rfis_open: s.rfis_open || 0, rfis_overdue: s.rfis_overdue || 0,
             subs_open: s.subs_open || 0, subs_overdue: s.subs_overdue || 0 };
  }
  return { live: false, rfis_open: r.rfis_open || 0, rfis_overdue: r.rfis_overdue || 0,
           subs_open: r.subs_open || 0, subs_overdue: r.subs_overdue || 0 };
}
function qaCounts(r) {
  const s = liveSig(r.num) || {};
  const ls = s.qa_lifesafety || 0, ag = s.qa_agency || 0, cost = s.qa_cost || 0, open = s.qa_open || 0;
  return { ls, ag, cost, other: Math.max(0, open - ls - ag - cost), open };
}

// ── fixtures ────────────────────────────────────────────────────────────────
state.heat.live = {
  "SAPX176021.00": { rfis_open: 2, rfis_overdue: 1, subs_open: 2, subs_overdue: 1,
                     rfis_total: 3, subs_total: 2, qa_lifesafety: 1, qa_agency: 1, qa_cost: 0, qa_open: 3 },
  "SAPX259009.00": { rfis_open: 0, rfis_overdue: 0, subs_open: 0, subs_overdue: 0,
                     rfis_total: 0, subs_total: 1, qa_open: 0 },
  "SIPX241014.00": { rfis_total: 0, subs_total: 0, qa_open: 1 },
};
const regRow = { num: "SAPX176021.00", rfis_open: 9, rfis_overdue: 9, subs_open: 9, subs_overdue: 9 };

test("live counts REPLACE register counts when the project has logged items", () => {
  const c = caCounts(regRow);
  assert.equal(c.live, true);
  assert.deepEqual([c.rfis_open, c.rfis_overdue, c.subs_open, c.subs_overdue], [2, 1, 2, 1]);
});

test("a live project with zero open items shows live zeros, not stale register counts", () => {
  const c = caCounts({ num: "SAPX259009.00", rfis_open: 5, rfis_overdue: 3, subs_open: 4, subs_overdue: 2 });
  assert.equal(c.live, true);
  assert.deepEqual([c.rfis_open, c.rfis_overdue, c.subs_open, c.subs_overdue], [0, 0, 0, 0]);
});

test("no live CA rows (qa-only or unknown project) falls back to the register snapshot", () => {
  const qaOnly = caCounts({ num: "SIPX241014.00", rfis_open: 3, rfis_overdue: 1, subs_open: 0, subs_overdue: 0 });
  assert.equal(qaOnly.live, false);
  assert.equal(qaOnly.rfis_open, 3);
  const unknown = caCounts({ num: "SAPX999999.00", rfis_open: 7, rfis_overdue: 2 });
  assert.equal(unknown.live, false);
  assert.deepEqual([unknown.rfis_open, unknown.rfis_overdue], [7, 2]);
});

test("project-number matching ignores case and whitespace", () => {
  assert.equal(caCounts({ num: " sapx176021.00 " }).live, true);
});

test("qaCounts splits severities and derives 'other' from the remainder", () => {
  const q = qaCounts({ num: "SAPX176021.00" });
  assert.deepEqual([q.ls, q.ag, q.cost, q.other, q.open], [1, 1, 0, 1, 3]);
  const none = qaCounts({ num: "SAPX999999.00" });
  assert.deepEqual([none.ls, none.open], [0, 0]);
});

// ── drift checks against the shipped source ─────────────────────────────────
test("shipped SettyIntelligence.html still contains the tested logic", () => {
  const shipped = readFileSync(new URL("./SettyIntelligence.html", import.meta.url), "utf8");
  const has = (needle, label) => assert.ok(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
  has("const liveSig = num => (state.heat.live || {})[String(num || \"\").trim().toUpperCase()] || null;", "liveSig");
  has("if (s && ((s.rfis_total || 0) + (s.subs_total || 0)) > 0) {", "caCounts live preference");
  has("const ls = s.qa_lifesafety || 0, ag = s.qa_agency || 0, cost = s.qa_cost || 0, open = s.qa_open || 0;", "qaCounts");
  has('sb("POST", "/rest/v1/rpc/pms_heatmap_live_signals", {})', "live signals RPC call");
  // Load-bearing scoring rules:
  has("+ ca.rfis_open + ca.rfis_overdue * 2", "heatScore uses live CA counts");
  has("+ qa.ls * 3 + qa.ag * 2 + qa.cost + qa.other * 0.25", "heatScore QA severity weights");
  has("|| qaCounts(r).ls > 0", "life-safety finding makes a project hot");
  // The migration keeps the approved-only semantics this client assumes:
  const mig = readFileSync(new URL("./supabase/migrations/20261102130000_heatmap_live_signals.sql", import.meta.url), "utf8");
  assert.ok(mig.includes("where status in ('open', 'ready_to_backcheck')"), "migration counts only open QA findings");
  assert.ok(mig.includes("due_date is not null and due_date < current_date"), "migration computes overdue from real due dates");
});

// ── heatmap cache (20261102150000_heatmap_cache.sql) ────────────────────────
// Guards verified against a scratch Postgres 16 when the migration was written;
// these pin them so a later edit cannot quietly drop one.
test("heatmap cache migration keeps its safety properties", () => {
  const mig = readFileSync(new URL("./supabase/migrations/20261102150000_heatmap_cache.sql", import.meta.url), "utf8");
  const has = (needle, label) => assert.ok(mig.includes(needle), label);
  has("grant select on table public.pms_portfolio_heatmap_cache to anon, authenticated;",
    "explicit cache grant (without it anon gets 'permission denied' instead of the live fallback)");
  has("for select to authenticated using (true);", "cache rows visible to signed-in users only");
  has("revoke all on function public.pms_portfolio_heatmap_refresh() from public, anon, authenticated;",
    "only service_role / cron may trigger the expensive refresh");
  has("return public.pms_portfolio_heatmap_compute();", "live fallback when no cache row is visible");
  has("if exists (select 1 from pg_extension where extname = 'pg_cron') then", "cron scheduling guarded for replays without pg_cron");
  has("set statement_timeout = '5min'; select public.pms_portfolio_heatmap_refresh();", "refresh runs with its own timeout, off the request path");
});

test("the heat map shows how old its snapshot is", () => {
  const shipped = readFileSync(new URL("./SettyIntelligence.html", import.meta.url), "utf8");
  assert.ok(shipped.includes('sb("POST", "/rest/v1/rpc/pms_portfolio_heatmap_asof", {})'), "snapshot time is fetched");
  assert.ok(shipped.includes("const HEAT_STALE_MIN = 45;"), "stale threshold present");
  assert.ok(shipped.includes("Click a bubble to open that project's brief.${heatSnapLine()}</div>"), "snapshot line rendered in banner");
});
