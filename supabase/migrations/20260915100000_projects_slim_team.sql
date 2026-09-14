-- Region filter in the PMS app (2026-09-15): the app loads projects through
-- pms_projects_slim (the blob minus emails[]); it now also carries the
-- `team` column so the list, Pipeline and Dashboard can filter by region.
-- team stays a real column (the Admin console's Teams card and the drive
-- discovery queue write it); the app attaches it to the in-memory blob on
-- load and strips it again on save.
--
-- Rollback: create or replace view public.pms_projects_slim with
-- (security_invoker = on) as select id, project - 'emails' as project,
-- version, updated_at from public.pms_projects;

create or replace view public.pms_projects_slim with (security_invoker = on) as
  select id, project - 'emails'::text as project, version, updated_at, team
  from public.pms_projects;
