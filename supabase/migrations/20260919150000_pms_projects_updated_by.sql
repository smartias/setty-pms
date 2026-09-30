-- Phase 2 of the realtime "project updated elsewhere" banner
-- (see 20260918210000_pms_projects_broadcast_changes.sql): lets the banner
-- say WHO changed a project, not just that it changed.
--
-- Plain column, no backfill needed — existing rows simply have no author
-- on record for their last save, same as before this column existed.
alter table public.pms_projects
  add column if not exists updated_by text;
