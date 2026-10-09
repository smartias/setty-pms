-- People who call the pms-mcp connector without a pms_user_roles (Staff) row.
-- The connector serves any verified Setty sign-in and resolves an unrostered
-- person to plain "staff" (see pms_caps_for), so this is how they are found.
-- The pms-mcp route /admin/unrostered-alert reads the view, emails the director
-- once per person, and records them in pms_unrostered_alerts.
--
-- Applied live 2026-10-09. The cron job that calls the route is created by
-- copying the pms-drawings-index job (same x-pms-cron secret) so the secret
-- never lands in the repo:
--   select cron.schedule('pms-unrostered-alert', '11,26,41,56 * * * *',
--     replace(command, 'admin/drawings-index', 'admin/unrostered-alert'))
--   from cron.job where jobname = 'pms-drawings-index';

create or replace view public.pms_unrostered_callers
with (security_invoker = true) as
select lower(t.caller_email) as email,
       count(*) as calls,
       min(t.created_at) as first_call,
       max(t.created_at) as last_call,
       (array_agg(distinct t.tool))[1:6] as tools
from public.pms_mcp_telemetry t
where t.caller_email is not null
  and t.caller_email <> '(shared-secret)'
  and not exists (
    select 1 from public.pms_user_roles r where lower(r.email) = lower(t.caller_email)
  )
group by lower(t.caller_email);

revoke all on public.pms_unrostered_callers from anon, authenticated;

create table if not exists public.pms_unrostered_alerts (
  email           text primary key,
  first_alerted_at timestamptz not null default now(),
  calls_at_alert  integer,
  alerted_to      text
);
alter table public.pms_unrostered_alerts enable row level security;
-- No policies: service role only.
