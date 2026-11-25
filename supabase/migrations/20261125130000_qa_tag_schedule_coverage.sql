-- QA checklist qa-622: reconcile equipment tags against schedules automatically.
--
-- qa-622 asks that a bidder can count and price everything shown. One part of
-- it is mechanical: every tag drawn on a plan has a schedule row, and every
-- scheduled tag is drawn somewhere. The drawing text index already holds the
-- text of every sheet, so the connector can answer that for a whole set in
-- one call (check_tag_schedule_coverage, tagCoverage.js).
--
-- pms_tag_sheet_kinds returns, for each hyphenated tag on the NEWEST indexed
-- revision of each sheet in scope, the sheets it is on, split by what kind of
-- sheet that is: a schedule sheet (title contains SCHEDULE, or named by the
-- caller), a plan (title contains PLAN or LAYOUT), or anything else (details,
-- risers, diagrams). Deciding what is a finding is left to the connector,
-- where it is tested. Same scoping as pms_equipment_tags_scoped: one folder,
-- and/or a pattern of folders to leave out (the QAQC copies).
--
-- The rest of qa-622 (untagged devices, the architect's sheets, Division 01)
-- still needs a reviewer, so the item stays 'assisted'; its hint and details
-- say which part is automatic.

create or replace function public.pms_tag_sheet_kinds(
  p_prefix          text,
  p_folder          text   default null,
  p_exclude         text   default null,
  p_schedule_sheets text[] default null
)
returns table(tag_prefix text, tag_num int, spellings text[], sched_sheets text[], plan_sheets text[], other_sheets text[],
              sheet_count bigint, total_sheets bigint, schedule_sheet_list text[], plan_sheet_count bigint)
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
           case when l.sheet_title ~* 'SCHEDULE'
                  or replace(replace(l.sheet_no, '-', ''), ' ', '') in (select replace(replace(upper(x), '-', ''), ' ', '') from unnest(coalesce(p_schedule_sheets, '{}')) x)
                then 'schedule'
                when l.sheet_title ~* '(PLAN|LAYOUT)' then 'plan'
                else 'other' end as kind
    from latest l
  ), m as (
    select c.sheet_no, c.kind, upper(x.m[1]) as pfx, (x.m[2])::int as num, upper(x.m[1]) || '-' || x.m[2] as raw
    from cls c,
         lateral regexp_matches(c.text, '\m([A-Za-z]{1,4})-(\d{1,3})\M', 'g') as x(m)
  )
  select m.pfx, m.num,
         (array_agg(distinct m.raw))[1:4],
         (array_agg(distinct m.sheet_no) filter (where m.kind = 'schedule'))[1:12],
         (array_agg(distinct m.sheet_no) filter (where m.kind = 'plan'))[1:12],
         (array_agg(distinct m.sheet_no) filter (where m.kind = 'other'))[1:12],
         count(distinct m.sheet_no),
         (select count(*) from cls),
         (select (array_agg(sheet_no order by sheet_no))[1:60] from cls where kind = 'schedule'),
         (select count(*) from cls where kind = 'plan')
  from m
  group by m.pfx, m.num
  order by m.pfx, m.num
  limit 4000;
$$;

revoke all on function public.pms_tag_sheet_kinds(text, text, text, text[]) from public;
revoke all on function public.pms_tag_sheet_kinds(text, text, text, text[]) from anon;
revoke all on function public.pms_tag_sheet_kinds(text, text, text, text[]) from authenticated;
grant execute on function public.pms_tag_sheet_kinds(text, text, text, text[]) to service_role;

update public.pms_qa_checklist
   set automation_hint = 'check_tag_schedule_coverage reconciles every equipment tag against the schedule sheets for the whole set in one call (tags drawn with no schedule row, scheduled tags drawn nowhere, families never scheduled); confirm each with view_drawing or read_drawing_schedule before recording it. Then by hand: view_drawing (direct mode) on the architectural RCPs and plans beside our lighting and power plans; read_document on Division 01 alternates and allowances',
       details = details || '["The tag-against-schedule part is automatic: check_tag_schedule_coverage reads the indexed text of every sheet in the set. It sees hyphenated tags only (FCU-11, not FCU11 or a lighting type letter), so untagged devices and single-letter fixture types still need a reviewer."]'::jsonb
 where item_id = 'qa-622'
   and automation_hint not like 'check_tag_schedule_coverage%';
