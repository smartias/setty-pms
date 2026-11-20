-- Off-site backup: bookkeeping and alerting.
--
-- The nightly "Off-site backup" GitHub Actions workflow
-- (.github/workflows/backup.yml) dumps the database and uploads the files to a
-- SharePoint folder through the connector (pms-mcp /admin/backup/*). This
-- migration adds:
--
--   pms_backup_runs     one row per run, written by the workflow with its own
--                       database connection (RLS on, no policies: not readable
--                       through the API).
--   'backup-upload'     a random token in pms_integration_secrets. The workflow
--                       reads it over the same connection and sends it to the
--                       connector, so GitHub stores only the database URL.
--   pms_cron_problems() a fourth check, 'backup-offsite-stale': no successful
--                       run in 30 hours. It stays silent until the first run is
--                       recorded. pms-cron-alert emails it like the others.
--
-- Also fixes check 2 of pms_cron_problems(), which errored instead of skipping
-- on a database without pg_cron (preview branches; production has it).
--
-- Restore steps: docs/RESTORE.md. Idempotent: safe to re-run.

create table if not exists public.pms_backup_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean not null default false,
  files       jsonb not null default '[]'::jsonb,  -- [{path, bytes}]
  bytes       bigint not null default 0,
  note        text,
  run_url     text                                 -- the GitHub Actions run
);
alter table public.pms_backup_runs enable row level security;
-- No policies: written and read by the workflow's direct connection and by
-- pms_cron_problems() (security definer) only.
revoke all on public.pms_backup_runs from anon, authenticated;

-- 64 hex characters from two random UUIDs (gen_random_uuid is built in and
-- uses a strong random source). Kept if it already exists.
-- The table was created by hand in production and is absent on preview
-- branches built from this folder, hence the guard.
do $secret$
begin
  if to_regclass('public.pms_integration_secrets') is not null then
    insert into public.pms_integration_secrets (name, token)
    values ('backup-upload', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    on conflict (name) do nothing;
  end if;
end
$secret$;

create or replace function public.pms_cron_problems()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  out jsonb := '[]'::jsonb;
  snap text;
  bad bigint;
  total bigint;
  kinds text;
begin
  -- 1) Jobs whose most recent finished run failed.
  if to_regclass('cron.job_run_details') is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', 'job:' || x.jobname,
             'title', 'Scheduled job "' || x.jobname || '" is failing',
             'detail', x.msg,
             'since', x.start_time,
             'schedule', x.schedule,
             'fails_24h', x.fails_24h) order by x.jobname), '[]'::jsonb)
      into out
    from (
      select j.jobname, j.schedule, l.start_time, left(coalesce(l.return_message, ''), 600) as msg,
             (select count(*) from cron.job_run_details f
               where f.jobid = j.jobid and f.status = 'failed'
                 and f.start_time > now() - interval '24 hours') as fails_24h
      from (
        select distinct on (d.jobid) d.jobid, d.status, d.start_time, d.return_message
        from cron.job_run_details d
        where d.start_time > now() - interval '8 days'
          and d.status in ('succeeded', 'failed')
        order by d.jobid, d.start_time desc
      ) l
      join cron.job j on j.jobid = l.jobid
      where j.active and l.status = 'failed'
    ) x;
  end if;

  -- 2) Backup freshness: newest dated snapshot of pms_projects. Only where the
  --    nightly backup is scheduled (a preview branch has no such job).
  -- (Nested IFs, not "and": PL/pgSQL plans the whole condition, so naming
  -- cron.job in the same expression errors where pg_cron is not installed.)
  if to_regclass('cron.job') is not null then
   if exists (select 1 from cron.job where jobname = 'pms-nightly-backup') then
    select max(substring(tablename from '(\d{8})$')) into snap
    from pg_tables
    where schemaname = 'backups' and tablename like 'snap\_pms\_projects\_%';
    if snap is null or snap < to_char((now() at time zone 'utc')::date - 1, 'YYYYMMDD') then
      out := out || jsonb_build_object(
        'key', 'backup-stale',
        'title', 'The nightly backup has not produced a snapshot since ' || coalesce(snap, 'ever'),
        'detail', 'Newest backups.snap_pms_projects_<date> table: ' || coalesce(snap, 'none')
                  || '. Expected one from yesterday or today (UTC). Check the pms-nightly-backup job in cron.job and backups.snapshot_daily().');
    end if;
   end if;
  end if;

  -- 3) Background HTTP calls (pg_net keeps about 6 hours of answers).
  if to_regclass('net._http_response') is not null then
    select count(*) filter (where r.status_code >= 400 or r.timed_out or r.error_msg is not null), count(*)
      into bad, total
    from net._http_response r
    where r.created > now() - interval '1 hour';
    if bad >= 20 then
      select string_agg(s, ', ') into kinds from (
        select coalesce(r.status_code::text, 'no answer / timeout') || ' x' || count(*) as s
        from net._http_response r
        where r.created > now() - interval '1 hour'
          and (r.status_code >= 400 or r.timed_out or r.error_msg is not null)
        group by r.status_code
        order by count(*) desc
      ) q;
      out := out || jsonb_build_object(
        'key', 'http-calls',
        'title', bad || ' of ' || total || ' background calls to the edge functions failed in the last hour',
        'detail', 'By answer: ' || kinds || '. pg_cron still marks these jobs "succeeded" because the call was queued. '
                  || 'Check the edge function logs (pms-mcp, pms-user-emails) for the same hour.');
    end if;
  end if;

  -- 4) Off-site backup (added 2026-11-21): the GitHub Actions job records each
  --    run in pms_backup_runs. Silent until the first run has been recorded,
  --    so a database without the job set up does not alert.
  if to_regclass('public.pms_backup_runs') is not null
     and exists (select 1 from public.pms_backup_runs) then
    if not exists (select 1 from public.pms_backup_runs
                   where ok and finished_at > now() - interval '30 hours') then
      out := out || jsonb_build_object(
        'key', 'backup-offsite-stale',
        'title', 'No off-site backup has reached SharePoint in the last 30 hours',
        'detail', coalesce((
          select 'Last run: started ' || to_char(started_at, 'YYYY-MM-DD HH24:MI') || ' UTC, '
                 || case when finished_at is null then 'never finished'
                         when ok then 'succeeded'
                         else 'failed: ' || left(coalesce(note, ''), 400) end
          from public.pms_backup_runs order by started_at desc limit 1), 'no runs')
          || '. Check the "Off-site backup" workflow in GitHub Actions; docs/RESTORE.md explains the files.');
    end if;
  end if;

  return out;
end;
$function$;

revoke all on function public.pms_cron_problems() from public, anon, authenticated;
grant execute on function public.pms_cron_problems() to service_role;
