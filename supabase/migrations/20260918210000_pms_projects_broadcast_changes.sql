-- Broadcast pms_projects row changes to per-project Realtime channels, so
-- an open PMS tab can show "this project was updated elsewhere" instead of
-- only discovering it at save-time via the version-conflict check.
--
-- Spiked and validated end-to-end on 2026-09-18 (trigger fires correctly,
-- delivery confirmed live in a browser via a scoped test policy — see
-- pms_projects_broadcast_changes_spike / _v2 in the migration history).
--
-- Policy mirrors the existing pms_projects_select RLS policy exactly
-- (FOR SELECT TO authenticated USING (true)) — any signed-in user can
-- already read any project's data via REST today, so granting the same
-- population read access to its change notifications is not a broader
-- exposure than what already exists.
create policy "authenticated can receive pms_projects broadcasts"
on "realtime"."messages"
for select
to authenticated
using ( true );

create or replace function public.pms_projects_broadcast_changes()
returns trigger
security definer set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'pms_projects:' || coalesce(new.id, old.id)::text,  -- topic
    tg_op,                                               -- event
    tg_op,                                               -- operation
    tg_table_name,                                       -- table
    tg_table_schema,                                     -- schema
    new,                                                  -- new record
    old                                                   -- old record
  );
  return null;
end;
$$ language plpgsql;

create trigger pms_projects_broadcast_changes_trigger
after insert or update or delete on public.pms_projects
for each row
execute function public.pms_projects_broadcast_changes();
