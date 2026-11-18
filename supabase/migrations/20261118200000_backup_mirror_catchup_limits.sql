-- Raise the email-mirror catch-up limits in backups.snapshot_daily().
--
-- The database disk was grown from 12 GB to 20 GB on 2026-11-18 (spend cap
-- disabled), so the nightly mirror catch-up no longer has to be held to
-- ~300 MB a run with a pause above 9,400 MB. It now copies up to ~1 GB of
-- email HTML a night and pauses only above 16 GB, which leaves ~4 GB free.
-- The backlog on that day was ~7,055 emails / 2.9 GB: about three nights.
--
-- Still batched on purpose: one 2.9 GB copy would drain the disk IO budget.
-- The function body is otherwise identical to 20261118190000. Idempotent.

create schema if not exists backups;

create or replace function backups.snapshot_daily()
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'backups', 'pg_catalog'
as $function$
declare
  t text;
  snap text;
  new_rows bigint := 0;
  dropped int := 0;
  today text := to_char(now(), 'YYYYMMDD');
  r record;
  mirror_note text;
  db_bytes bigint;
  -- Catch-up limits (see migration header); sized for the 20 GB disk.
  mirror_batch_bytes constant bigint := 1024 * 1024 * 1024;
  mirror_pause_above constant bigint := 16384::bigint * 1024 * 1024;
  tables text[] := array[
    'pms_projects','pms_clients','pms_meta',
    'pms_rfis','pms_rfi_events','pms_submittals','pms_submittal_events',
    'pms_email_thread_tags','pms_email_watchlist','pms_filing_log',
    'pms_lessons','pms_best_practices','pms_agency_preferences'
  ];
begin
  -- 1) Dated snapshots of the small core tables (re-runnable same day).
  foreach t in array tables loop
    snap := format('snap_%s_%s', t, today);
    execute format('drop table if exists backups.%I', snap);
    execute format('create table backups.%I as select * from public.%I', snap, t);
  end loop;

  -- 2) Retention: drop dated snapshots older than 14 days.
  for r in
    select tablename from pg_tables
    where schemaname = 'backups'
      and tablename like 'snap\_%' escape '\'
      and right(tablename, 8) ~ '^[0-9]{8}$'
      and to_date(right(tablename, 8), 'YYYYMMDD') < current_date - 14
  loop
    execute format('drop table backups.%I', r.tablename);
    dropped := dropped + 1;
  end loop;

  -- 3) Append new emails to the delete-proof mirror (never updates, never
  --    deletes). Explicit columns; isolated so a failure keeps steps 1-2.
  begin
    db_bytes := pg_database_size(current_database());
    if db_bytes > mirror_pause_above then
      mirror_note := format('emails mirror PAUSED (database %s is above the %s catch-up limit)',
                            pg_size_pretty(db_bytes), pg_size_pretty(mirror_pause_above));
    else
      insert into backups.pms_project_emails_mirror (
        record_id, project_id, msg_id, conversation_id, subject, from_name, from_address,
        email_date, saved_at, sp_folder_url, saved_to_sharepoint, created_at,
        body_html_compressed, body_html_size, body_text, attachment_names, has_attachments,
        to_addresses, cc_addresses, preview, saved_by, migrated_from_v5, direction, search_tsv,
        mirrored_at)
      select
        e.record_id, e.project_id, e.msg_id, e.conversation_id, e.subject, e.from_name, e.from_address,
        e.email_date, e.saved_at, e.sp_folder_url, e.saved_to_sharepoint, e.created_at,
        e.body_html_compressed, e.body_html_size, e.body_text, e.attachment_names, e.has_attachments,
        e.to_addresses, e.cc_addresses, e.preview, e.saved_by, e.migrated_from_v5, e.direction, e.search_tsv,
        now()
      from public.pms_project_emails e
      join (
        select p.record_id,
               sum(coalesce(pg_column_size(p.body_html_compressed), 0))
                 over (order by p.saved_at, p.record_id) as running,
               coalesce(pg_column_size(p.body_html_compressed), 0) as sz
        from public.pms_project_emails p
        where not exists (select 1 from backups.pms_project_emails_mirror m where m.record_id = p.record_id)
      ) q on q.record_id = e.record_id
      where q.running - q.sz < mirror_batch_bytes   -- always takes at least one row
      on conflict (record_id) do nothing;
      get diagnostics new_rows = row_count;
      mirror_note := format('emails mirror +%s rows', new_rows);
    end if;
  exception when others then
    mirror_note := 'emails mirror FAILED: ' || sqlerrm;
    raise warning 'backups.snapshot_daily: %', mirror_note;
  end;

  return format('%s; %s tables snapshotted; %s expired snapshots dropped',
                mirror_note, array_length(tables, 1), dropped);
end
$function$;
