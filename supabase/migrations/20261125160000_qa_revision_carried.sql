-- QA checklist qa-634: was a revision's change carried to the sheets not re-issued?
--
-- qa-634 asks that on an addendum or bulletin each change is carried to every
-- sheet it touches. The RFI that names it best: a bulletin removed smoke
-- dampers from the fire alarm sheet while the electrical sheet, not re-issued,
-- still showed their power. The drawing text index keeps every revision of
-- every sheet, so the connector can compare each sheet in a revision set with
-- the revision before it and ask where else the changed tags still appear
-- (check_revision_carried, revisionCarried.js).
--
-- pms_set_tag_changes takes one set folder. For each sheet in it that has an
-- earlier issued revision it returns each hyphenated tag that was ADDED to or
-- REMOVED from the sheet, with the other sheets of the set that show the tag
-- now, and the sheets NOT in the set whose current revision (as of the set's
-- date) shows it. Sets are ordered by the date in their folder name
-- (2025-01-21_Addendum #1). QAQC copies are left out unless the set itself is
-- one. A row with change '-' carries the counts when nothing changed.
--
-- It sees tags only. A changed note, size or quantity is not found here, so
-- the item stays 'assisted'.

create or replace function public.pms_set_tag_changes(
  p_prefix text,
  p_folder text
)
returns table(sheet_no text, change text, tag_prefix text, tag_num int, in_set_sheets text[], elsewhere_sheets text[],
              previous_set text, sheets_in_set bigint, sheets_with_previous bigint, set_date date)
language sql
security definer
set search_path = public
as $$
  with base as (
    select upper(t.sheet_no) as sheet_no, t.text, t.folder_path, t.indexed_at,
           (lower(t.folder_path) = lower(p_folder) or lower(t.folder_path) like lower(p_folder) || '/%') as in_set,
           to_date(replace(substring(t.folder_path from '\d{4}[-_]\d{2}[-_]\d{2}'), '_', '-'), 'YYYY-MM-DD') as set_date,
           coalesce(substring(t.folder_path from '^[^/]+/([^/]+)'), t.folder_path) as set_name
    from public.pms_drawing_text t
    where t.project_prefix = p_prefix
      and t.sheet_no is not null
      and t.folder_path ~ '\d{4}[-_]\d{2}[-_]\d{2}'
      and (coalesce(t.folder_path, '') !~* '(^|/)[^/]*qaqc[^/]*(/|$)'
           or lower(t.folder_path) = lower(p_folder) or lower(t.folder_path) like lower(p_folder) || '/%')
  ), d as (
    select max(b.set_date) as dt from base b where b.in_set
  ), newv as (
    select distinct on (b.sheet_no) b.sheet_no, b.text
    from base b where b.in_set
    order by b.sheet_no, b.indexed_at desc
  ), prev as (
    select distinct on (n.sheet_no) n.sheet_no, b.text, b.set_name
    from newv n join base b on b.sheet_no = n.sheet_no and not b.in_set and b.set_date < (select dt from d)
    order by n.sheet_no, b.set_date desc, b.indexed_at desc
  ), elsewhere as (
    select distinct on (b.sheet_no) b.sheet_no, b.text
    from base b
    where not b.in_set and b.set_date <= (select dt from d)
      and not exists (select 1 from newv n where n.sheet_no = b.sheet_no)
    order by b.sheet_no, b.set_date desc, b.indexed_at desc
  ), nt as (
    select n.sheet_no, upper(x.m[1]) as pfx, (x.m[2])::int as num
    from newv n, lateral regexp_matches(n.text, '\m([A-Za-z]{1,4})-(\d{1,3})\M', 'g') as x(m) group by 1, 2, 3
  ), pt as (
    select p.sheet_no, upper(x.m[1]) as pfx, (x.m[2])::int as num
    from prev p, lateral regexp_matches(p.text, '\m([A-Za-z]{1,4})-(\d{1,3})\M', 'g') as x(m) group by 1, 2, 3
  ), et as (
    select e.sheet_no, upper(x.m[1]) as pfx, (x.m[2])::int as num
    from elsewhere e, lateral regexp_matches(e.text, '\m([A-Za-z]{1,4})-(\d{1,3})\M', 'g') as x(m) group by 1, 2, 3
  ), ch as (
    select p.sheet_no, 'removed'::text as change, p.pfx, p.num from pt p
     where not exists (select 1 from nt n where n.sheet_no = p.sheet_no and n.pfx = p.pfx and n.num = p.num)
    union all
    select n.sheet_no, 'added', n.pfx, n.num from nt n
     where exists (select 1 from prev p where p.sheet_no = n.sheet_no)
       and not exists (select 1 from pt q where q.sheet_no = n.sheet_no and q.pfx = n.pfx and q.num = n.num)
  ), counts as (
    select (select count(*) from newv) as n_set, (select count(*) from prev) as n_prev, (select dt from d) as dt
  )
  select c.sheet_no, c.change, c.pfx, c.num,
         (select (array_agg(n.sheet_no order by n.sheet_no))[1:12] from nt n where n.pfx = c.pfx and n.num = c.num and n.sheet_no <> c.sheet_no),
         (select (array_agg(e.sheet_no order by e.sheet_no))[1:12] from et e where e.pfx = c.pfx and e.num = c.num),
         (select p.set_name from prev p where p.sheet_no = c.sheet_no),
         k.n_set, k.n_prev, k.dt
  from ch c cross join counts k
  union all
  select null, '-', null, null, null, null, null, k.n_set, k.n_prev, k.dt
  from counts k
  where not exists (select 1 from ch)
  order by 1, 2, 3, 4
  limit 3000;
$$;

revoke all on function public.pms_set_tag_changes(text, text) from public;
revoke all on function public.pms_set_tag_changes(text, text) from anon;
revoke all on function public.pms_set_tag_changes(text, text) from authenticated;
grant execute on function public.pms_set_tag_changes(text, text) to service_role;

update public.pms_qa_checklist
   set automation_hint = 'check_revision_carried on the revision''s folder: it compares each sheet in the addendum or bulletin with the revision before it and returns the tags removed there that sheets NOT re-issued still show, and tags added on one sheet only; open both sheets (view_drawing) before recording one. Then by hand, for changes that are not a tag (notes, sizes, quantities, backgrounds): search_drawings for each changed note across the current sets and read its history',
       details = details || '["Tag changes are automatic: check_revision_carried compares every sheet in the revision with its previous revision and lists the tags removed that sheets not re-issued still show. It sees hyphenated tags only, so a changed note, size, quantity, grid name or specification section is still checked by hand."]'::jsonb
 where item_id = 'qa-634'
   and coalesce(automation_hint, '') not like 'check_revision_carried%';
