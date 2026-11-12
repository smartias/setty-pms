-- Outlook pane telemetry: how long each save took and where the time went.
--
-- Why: an email auto-log took 3-4 minutes on 2026-11-12 and nothing recorded
-- which step was slow. pms_filing_log says WHAT was filed, pms_mcp_telemetry
-- covers the Claude connector; the pane's own saves had no timing at all.
--
-- Writer: taskpane.js (setty-pms-addin) telemetryEnd(), one row per operation,
-- fire-and-forget. The pane treats a missing table as "telemetry off", so this
-- migration and the add-in change can ship in either order.
--
--   operation  email-autolog | email-record | email-backfill-sent | email-sp |
--              rfi-new | rfi-existing | sub-new | sub-existing | ...
--   steps      [{label, ms}]          phases the flow timed itself
--   calls      [{label, ms, status}]  each network call made during the op;
--              status -1 = the call threw (network error / timeout)
--   detail     free-form sizes/counts (body_chars, files, messages)
--
-- No email subject or body is stored. msg_id and project_id are kept so a slow
-- row can be matched to pms_filing_log / pms_project_emails.

create table if not exists public.pms_addin_telemetry (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  user_email     text default nullif(auth.jwt() ->> 'email', ''),
  client_version text,
  operation      text not null,
  outcome        text not null check (outcome in ('success', 'partial', 'failed')),
  total_ms       integer not null check (total_ms >= 0),
  project_id     text,
  msg_id         text,
  steps          jsonb,
  calls          jsonb,
  detail         jsonb,
  error          text
);

create index if not exists pms_addin_telemetry_created_idx
  on public.pms_addin_telemetry (created_at desc);
create index if not exists pms_addin_telemetry_op_idx
  on public.pms_addin_telemetry (operation, created_at desc);

alter table public.pms_addin_telemetry enable row level security;

-- Any signed-in pane user may append a row (same gate as pms_filing_log).
drop policy if exists addin_telemetry_insert on public.pms_addin_telemetry;
create policy addin_telemetry_insert on public.pms_addin_telemetry
  for insert to authenticated
  with check (coalesce(auth.jwt() ->> 'email', '') <> '');

-- Reading, editing and pruning are admin-only (same gate as pms_mcp_telemetry).
drop policy if exists addin_telemetry_admin_all on public.pms_addin_telemetry;
create policy addin_telemetry_admin_all on public.pms_addin_telemetry
  for all using (is_pms_admin()) with check (is_pms_admin());

-- Useful reads:
--
--   -- how slow is each operation, last 7 days
--   select operation, count(*) as n,
--          round(percentile_cont(0.5)  within group (order by total_ms)) as p50_ms,
--          round(percentile_cont(0.95) within group (order by total_ms)) as p95_ms,
--          max(total_ms) as worst_ms,
--          count(*) filter (where outcome <> 'success') as not_ok
--     from public.pms_addin_telemetry
--    where created_at > now() - interval '7 days'
--    group by operation order by p95_ms desc;
--
--   -- where the time went in the slowest saves
--   select created_at, user_email, operation, total_ms, c->>'label' as call,
--          (c->>'ms')::int as ms, c->>'status' as status
--     from public.pms_addin_telemetry t, jsonb_array_elements(t.calls) c
--    where t.total_ms > 15000
--    order by t.created_at desc, ms desc;
