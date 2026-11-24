-- QA checklist qa-637: find deferred decisions automatically.
--
-- qa-637 asks that the documents state a decision wherever they defer to the
-- owner, the authority or a code edition ("as allowed by owner", "if
-- applicable", "latest edition"). Finding those phrases is a text search over
-- every sheet. The drawing text index already holds the text, so the
-- connector does the search for a whole set in one call
-- (check_deferred_decisions, deferredDecisions.js), and reads specification
-- PDFs the reviewer names, which are not in the index.
--
-- pms_sheet_phrase_hits returns each match of a pattern on the NEWEST indexed
-- revision of each sheet in scope, with the text either side of it (up to 60
-- matches a sheet). The pattern comes from the connector
-- (deferredDecisions.js pgPattern). Same scoping as pms_tag_sheet_kinds.
-- Needs regexp_count / regexp_instr (PostgreSQL 15 or later).

create or replace function public.pms_sheet_phrase_hits(
  p_prefix  text,
  p_pattern text,
  p_folder  text default null,
  p_exclude text default null
)
returns table(sheet_no text, sheet_title text, before text, phrase text, after text, total_sheets bigint)
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
  )
  , pos as (
    -- Each occurrence by position, so two phrases close together are both
    -- returned: capturing the context in the pattern itself would let one
    -- match swallow its neighbours.
    select l.sheet_no, l.sheet_title, l.text,
           regexp_instr(l.text, p_pattern, 1, n, 0, 'i') as s,
           regexp_instr(l.text, p_pattern, 1, n, 1, 'i') as e
    from latest l,
         lateral generate_series(1, least(regexp_count(l.text, p_pattern, 1, 'i'), 60)) as n
  )
  select p.sheet_no, p.sheet_title,
         substr(p.text, greatest(1, p.s - 110), p.s - greatest(1, p.s - 110)),
         substr(p.text, p.s, p.e - p.s),
         substr(p.text, p.e, 110),
         (select count(*) from latest)
  from pos p
  where p.s > 0
  order by p.sheet_no, p.s
  limit 1500;
$$;

revoke all on function public.pms_sheet_phrase_hits(text, text, text, text) from public;
revoke all on function public.pms_sheet_phrase_hits(text, text, text, text) from anon;
revoke all on function public.pms_sheet_phrase_hits(text, text, text, text) from authenticated;
grant execute on function public.pms_sheet_phrase_hits(text, text, text, text) to service_role;

update public.pms_qa_checklist
   set automation = 'auto',
       automation_hint = 'check_deferred_decisions searches every sheet in the set for the deferring phrases in one call, and the specification PDFs you name in specItemIds (find them with list_project_documents); for each place it returns, look for the answer elsewhere in the set, in the agency preferences and in the knowledge layer before recording it',
       details = details || '["The search is automatic: check_deferred_decisions returns every place a sheet or a named specification PDF says as allowed by, if applicable, to be determined, coordinate with owner, or latest edition, with the same note on many sheets listed once. A place it returns is somewhere to look, not a finding: it becomes one when the answer is stated nowhere."]'::jsonb
 where item_id = 'qa-637'
   and coalesce(automation_hint, '') not like 'check_deferred_decisions%';
