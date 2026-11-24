-- QA checklist qa-633: which scheduled equipment the controls sheets never mention.
--
-- qa-633 asks that every controlled item names what controls it: on the BMS
-- with a sequence, or stand-alone with its thermostat drawn. The RFIs behind
-- it are equipment the controls documents were silent about (electric unit
-- heaters nobody assigned to the BMS, a sump pump with no points, a split
-- system "BMS if applicable"). Whether a piece of equipment appears on the
-- controls sheets at all is a text question the drawing index can answer for
-- a whole set (check_controls_coverage, controlsCoverage.js).
--
-- pms_tag_controls_kinds returns, for each hyphenated tag on the NEWEST
-- indexed revision of each sheet in scope, the schedule sheets, controls
-- sheets and plans it is on. A controls sheet is one whose title says
-- CONTROL(S), BMS, BAS, DDC, ATC, AUTOMATION, SEQUENCE or POINTS LIST and not
-- LIGHTING, or one the caller names. controls_words is every short word on
-- the controls sheets, so the connector can tell "FCU is never mentioned"
-- from "FCU is shown once as typical". Same scoping as pms_tag_sheet_kinds.
--
-- Most of qa-633 still needs a reviewer (is the thermostat drawn, can the
-- sequence do what it says), so the item stays 'assisted'.

create or replace function public.pms_tag_controls_kinds(
  p_prefix          text,
  p_folder          text   default null,
  p_exclude         text   default null,
  p_controls_sheets text[] default null
)
returns table(tag_prefix text, tag_num int, sched_sheets text[], controls_sheets text[], plan_sheets text[],
              sheet_count bigint, total_sheets bigint, controls_sheet_list text[], controls_words text[])
language sql
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (upper(t.sheet_no)) upper(t.sheet_no) as sheet_no, t.sheet_title, t.text
    from public.pms_drawing_text t
    where t.project_prefix = p_prefix
      and t.sheet_no is not null
      and (p_folder is null
           or lower(t.folder_path) = lower(p_folder)
           or lower(t.folder_path) like lower(p_folder) || '/%')
      and (p_exclude is null or coalesce(t.folder_path, '') !~* p_exclude)
    order by upper(t.sheet_no),
             (case when t.revision_date ~ '^\d{1,2}/\d{1,2}/\d{4}$' then to_date(t.revision_date, 'MM/DD/YYYY') end) desc nulls last,
             t.indexed_at desc
  ), cls as (
    select l.sheet_no, l.text,
           case when (l.sheet_title ~* '(\mCONTROLS?\M|\mBMS\M|\mBAS\M|\mDDC\M|\mATC\M|AUTOMATION|SEQUENCE|POINTS\s+LIST)' and l.sheet_title !~* 'LIGHTING')
                  or replace(replace(l.sheet_no, '-', ''), ' ', '') in (select replace(replace(upper(x), '-', ''), ' ', '') from unnest(coalesce(p_controls_sheets, '{}')) x)
                then 'controls'
                when l.sheet_title ~* 'SCHEDULE' then 'schedule'
                when l.sheet_title ~* '(PLAN|LAYOUT)' then 'plan'
                else 'other' end as kind
    from latest l
  ), m as (
    select c.sheet_no, c.kind, upper(x.m[1]) as pfx, (x.m[2])::int as num
    from cls c,
         lateral regexp_matches(c.text, '\m([A-Za-z]{1,4})-(\d{1,3})\M', 'g') as x(m)
  ), words as (
    select array_agg(distinct upper(w.m[1])) as list
    from cls c, lateral regexp_matches(c.text, '\m([A-Za-z]{2,4})\M', 'g') as w(m)
    where c.kind = 'controls'
  )
  select m.pfx, m.num,
         (array_agg(distinct m.sheet_no) filter (where m.kind = 'schedule'))[1:12],
         (array_agg(distinct m.sheet_no) filter (where m.kind = 'controls'))[1:12],
         (array_agg(distinct m.sheet_no) filter (where m.kind = 'plan'))[1:12],
         count(distinct m.sheet_no),
         (select count(*) from cls),
         (select (array_agg(sheet_no order by sheet_no))[1:60] from cls where kind = 'controls'),
         (select list[1:6000] from words)
  from m
  group by m.pfx, m.num
  order by m.pfx, m.num
  limit 4000;
$$;

revoke all on function public.pms_tag_controls_kinds(text, text, text, text[]) from public;
revoke all on function public.pms_tag_controls_kinds(text, text, text, text[]) from anon;
revoke all on function public.pms_tag_controls_kinds(text, text, text, text[]) from authenticated;
grant execute on function public.pms_tag_controls_kinds(text, text, text, text[]) to service_role;

update public.pms_qa_checklist
   set automation_hint = 'check_controls_coverage lists, for the whole set in one call, the scheduled mechanical equipment families the controls sheets never mention, the families shown only as typical, and every "BMS if applicable"; for each family it returns, find its thermostat or switch on a plan (search_drawings for THERMOSTAT, T-STAT, STAND-ALONE) or record it. Then by hand: read_drawing_schedule for schedule notes that point to a controls sheet; read_document on the controls specification scope article',
       details = details || '["Whether the controls sheets mention a piece of equipment at all is automatic: check_controls_coverage reads the indexed text of every sheet. It cannot see whether a thermostat is drawn, and a controls diagram that shows one unit as typical covers the rest of its family, so what it returns is a list to work through, not a list of findings."]'::jsonb
 where item_id = 'qa-633'
   and coalesce(automation_hint, '') not like 'check_controls_coverage%';
