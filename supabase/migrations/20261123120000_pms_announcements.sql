-- One-off announcement emails from the PMS (first use: the Accolade-O-Meter
-- launch), sent by the pms-user-emails edge function, route /announce.
--
-- Who gets one: pms_announce_audience(). A person is included only when all
-- three hold:
--   1. they are on the staff roster (pms_user_roles) with a @setty.com address
--   2. they have signed in to the PMS at least once (auth.users.last_sign_in_at)
--   3. they have PMS email switched on: the weekly digest setting in
--      My Projects -> My Settings (pms_user_prefs.weekly_digest)
-- Nobody else is emailed, so an announcement never reaches someone who has not
-- used the PMS or has not asked it for email.
--
-- pms_announcement_sends is the "already sent" list, one row per announcement
-- and recipient. The function claims a row before sending, so calling the
-- route twice does not email anyone twice. A send that fails gives its row back,
-- so the next call retries that person. Only the service role touches it.

create table if not exists public.pms_announcement_sends (
  key        text not null,
  recipient  text not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  constraint pms_announcement_sends_pkey primary key (key, recipient)
);

alter table public.pms_announcement_sends enable row level security;
revoke all on public.pms_announcement_sends from anon, authenticated;
grant select, insert, update, delete on public.pms_announcement_sends to service_role;

-- check_function_bodies is off for this statement for the same reason as
-- 20261102150000: a fresh replay may not have every table a language-sql body
-- reads, and production resolves them when the function runs.
set check_function_bodies = off;
create or replace function public.pms_announce_audience()
returns table (email text)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select distinct lower(r.email)
  from public.pms_user_roles r
  where r.email ilike '%@setty.com'
    and exists (select 1 from auth.users u
                where lower(u.email) = lower(r.email) and u.last_sign_in_at is not null)
    and exists (select 1 from public.pms_user_prefs p
                where lower(p.email) = lower(r.email) and p.weekly_digest)
  order by 1
$$;
reset check_function_bodies;

revoke all on function public.pms_announce_audience() from public, anon, authenticated;
grant execute on function public.pms_announce_audience() to service_role;
