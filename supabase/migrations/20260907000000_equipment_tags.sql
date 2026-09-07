-- Equipment tag enumeration over the drawing text index (find_equipment).
-- DERIVED, not stored: tags are extracted at query time from pms_drawing_text,
-- so the registry is exactly as fresh (and as complete) as the drawing index
-- and there is no second store to drift. Hyphenated tags only ("FCU-11"):
-- the unhyphenated form is rare on sheets and admitting it floods the result
-- with room numbers and dimensions. total_sheets (the project's distinct
-- indexed sheet count) rides along on every row so the caller can drop
-- title-block boilerplate — a "tag" that sits on most sheets of the set is
-- the title block, not equipment. service_role only, like pms_drawing_search.

drop function if exists public.pms_equipment_tags(text, int);
create function public.pms_equipment_tags(p_prefix text, p_min_hits int default 3)
returns table(tag text, tag_prefix text, sheets bigint, hits bigint, sample_sheets text[], total_sheets bigint)
language sql
security definer
set search_path = public
as $$
  with m as (
    select t.sheet_no, upper(x.m[1]) as pfx, upper(x.m[1]) || '-' || x.m[2] as tg
    from public.pms_drawing_text t,
         lateral regexp_matches(t.text, '\m([A-Za-z]{1,4})-(\d{1,3})\M', 'g') as x(m)
    where t.project_prefix = p_prefix
  ), total as (
    select count(distinct sheet_no) as n from public.pms_drawing_text where project_prefix = p_prefix
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

revoke all on function public.pms_equipment_tags(text, int) from public;
revoke all on function public.pms_equipment_tags(text, int) from anon;
revoke all on function public.pms_equipment_tags(text, int) from authenticated;
grant execute on function public.pms_equipment_tags(text, int) to service_role;
