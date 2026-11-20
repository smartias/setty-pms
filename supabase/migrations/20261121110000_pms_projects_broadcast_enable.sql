-- Turn on the "project updated elsewhere" banner in production.
--
-- 20260918210000_pms_projects_broadcast_changes.sql is recorded as applied but
-- was never run in production (its September spike was rolled back). This
-- migration does the same job, idempotently, with two changes:
--
--   1. The trigger sends only what the banner reads (id, version, updated_by)
--      instead of realtime.broadcast_changes(), which sends the whole old and
--      new row. pms_projects rows reach ~1.1 MB, so a full-row broadcast could
--      put ~2.3 MB into realtime.messages on every save. The payload keeps the
--      { record: {...} } shape subscribePmsProjectUpdates() in SettyPMS.html
--      reads, so the page needs no change.
--   2. The read policy on realtime.messages covers only pms_projects:* topics,
--      not every private topic in the project.
--
-- Who can receive: any signed-in user, matching pms_projects_select
-- (FOR SELECT TO authenticated USING (true)): they can already read the row.
--
-- Only UPDATE is broadcast; the page listens for nothing else.
-- realtime.send() catches its own errors, so a failed broadcast never blocks a
-- save.

drop policy if exists "authenticated can receive pms_projects broadcasts"
  on realtime.messages;

create policy "authenticated can receive pms_projects broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) like 'pms_projects:%'
);

create or replace function public.pms_projects_broadcast_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'record', jsonb_build_object(
        'id', new.id,
        'version', new.version,
        'updated_by', new.updated_by
      ),
      'operation', tg_op
    ),
    tg_op,                          -- event ('UPDATE')
    'pms_projects:' || new.id,      -- topic
    true                            -- private: needs the policy above
  );
  return null;
end;
$$;

revoke all on function public.pms_projects_broadcast_changes() from public, anon, authenticated;

drop trigger if exists pms_projects_broadcast_changes_trigger on public.pms_projects;

create trigger pms_projects_broadcast_changes_trigger
after update on public.pms_projects
for each row
execute function public.pms_projects_broadcast_changes();
