-- Blocked dependencies: the risk that no existing PMS metric can see.
--
-- Motivating case (Philly WNBA, SAPX266014.00, 2026-07-28). The project read as
-- "9 overdue, 0 open action items". Both numbers were noise. The actual live
-- exposure was invisible to every table we have:
--
--   Lesley John has been chasing SSR for M/P/FP/AV-IT equipment locations and
--   schedules needed for electrical coordination. Partially stalled: the MEP
--   room and rooftop units are being shuffled, so plumbing/FP equipment is
--   being drawn from PRIOR ESTIMATES until the architectural floor plan
--   updates. Mechanical landed 7/24 (Caroline). Utilities landed 7/27
--   (Pennoni). P/FP/AV-IT still outstanding, against an 8/11 upload.
--
-- Three things make that dangerous, and none of them is "somebody is late":
--   1. Setty is PROCEEDING ON AN ASSUMPTION, not waiting. Work looks healthy.
--   2. The assumption has an EXPIRY EVENT (the arch plan updating) and nothing
--      fires when that event happens, so the drawings quietly go stale.
--   3. Resolution is PARTIAL. A binary open/resolved flag loses the fact that
--      mechanical is in but plumbing/FP is not.
--
-- `open_request` already models "someone is waiting on us". This is the
-- inverse: we are waiting on someone, and shipping anyway.

alter table public.pms_project_analysis
  drop constraint if exists pms_project_analysis_category_check;

alter table public.pms_project_analysis
  add constraint pms_project_analysis_category_check
  check (category = any (array[
    'scope_risk', 'open_request', 'owner_directive', 'blocked_dependency'
  ]));

alter table public.pms_project_analysis
  add column if not exists waiting_on   text,   -- party that owes the input (SSR, Pennoni)
  add column if not exists asked_since  date,   -- first time we chased it
  add column if not exists last_chased  date,   -- most recent nudge
  add column if not exists assumption   text,   -- what we drew instead, in the meantime
  add column if not exists expiry_event text,   -- the event that invalidates the assumption
  add column if not exists expiry_date  date;   -- hard date it must be resolved by

comment on column public.pms_project_analysis.assumption is
  'What the team is proceeding on while the input is outstanding. Presence of '
  'this value is what distinguishes a blocked_dependency from a plain wait: '
  'work is advancing on a guess that someone must revisit.';

comment on column public.pms_project_analysis.expiry_event is
  'Plain-language description of what makes the assumption invalid, e.g. '
  '"architectural floor plan updates". The point of recording it is that the '
  'event usually happens quietly and nobody re-opens the drawings.';

-- Open blocked dependencies, one row per project, for the heatmap and brief.
create or replace function public.pms_blocked_dependencies()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(project_id, items), '{}'::jsonb)
  from (
    select project_id,
           jsonb_agg(jsonb_build_object(
             'title',        title,
             'detail',       detail,
             'severity',     severity,
             'waiting_on',   waiting_on,
             'asked_since',  asked_since,
             'last_chased',  last_chased,
             'days_waiting', case when asked_since is not null
                                  then (now()::date - asked_since) end,
             'assumption',   assumption,
             'expiry_event', expiry_event,
             'expiry_date',  expiry_date,
             'days_to_expiry', case when expiry_date is not null
                                    then (expiry_date - now()::date) end
           ) order by asked_since nulls last) as items
    from pms_project_analysis
    where category = 'blocked_dependency' and status = 'open'
    group by project_id
  ) t;
$function$;

grant execute on function public.pms_blocked_dependencies() to anon, authenticated;

-- Seed the motivating case so the feature ships with something real to render.
-- Idempotent: safe to re-run, and safe to edit/delete once Sara reviews it.
insert into public.pms_project_analysis
  (project_id, category, title, detail, severity, status, origin,
   waiting_on, asked_since, last_chased, assumption, expiry_event, expiry_date)
select
  'SAPX266014.00', 'blocked_dependency',
  'P/FP/AV-IT equipment locations outstanding from SSR',
  'Lesley John chasing SSR for M/P/FP/AV-IT equipment locations and schedules '
  'needed for electrical coordination. Partially resolved: mechanical locations '
  'and schedules (RTUs, boilers, pumps) received from Caroline 7/24; Pennoni '
  'preliminary utility site services plan received 7/27 (incoming electrical and '
  'water from the south). Plumbing, FP and AV-IT still outstanding. MEP room and '
  'rooftop unit locations are still being shuffled.',
  'high', 'open', 'manual',
  'SSR', date '2026-07-14', date '2026-07-24',
  'Plumbing and FP equipment taken from prior estimates.',
  'Architectural floor plan updates with final MEP room and rooftop unit locations.',
  date '2026-08-11'
where not exists (
  select 1 from public.pms_project_analysis
  where project_id = 'SAPX266014.00' and category = 'blocked_dependency'
    and title = 'P/FP/AV-IT equipment locations outstanding from SSR'
);
