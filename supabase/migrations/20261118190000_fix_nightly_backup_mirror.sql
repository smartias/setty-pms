-- Fix backups.snapshot_daily(), the nightly backup run by pg_cron job
-- "pms-nightly-backup" (07:00 UTC).
--
-- It failed every night from 2026-10-21 to 2026-11-18. The email mirror step
-- was `insert into backups.pms_project_emails_mirror select e.*, now() ...`;
-- when embedding / embedded_at / embedded_hash were added to
-- public.pms_project_emails the column counts stopped matching ("INSERT has
-- more expressions than target columns"). Because that step ran first, the
-- dated snapshots of the core tables and the 14-day retention never ran either.
--
-- Changes:
--   1. Snapshots and retention run FIRST, so a problem in the email mirror can
--      no longer take the core-table snapshots down with it.
--   2. The mirror insert names its columns (embeddings are derived data and are
--      not mirrored), so adding a column to the live table cannot break it.
--   3. The mirror step is isolated: an error there is reported in the return
--      text and as a WARNING instead of rolling back the snapshots.
--   4. TEMPORARY, remove once the disk has room: the mirror catches up on its
--      ~8,700-email / ~3.2 GB backlog in bounded nightly batches (oldest first,
--      about 300 MB of HTML per run) and pauses while the database is above
--      9,400 MB. On 2026-11-18 the 12 GB disk was 88% full and could not grow
--      (spend cap), so an unbounded catch-up would have filled it.
--
-- Idempotent (create or replace): safe to re-run. The function was originally
-- created directly in the database and had no migration in this repo.

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
  -- TEMPORARY catch-up limits (see migration header).
  mirror_batch_bytes constant bigint := 300 * 1024 * 1024;
  mirror_pause_above constant bigint := 9400::bigint * 1024 * 1024;
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
