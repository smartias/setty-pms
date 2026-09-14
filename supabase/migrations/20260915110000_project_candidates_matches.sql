-- Drive discovery: related PMS records (2026-09-15). The NY scan surfaced
-- folders whose number is NOT in the PMS exactly but has a close relative:
-- the PMS carries SAPQ226904.04.01 where the drive folder is SAPQ226904.04
-- (an extra suffix segment), or a sibling task order under the same base
-- number (SAPQ256918.06 on the drive, SAPQ256918.09 in the PMS). The scan
-- now records the closest match so the console can offer "Link to the
-- existing record" instead of a blank Create, and shows the siblings as
-- context. Existing PMS numbers and names are never rewritten.
--
-- Rollback: alter table public.pms_project_candidates
--   drop column pms_match_number, drop column pms_match_name,
--   drop column pms_match_id, drop column pms_match_kind, drop column siblings;

alter table public.pms_project_candidates
  add column if not exists pms_match_number text,   -- the PMS number this folder most likely IS
  add column if not exists pms_match_name text,
  add column if not exists pms_match_id text,       -- pms_projects.id of that record
  add column if not exists pms_match_kind text check (pms_match_kind in ('extends', 'base')),
  add column if not exists siblings text;           -- "SAPQ256918.09 X138 PS138 Energy Modeling; …" same base number in the PMS
