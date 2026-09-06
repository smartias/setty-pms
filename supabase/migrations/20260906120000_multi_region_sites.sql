-- Multi-region SharePoint routing (Raj/Nikhil regional-drives request, 2026-09-06).
--
-- The connector was hard-scoped to the NY SharePoint site. This table maps a
-- project's `team` (a real column on pms_projects: 'NY', 'DC', ...) to its
-- region's site, so each region's project files become first-class the moment
-- its row is added — no deploy needed. The connector falls back to its NY env
-- defaults for any team without an enabled row, so this ships inert.
--
-- Rollback: drop table public.pms_regions; (the connector then behaves exactly
-- as before this migration).

create table if not exists public.pms_regions (
  team text primary key,            -- matches pms_projects.team
  region_name text not null,
  sharepoint_site_id text not null, -- Graph composite id: host,siteGuid,webGuid
  doc_library text not null default 'Project Document Library',
  enabled boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.pms_regions enable row level security;
drop policy if exists pms_regions_select on public.pms_regions;
create policy pms_regions_select on public.pms_regions
  for select to authenticated using (true);
-- No authenticated write policies on purpose: region rows change rarely and
-- are managed with the service role until an admin UI earns its keep. RLS
-- default-deny covers writes.

insert into public.pms_regions (team, region_name, sharepoint_site_id, notes)
values ('NY', 'New York',
  'setty.sharepoint.com,aa580464-13e9-4eb4-8ad4-ca6ff5b9e001,c97a67e8-fb1b-4a23-a29a-753a5d57d410',
  'Seeded from the connector''s previously hard-coded site (multi-region slice, 2026-09-06).')
on conflict (team) do nothing;
