-- Region drive shares (2026-09-14): a region may carry MORE THAN ONE network-
-- drive annex — DC keeps project folders on both its I: and W: drives — each
-- with its own label, share URL and SAS secret NAME. Item ids name the share
-- as az:<TEAM>.<LABEL>:<path>.
--
-- The single-share columns on pms_regions (azure_share_url, azure_sas_env)
-- stay for one release as a fallback: the connector prefers this table when
-- it has rows for the team, and the console keeps writing the FIRST share
-- into the legacy columns so an older connector build keeps working until
-- it is redeployed. Drop them once every environment runs 1.15.0+.
--
-- Rollback: drop table public.pms_region_shares;

create table if not exists public.pms_region_shares (
  id bigserial primary key,
  team text not null references public.pms_regions(team) on delete cascade,
  label text not null check (label ~ '^[A-Z0-9]{1,12}$'),   -- 'I', 'W', 'SAP': what people call the drive
  share_url text not null,                                  -- https://<account>.file.core.windows.net/<share>[/folder]
  sas_env text not null check (sas_env ~ '^[A-Z][A-Z0-9_]*$'), -- NAME of the Edge Function secret; never the token
  enabled boolean not null default true,
  sort_order int not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  unique (team, label)
);

alter table public.pms_region_shares enable row level security;
drop policy if exists pms_region_shares_select on public.pms_region_shares;
create policy pms_region_shares_select on public.pms_region_shares
  for select to authenticated using (true);
-- Same posture as pms_regions: everyone signed-in reads, admins write.
drop policy if exists pms_region_shares_admin on public.pms_region_shares;
create policy pms_region_shares_admin on public.pms_region_shares
  as permissive for all to authenticated
  using (is_pms_admin())
  with check (is_pms_admin());

-- Seed from the single-share columns, labelled by the drive or folder people
-- already call it by.
insert into public.pms_region_shares (team, label, share_url, sas_env, sort_order, notes)
select team,
  case team when 'DC' then 'I' when 'NY' then 'SAP' when 'BT' then 'SAOP' else 'DRIVE' end,
  azure_share_url, azure_sas_env, 0,
  'Seeded from the pms_regions single-share columns (14 Sep 2026).'
from public.pms_regions
where azure_share_url is not null and azure_sas_env is not null
on conflict (team, label) do nothing;

-- DC's second drive: W: (SA_Private_Projects), secret AZURE_SAS_W loaded 14 Sep 2026.
insert into public.pms_region_shares (team, label, share_url, sas_env, sort_order, notes)
select 'DC', 'W', 'https://ffxfilestorage.file.core.windows.net/ffxfileshare/SA_Private_Projects', 'AZURE_SAS_W', 1,
  'W: drive, the private-projects share (14 Sep 2026). Same ffxfilestorage account as the I: drive.'
where exists (select 1 from public.pms_regions where team = 'DC')
on conflict (team, label) do nothing;
