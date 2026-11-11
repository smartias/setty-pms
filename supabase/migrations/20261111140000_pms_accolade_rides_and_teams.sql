-- Accolade-O-Meter, round two: each person's chosen ride in the season race,
-- and the team each racer belongs to for the team standings.
--
--   pms_accolade_cheers.gift  what was sent with a cheer (applause, flowers, ...)
--   pms_accolade_cars     one row per person: car color, ride and number
--   pms_accolade_teams()  email -> team for everyone on the staff roster
--
-- Rides are cosmetic and firm-wide readable; a person writes only their own.
--
-- pms_user_roles is readable by admins only, and the page needs to know which
-- team a racer is on. pms_accolade_teams() is security definer and returns
-- only email and team for rows that have a team: no role, no other column.
-- Team membership is already visible to all staff in the PMS staff directory.

-- A cheer becomes a gift. Still one per person per accolade (the primary key);
-- changing your mind is take it back, then send another.
alter table public.pms_accolade_cheers add column if not exists gift text not null default 'clap';
alter table public.pms_accolade_cheers drop constraint if exists pms_accolade_cheers_gift_chk;
alter table public.pms_accolade_cheers add constraint pms_accolade_cheers_gift_chk
  check (gift in ('clap','flowers','trophy','coffee','cake','highfive'));

create table if not exists public.pms_accolade_cars (
  email      text not null,
  color      smallint,           -- index into the page's palette; null = assigned by grid position
  ride       text not null default 'car',
  number     text,
  updated_at timestamptz not null default now(),
  constraint pms_accolade_cars_pkey primary key (email),
  constraint pms_accolade_cars_color_chk check (color is null or color between 0 and 7),
  constraint pms_accolade_cars_ride_chk check (char_length(ride) between 1 and 16),
  constraint pms_accolade_cars_number_chk check (number is null or number ~ '^[A-Za-z0-9]{1,2}$')
);

alter table public.pms_accolade_cars enable row level security;

drop policy if exists pms_accolade_cars_select on public.pms_accolade_cars;
create policy pms_accolade_cars_select on public.pms_accolade_cars
  for select to authenticated using (true);
drop policy if exists pms_accolade_cars_insert on public.pms_accolade_cars;
create policy pms_accolade_cars_insert on public.pms_accolade_cars
  for insert to authenticated
  with check (pms_accolades_caller_email() <> '' and lower(email) = pms_accolades_caller_email());
drop policy if exists pms_accolade_cars_update on public.pms_accolade_cars;
create policy pms_accolade_cars_update on public.pms_accolade_cars
  for update to authenticated
  using (lower(email) = pms_accolades_caller_email())
  with check (lower(email) = pms_accolades_caller_email());

revoke all on public.pms_accolade_cars from anon;
revoke delete, truncate, references, trigger on public.pms_accolade_cars from authenticated;

create or replace function public.pms_accolade_teams()
returns table (email text, team text)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select lower(r.email), r.team
  from public.pms_user_roles r
  where coalesce(btrim(r.team), '') <> ''
$$;

revoke all on function public.pms_accolade_teams() from public, anon;
grant execute on function public.pms_accolade_teams() to authenticated, service_role;
