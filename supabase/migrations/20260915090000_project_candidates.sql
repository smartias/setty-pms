-- Drive discovery queue (2026-09-15): project folders found on a region's
-- network drives that have NO record in pms_projects. The connector fills
-- this table from the Admin console's "Scan" action (it alone holds the
-- share credentials); an admin reviews each candidate there and either
-- creates the PMS record or dismisses the folder. Nothing is created
-- automatically: a project record drives fees, milestones and visibility.
--
-- Keyed by project number: a folder seen on two drives, or on every scan,
-- is one candidate. Existing PMS names are never touched by discovery
-- (a drive folder's name can differ from the PMS name; the PMS wins).
--
-- Rollback: drop table public.pms_project_candidates;

create table if not exists public.pms_project_candidates (
  project_number text primary key,                 -- 'SAPQ256918.06', uppercased
  team text not null references public.pms_regions(team) on delete cascade,
  share_label text not null,                       -- which drive it was found on (first hit)
  drive_path text not null,                        -- UNC-style path people know from the mapped drive
  folder_name text not null,                       -- the project folder's own name
  name_from_folder text,                           -- from the "00-<number> <NAME>" child, when there is one
  year text,                                       -- year folder it sits under (or read off the number)
  status text not null default 'new' check (status in ('new', 'dismissed', 'created')),
  created_project_id text,                         -- pms_projects.id once created from here
  note text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
create index if not exists pms_project_candidates_team_status on public.pms_project_candidates (team, status);

alter table public.pms_project_candidates enable row level security;
drop policy if exists pms_project_candidates_select on public.pms_project_candidates;
create policy pms_project_candidates_select on public.pms_project_candidates
  for select to authenticated using (true);
drop policy if exists pms_project_candidates_admin on public.pms_project_candidates;
create policy pms_project_candidates_admin on public.pms_project_candidates
  as permissive for all to authenticated
  using (is_pms_admin())
  with check (is_pms_admin());
