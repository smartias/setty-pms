-- Background-call failures, 2026-11-25 (cron-alert "http-calls": 546 x16,
-- timeouts x3, 500 x1 in one hour).
--
-- 1) pms-documents-sync ran every 15 minutes and each run took 80-120 s,
--    sometimes past pg_net's 120 s and the edge runtime's ~150 s limit. Calls
--    that shared its worker failed with 546 WORKER_RESOURCE_LIMIT. The function
--    now does less per run (docsSyncPlan.ts: no new scope after 40 s, a big
--    project alone), so it runs every 5 minutes instead. Minutes :00/:05/...
--    are not used by the other HTTP jobs (2/17/32/47, 7/22/37/52, 9/24/...,
--    11/26/..., 13/28/...).
--
-- 2) documents-sync also called pms_ca_items_reconcile() over all ~600
--    projects through PostgREST, where service_role has statement_timeout=8s.
--    It timed out on every run, so the drift repair never ran. It moves to its
--    own pg_cron job with a 5-minute timeout. Hourly: it is a safety net (the
--    projection trigger keeps rows current on save), and the pass reads every
--    pms_projects row, which is heavy.

-- Summary wrapper, so a cron run leaves a readable line in the Postgres log
-- when it repairs or fails something. Per-project errors are caught inside
-- pms_ca_items_reconcile (one bad project does not roll back the rest).
create or replace function public.pms_ca_items_reconcile_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_projects int := 0;
  n_written int := 0;
  repaired text[] := '{}';
  failed text[] := '{}';
  r record;
begin
  for r in select * from public.pms_ca_items_reconcile() loop
    n_projects := n_projects + 1;
    if r.error is not null then
      failed := failed || (r.project_row_id || ': ' || r.error);
    elsif coalesce(r.written, 0) > 0 then
      n_written := n_written + r.written;
      repaired := repaired || r.project_row_id;
    end if;
  end loop;
  if cardinality(failed) > 0 then
    raise warning '[pms-ca-items-reconcile] % project(s) failed: %',
      cardinality(failed), left(array_to_string(failed[1:20], '; '), 2000);
  end if;
  if n_written > 0 then
    raise log '[pms-ca-items-reconcile] wrote % row(s) for: %',
      n_written, left(array_to_string(repaired[1:20], ', '), 1000);
  end if;
  return jsonb_build_object(
    'projects', n_projects, 'written', n_written,
    'repaired', to_jsonb(repaired[1:20]), 'failed', to_jsonb(failed[1:20]));
end
$$;

revoke all on function public.pms_ca_items_reconcile_all() from public, anon, authenticated;
grant execute on function public.pms_ca_items_reconcile_all() to service_role;

do $cron$
declare
  j bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed: schedules unchanged.';
    return;
  end if;

  -- (1) documents-sync every 5 minutes. Only the schedule changes; the job's
  --     command (URL, secret header, 120 s timeout) is left as it is.
  select jobid into j from cron.job where jobname = 'pms-documents-sync';
  if j is not null then
    perform cron.alter_job(job_id := j, schedule := '*/5 * * * *');
  else
    raise notice 'pms-documents-sync not scheduled here: nothing to reschedule.';
  end if;

  -- (2) CA projection drift repair, hourly at :45 (cron.schedule by name
  --     replaces an existing job of the same name).
  perform cron.schedule(
    'pms-ca-items-reconcile',
    '45 * * * *',
    $cmd$set statement_timeout = '5min'; select public.pms_ca_items_reconcile_all();$cmd$
  );
end
$cron$;
