-- Portfolio heatmap: compute in the background, serve from a cache.
--
-- Why: pms_portfolio_heatmap() scans 30 days of email (volume + open-question
-- regexes) and 90 days of email bodies (payment-risk regexes) for every active
-- project on EVERY page load. As the email archive grew it crossed the
-- authenticated role's statement timeout (2026-11-02: "57014 canceling
-- statement due to statement timeout" on the Heat Map tab).
--
-- Shape of the fix:
--   pms_portfolio_heatmap_compute()  the original body, VERBATIM (read from
--                                    production 2026-11-02), unchanged logic.
--   pms_portfolio_heatmap_cache      one row: the last computed result.
--   pms_portfolio_heatmap_refresh()  recomputes into the cache; run by pg_cron
--                                    every 15 minutes with a generous timeout.
--   pms_portfolio_heatmap()          same name and return shape the client
--                                    already calls: serves the cache, falls
--                                    back to computing live when no cache row
--                                    is visible (anon callers, or before the
--                                    first refresh) - i.e. exactly today's
--                                    behavior for those callers.
--   pms_portfolio_heatmap_asof()     when the cache was computed, for the UI.
--
-- Visibility: the refresh runs as the function owner and sees every row. The
-- cache is select-to-authenticated only, matching pms_projects (authenticated
-- using true) and pms_project_emails (select granted to authenticated): a
-- signed-in user already sees every project's data in the live computation.
-- Signed-out callers never read the cache; they keep the invoker-rights live
-- computation and see what RLS lets them see today.

-- 1. The original computation, renamed. Body unchanged.
create or replace function public.pms_portfolio_heatmap_compute()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
with proj as (
  select slug, num, name, agency, status, bldg_cat
  from pms_project_index
  where coalesce(num,'') <> ''
    and status !~* 'proposal|lost|cancel|completed'
),
activity as (
  select e.project_id, count(*)::int as n
  from pms_project_emails e
  join proj p on p.slug = e.project_id
  where e.email_date > now() - interval '30 days'
  group by 1
),
pay as (
  select project_id,
         count(distinct thread_key)::int as flags,
         max(email_date)::date as last_date,
         (array_agg(subject order by email_date desc))[1] as subj
  from (
    select e.project_id, coalesce(e.conversation_id, e.subject) as thread_key,
           e.subject, e.email_date,
           lower(regexp_replace(left(coalesce(e.body_text, e.preview,''), 2500),
               '(?is)(from:[[:space:]]|on .{0,60}wrote:|-----original|sent from my|you don''t often get email).*','','g')) as head
    from pms_project_emails e
    join proj p on p.slug = e.project_id
    where e.email_date > now() - interval '90 days'
      and (e.subject || ' ' || left(coalesce(e.body_text, e.preview,''), 2500)) ~* '(paid|payment|invoice|balance|\ybill)'
  ) c
  where (subject || ' ' || head) ~* '(unpaid|non.?payment|(have|has|was|were) not (yet )?(been )?paid|(hasn|haven)''?t (been )?paid|(outstanding|past.?due|overdue|delinquent) (invoice|payment|balance|bill)|(invoice|payment)s? (is|are|remains?|still) (outstanding|past.?due|overdue|unpaid|open|due)|await(ing)? payment|waiting (on|for) (the )?payment|payment (delay|has been held|not received|is late)|no payment (has been )?received|(suspend|pause|stop)\w* (work|services)[^.]{0,80}(payment|invoice|paid)|(payment|invoice|paid)[^.]{0,80}(suspend|pause|stop)\w* (work|services))'
    and head !~* '(will process (the )?payment|processing payment|payment (was|has been) (made|sent|processed|issued|deposited|approved)|payment received|received payment)'
  group by 1
),
latest as (
  select distinct on (e.project_id, e.conversation_id)
    e.project_id, e.from_address, e.email_date, e.direction, e.subject, e.body_text, e.preview
  from pms_project_emails e
  join proj p on p.slug = e.project_id
  where e.conversation_id is not null
    and e.email_date > now() - interval '30 days'
  order by e.project_id, e.conversation_id, e.email_date desc nulls last
),
scored as (
  select project_id, email_date,
         lower(regexp_replace(coalesce(body_text, preview,''),
             '(?is)(from:[[:space:]]|on .{0,60}wrote:|-----original|sent from my|you don''t often get email).*','','g')) as bhead,
         lower(coalesce(subject,'')) as subj
  from latest
  where direction = 'incoming' and coalesce(from_address,'') not ilike '%@setty%'
),
open_email as (
  select project_id,
         count(*)::int as n,
         count(*) filter (where (subj||' '||bhead) ~ 'urgent|\yasap\y|immediately|deadline|past due|overdue|time.?sensitive|please provide a date|when can (we|i) expect')::int as urgent,
         max(now()::date - email_date::date)::int as oldest
  from scored
  where (subj||' '||bhead) ~ '\?|please (advise|provide|confirm|send|clarify|let us know|review)|awaiting|still (waiting|need|outstanding)|when (can|will|do|should)|\yeta\y|follow ?up|checking in|provide a date|status (of|update|on)|any (update|revision|questions)|can you (please|provide|confirm|send)|need(ed)? (this|your|the|by)|kindly (provide|advise|send)'
    and bhead !~ '^\s*(ok(ay)?\y|thank|thx\y|got it|received|all set|sounds good|perfect|will do|noted|great\y|no problem|you''?re welcome|my pleasure|understood)'
    and (subj||' '||bhead) !~ 'awarded to another|another bidder|out of office|automatic reply|subconsultant agreement|will process payment|process the payment|processing payment|thanks for sending|thank you for sending|we will review|we.ll review and|i will send|i.ll send|please find attached the weekly|shared the folder|i.ll send .{0,20}invite|send .{0,15}(teams|meeting|calendar).{0,12}invit'
    and subj !~* 'invoice|statement|remittance|w-?9|insurance cert|shared the folder|shared .+ with you|weekly update|weekly project update'
  group by 1
),
rfi as (
  select project_number,
         count(*) filter (where status is distinct from 'Closed')::int as open,
         count(*) filter (where status ilike '%overdue%')::int as overdue
  from pms_rfis group by 1
),
rfifr as (
  select project_number,
         count(*) filter (where received > now()::date - 60)::int as r60,
         count(*) filter (where received > now()::date - 365)::int as r12,
         count(*) filter (where received > now()::date - 365
           and length(resp) between 1 and 400
           and resp ~* '(refer to|see) (the )?(contract |latest )?(drawing|sheet|detail|note|spec|plan)|as (shown|indicated|noted|specified)|already (specified|shown|indicated|addressed|answered|provided)|previously (answered|addressed|provided)'
           and resp !~* 'attach|sketch|bulletin|revised|will be issued|\ysk-')::int as friv
  from (
    select project_number, received,
           trim(regexp_replace(coalesce(answer,''), '(?is)^.*?\mresponse:\s*', '')) as resp
    from pms_rfis
    where received > now()::date - 365
  ) r
  group by 1
),
sub as (
  select project_number,
         count(*) filter (where status is distinct from 'Closed')::int as open,
         count(*) filter (where status ilike '%overdue%')::int as overdue
  from pms_submittals group by 1
),
ar_latest as (
  select max(as_of) as d from pms_ar_invoices
),
arp as (
  select a.project_base,
         sum(a.amount_due)::numeric(12,2) as due,
         max(a.days_overdue)::int as days,
         min(a.client) as client
  from pms_ar_invoices a, ar_latest
  where a.as_of = ar_latest.d
  group by 1
),
arc as (
  select a.client,
         sum(a.amount_due)::numeric(12,2) as due,
         max(a.days_overdue)::int as days,
         count(distinct a.project_base)::int as projs
  from pms_ar_invoices a, ar_latest
  where a.as_of = ar_latest.d
  group by 1
),
risk as (
  select project_id,
         count(*) filter (where category='scope_risk' and severity='high')::int as high,
         count(*) filter (where category='scope_risk' and severity='medium')::int as med,
         count(*) filter (where category='scope_risk' and severity='low')::int as low,
         count(*) filter (where category='open_request')::int as reqs
  from pms_project_analysis where status <> 'resolved' group by 1
),
acts as (
  select pj.id as slug,
         count(*) filter (where a.is_open)::int as open,
         count(*) filter (where a.is_open
           and a.due_txt ~ '^\d{4}-\d{2}-\d{2}'
           and left(a.due_txt,10)::date < now()::date)::int as overdue
  from pms_projects pj
  join proj pr on pr.slug = pj.id
  cross join lateral (
    select coalesce(nullif(el->>'actionStatus',''), nullif(el->>'status',''), 'open') <> 'done' as is_open,
           coalesce(nullif(el->>'actionDueDate',''), nullif(el->>'dueDate',''), '') as due_txt
    from jsonb_array_elements(coalesce(pj.project->'notes','[]'::jsonb)) el
    where el->>'actionItem' = 'true'
  ) a
  group by 1
),
ms as (
  select pj.id as slug,
         count(*) filter (where
           not (lower(coalesce(m.mstat,'')) = 'completed' or m.pct >= 100)
           and (coalesce(m.mstat,'') <> '' or m.pct > 0)
           and m.due < now()::date)::int as overdue,
         count(*) filter (where
           not (lower(coalesce(m.mstat,'')) = 'completed' or m.pct >= 100)
           and m.due >= now()::date
           and m.due <= now()::date + 30)::int as due_30d,
         min(m.due) filter (where
           not (lower(coalesce(m.mstat,'')) = 'completed' or m.pct >= 100)
           and m.due >= now()::date) as next_due
  from pms_projects pj
  join proj pr on pr.slug = pj.id
  cross join lateral (
    select nullif(el->>'status','') as mstat,
           coalesce((el->>'pctComplete')::numeric, 0) as pct,
           (coalesce(nullif(el->>'dueDate',''), nullif(el->>'date',''), nullif(el->>'due','')))::date as due
    from jsonb_array_elements(coalesce(pj.project->'milestones','[]'::jsonb)) el
    where coalesce(nullif(el->>'dueDate',''), nullif(el->>'date',''), nullif(el->>'due',''))
          between '1980-01-01' and '2099-12-31'
  ) m
  group by 1
)
select coalesce(jsonb_agg(jsonb_build_object(
    'num', p.num, 'slug', p.slug, 'name', p.name, 'agency', p.agency, 'status', p.status,
    'emails_30d',    coalesce(act.n, 0),
    'emails_open',   coalesce(oe.n, 0),
    'emails_urgent', coalesce(oe.urgent, 0),
    'emails_oldest', coalesce(oe.oldest, 0),
    'pay_flags',     coalesce(py.flags, 0),
    'pay_last',      py.last_date,
    'pay_subj',      py.subj,
    'rfis_open',     coalesce(r.open, 0),
    'rfis_overdue',  coalesce(r.overdue, 0),
    'rfis_60d',      coalesce(fr.r60, 0),
    'rfis_12mo',     coalesce(fr.r12, 0),
    'rfis_friv',     coalesce(fr.friv, 0),
    'subs_open',     coalesce(s.open, 0),
    'subs_overdue',  coalesce(s.overdue, 0),
    'ar_due',        coalesce(arp.due, 0),
    'ar_days',       coalesce(arp.days, 0),
    'ar_client',     arp.client,
    'ar_client_due', coalesce(arc.due, 0),
    'ar_client_days',coalesce(arc.days, 0),
    'actions_open',    coalesce(ai.open, 0),
    'actions_overdue', coalesce(ai.overdue, 0),
    'risks_high',    coalesce(k.high, 0),
    'risks_med',     coalesce(k.med, 0),
    'risks_low',     coalesce(k.low, 0),
    'open_requests', coalesce(k.reqs, 0),
    'ms_overdue',    coalesce(ms.overdue, 0),
    'ms_due_30d',    coalesce(ms.due_30d, 0),
    'next_due',      ms.next_due
  ) order by p.num), '[]'::jsonb)
from proj p
left join activity act on act.project_id = p.slug
left join pay py on py.project_id = p.slug
left join open_email oe on oe.project_id = p.slug
left join rfi r on r.project_number = p.num
left join rfifr fr on fr.project_number = p.num
left join sub s on s.project_number = p.num
left join arp on arp.project_base = split_part(p.num, '.', 1)
left join arc on arc.client = arp.client
left join acts ai on ai.slug = p.slug
left join risk k on k.project_id = p.num
left join ms on ms.slug = p.slug;
$function$;

-- 2. The cache: a single row.
create table if not exists public.pms_portfolio_heatmap_cache (
  id           smallint primary key default 1 check (id = 1),
  data         jsonb not null,
  computed_at  timestamptz not null default now(),
  duration_ms  integer
);
alter table public.pms_portfolio_heatmap_cache enable row level security;
-- Explicit grant, not Supabase's default privileges: without it an anon read
-- is a hard "permission denied" error instead of an empty result, and the
-- live fallback in pms_portfolio_heatmap() never gets a chance to run. RLS
-- below still limits anon to zero rows.
grant select on table public.pms_portfolio_heatmap_cache to anon, authenticated;
drop policy if exists heatmap_cache_read on public.pms_portfolio_heatmap_cache;
create policy heatmap_cache_read on public.pms_portfolio_heatmap_cache
  for select to authenticated using (true);
-- No write policy: only the definer-rights refresh below writes it.

-- 3. Refresh: runs as the owner (sees every row), writes the cache.
create or replace function public.pms_portfolio_heatmap_refresh()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t0   timestamptz := clock_timestamp();
  res  jsonb;
  ms   integer;
begin
  res := public.pms_portfolio_heatmap_compute();
  ms  := (extract(epoch from clock_timestamp() - t0) * 1000)::integer;
  insert into public.pms_portfolio_heatmap_cache (id, data, computed_at, duration_ms)
  values (1, res, now(), ms)
  on conflict (id) do update
    set data = excluded.data, computed_at = excluded.computed_at, duration_ms = excluded.duration_ms;
  return ms;
end;
$function$;
revoke all on function public.pms_portfolio_heatmap_refresh() from public, anon, authenticated;
grant execute on function public.pms_portfolio_heatmap_refresh() to service_role;

-- 4. The name the client calls: cache first, live computation as fallback.
--    SECURITY INVOKER on purpose: RLS decides whether the caller can see the
--    cache row. Anon (and any session before the first refresh) falls through
--    to the live computation under its own rights, which is today's behavior.
create or replace function public.pms_portfolio_heatmap()
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  cached jsonb;
begin
  select c.data into cached from public.pms_portfolio_heatmap_cache c where c.id = 1;
  if cached is not null then
    return cached;
  end if;
  return public.pms_portfolio_heatmap_compute();
end;
$function$;
grant execute on function public.pms_portfolio_heatmap() to anon, authenticated;
grant execute on function public.pms_portfolio_heatmap_compute() to anon, authenticated;

-- 5. Freshness for the UI ("snapshot from 2:15 pm"). Null for anon / no cache.
create or replace function public.pms_portfolio_heatmap_asof()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select jsonb_build_object('computed_at', c.computed_at, 'duration_ms', c.duration_ms)
  from public.pms_portfolio_heatmap_cache c where c.id = 1;
$function$;
grant execute on function public.pms_portfolio_heatmap_asof() to anon, authenticated;

-- 6. Schedule the refresh every 15 minutes, where pg_cron exists (production
--    has it; a preview branch or local replay may not, so this is guarded).
--    The command raises the timeout for the refresh statement only: the
--    computation is the same slow query that timed out, run off the request
--    path. No secret is involved, so unlike the HTTP cron jobs this one can
--    live in the migration.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'pms-heatmap-refresh',
      '4,19,34,49 * * * *',
      $cmd$set statement_timeout = '5min'; select public.pms_portfolio_heatmap_refresh();$cmd$
    );
  else
    raise notice 'pg_cron not installed: pms-heatmap-refresh not scheduled (the live fallback serves).';
  end if;
end
$cron$;
