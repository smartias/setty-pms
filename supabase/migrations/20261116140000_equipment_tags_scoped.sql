-- Equipment tag enumeration, scoped (find_equipment).
--
-- pms_equipment_tags counts every indexed page of a project. Internal QA runs
-- a few days before a set is transmitted, on PDFs in the project's QAQC
-- folder, and reviewing that set indexes it. Days later the issued copy lands
-- under Outgoing, so the whole-project count then sees each sheet twice and a
-- tag's sheet count is doubled.
--
-- This variant takes a folder to read (one set: the QA set under review, or
-- one issued set) and/or a POSIX pattern of folder paths to leave out (the
-- connector passes the QAQC-folder pattern when no folder is named, so the
-- default answer is "the drawings as issued"). The original function stays:
-- the connector falls back to it while this migration has not been applied.
-- total_sheets is counted over the same scope, so the title-block boilerplate
-- ratio stays honest.

create or replace function public.pms_equipment_tags_scoped(
  p_prefix   text,
  p_min_hits int  default 3,
  p_folder   text default null,
  p_exclude  text default null
)
returns table(tag text, tag_prefix text, sheets bigint, hits bigint, sample_sheets text[], total_sheets bigint)
language sql
security definer
set search_path = public
as $$
  with scoped as (
    select t.sheet_no, t.text
    from public.pms_drawing_text t
    where t.project_prefix = p_prefix
      and (p_folder is null
           or lower(t.folder_path) = lower(p_folder)
           or lower(t.folder_path) like lower(p_folder) || '/%')
      and (p_exclude is null or coalesce(t.folder_path, '') !~* p_exclude)
  ), m as (
    select s.sheet_no, upper(x.m[1]) as pfx, upper(x.m[1]) || '-' || x.m[2] as tg
    from scoped s,
         lateral regexp_matches(s.text, '\m([A-Za-z]{1,4})-(\d{1,3})\M', 'g') as x(m)
  ), total as (
    select count(distinct sheet_no) as n from scoped
  )
  select tg as tag, pfx as tag_prefix,
         count(distinct m.sheet_no) as sheets, count(*) as hits,
         (array_agg(distinct m.sheet_no) filter (where m.sheet_no is not null))[1:8] as sample_sheets,
         (select n from total) as total_sheets
  from m
  group by tg, pfx
  having count(*) >= p_min_hits
  order by count(*) desc
  limit 400;
$$;

revoke all on function public.pms_equipment_tags_scoped(text, int, text, text) from public;
revoke all on function public.pms_equipment_tags_scoped(text, int, text, text) from anon;
revoke all on function public.pms_equipment_tags_scoped(text, int, text, text) from authenticated;
grant execute on function public.pms_equipment_tags_scoped(text, int, text, text) to service_role;
