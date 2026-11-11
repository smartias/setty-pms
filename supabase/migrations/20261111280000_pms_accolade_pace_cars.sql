-- Accolade-O-Meter: pace cars.
--
-- People on this list take part (they score, play, give gifts and are thanked
-- on the wall) but are not ranked: no place in the race standings, no podium,
-- no champion's spot, and their points do not count toward a team average.
-- Meant for firm leadership, so the standings are about the team.
--
-- The list lives on the single settings row, which only PMS admins can update
-- (pms_accolade_settings_update) and every signed-in user can read.
alter table public.pms_accolade_settings
  add column if not exists pace_emails text[] not null default '{}';

alter table public.pms_accolade_settings drop constraint if exists pms_accolade_settings_pace_chk;
alter table public.pms_accolade_settings add constraint pms_accolade_settings_pace_chk
  check (cardinality(pace_emails) <= 50);
