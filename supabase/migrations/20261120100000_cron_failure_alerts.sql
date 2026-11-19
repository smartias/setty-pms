-- Email an alert when a scheduled (pg_cron) job is failing.
--
-- Why: the nightly backup failed every night from 2026-10-21 to 2026-11-18 and
-- nobody was told; it was found by reading cron.job_run_details by hand.
--
-- How it fits together:
--   pg_cron "pms-cron-alert" (every 15 min)
--     -> POST pms-user-emails/cron-alert          (edge function, x-pms-cron)
--        -> public.pms_cron_problems()             (this file: what is wrong now)
--        -> one email via Resend listing the problems not alerted in the last 20 h
--        -> public.pms_cron_alerts                 (this file: remembers what was sent)
--
-- What counts as a problem:
--   job:<name>     an active job whose MOST RECENT finished run failed. A single
--                  blip on an every-minute job has succeeded again by the next
--                  check and is not reported; a nightly job stays "failing"
--                  until its next good run.
--   backup-stale   no dated snapshot of pms_projects from yesterday or today
--                  (UTC) in the backups schema. This checks the RESULT, so it
--                  also catches the backup job being unscheduled or disabled.
--   http-calls     20 or more failed background HTTP calls in the last hour.
--                  Most jobs only enqueue an HTTP call to an edge function, and
--                  pg_cron records "succeeded" once the call is queued, whatever
--                  the function answers. pg_net does not keep which job made a
--                  call, so this can say "a lot is failing" (a function is down,
--                  a secret was rotated) but not which job. Normal background
--                  noise is a handful of 546 (worker limit) answers per hour.
--
-- Limits, on purpose: the checker itself runs on pg_cron, so it cannot report
-- pg_cron being down as a whole; and each problem emails at most once per 20 h.
--
-- Idempotent: safe to re-run.

create table if not exists public.pms_cron_alerts (
  key             text primary key,          -- 'job:<jobname>', 'backup-stale', 'http-calls'
  last_alerted_at timestamptz not null default now(),
  alerted_to      text,
  detail          text
);
alter table public.pms_cron_alerts enable row level security;
-- No policies: service role only.

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
  if to_regclass('cron.job') is not null
     and exists (select 1 from cron.job where jobname = 'pms-nightly-backup') then
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

  return out;
end;
$function$;

revoke all on function public.pms_cron_problems() from public, anon, authenticated;
grant execute on function public.pms_cron_problems() to service_role;

-- The job. The x-pms-cron value is read from pms_integration_secrets when the
-- job RUNS (same row the Monday digest uses), so the secret is not stored in
-- this repo or in the job, and rotating it needs no change here. Skipped where
-- pg_cron/pg_net or that row is missing (preview branches), so a preview
-- database never calls production.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net')
     and to_regclass('public.pms_integration_secrets') is not null then
    if exists (select 1 from public.pms_integration_secrets where name = 'user-emails-cron') then
      perform cron.schedule(
        'pms-cron-alert',
        '13,28,43,58 * * * *',
        $cmd$
        select net.http_post(
          url := 'https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-user-emails/cron-alert',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-pms-cron', (select token from public.pms_integration_secrets where name = 'user-emails-cron')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
        $cmd$
      );
    else
      raise notice 'user-emails-cron secret not present: pms-cron-alert not scheduled.';
    end if;
  else
    raise notice 'pg_cron / pg_net / pms_integration_secrets missing: pms-cron-alert not scheduled.';
  end if;
end
$cron$;
