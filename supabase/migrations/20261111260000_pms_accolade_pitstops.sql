-- Accolade-O-Meter: the daily pit stop.
--
-- A second reason to open the page each day: refuel once for a few points and
-- get the day's nudge to thank someone. One row per person per day.
--
-- The row records only that someone stopped. What a stop is worth (1 to 3
-- points) is derived in accolades.js from the email and the date, so a caller
-- cannot choose the amount, and the primary key refuses a second stop.
-- Visibility matches the other accolade tables: every signed-in user reads,
-- people insert only their own, nothing is updated or deleted.

create table if not exists public.pms_accolade_pitstops (
  email      text not null,
  stop_date  date not null,
  created_at timestamptz not null default now(),
  constraint pms_accolade_pitstops_pkey primary key (email, stop_date)
);

alter table public.pms_accolade_pitstops enable row level security;

drop policy if exists pms_accolade_pitstops_select on public.pms_accolade_pitstops;
create policy pms_accolade_pitstops_select on public.pms_accolade_pitstops
  for select to authenticated using (true);

-- stop_date is the person's local day, so allow a day either side of the server's.
drop policy if exists pms_accolade_pitstops_insert on public.pms_accolade_pitstops;
create policy pms_accolade_pitstops_insert on public.pms_accolade_pitstops
  for insert to authenticated
  with check (pms_accolades_caller_email() <> ''
              and email = pms_accolades_caller_email()
              and stop_date between current_date - 1 and current_date + 1);

revoke all on public.pms_accolade_pitstops from anon;
revoke update, delete, truncate, references, trigger on public.pms_accolade_pitstops from authenticated;

-- A one-time bonus for customizing your car. The page pays it in the season the
-- ride was first saved, so that moment has to be kept: created_at is set once
-- and a trigger stops later saves (or a direct API call) from moving it.
alter table public.pms_accolade_cars add column if not exists created_at timestamptz not null default now();

create or replace function public.pms_accolade_cars_keep_created()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists pms_accolade_cars_keep_created on public.pms_accolade_cars;
create trigger pms_accolade_cars_keep_created
  before update on public.pms_accolade_cars
  for each row execute function public.pms_accolade_cars_keep_created();
