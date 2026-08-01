-- Register freshness for the portfolio heatmap.
--
-- Why this exists: pms_rfis.status / pms_submittals.status store the literal
-- text Procore/Autodesk exported, including "Open - Overdue". That text is a
-- SNAPSHOT taken when the register was imported and is never re-derived. As of
-- 2026-07-28 most rows were last loaded 2026-06-23, so the heatmap was
-- reporting a five-week-old claim ("8 overdue RFIs") as present-tense fact.
--
-- Rather than recompute overdue-ness (which would invent items the register
-- never claimed), the heatmap now labels those counts with the date the
-- register was last refreshed. Reader decides how much to trust it.
--
-- Kept deliberately separate from pms_portfolio_heatmap() so the big function
-- does not need a risky rewrite for an additive display concern.

create or replace function public.pms_register_asof()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(project_number, jsonb_build_object(
           'rfis_asof', rfis_asof,
           'subs_asof', subs_asof
         )), '{}'::jsonb)
  from (
    select coalesce(r.project_number, s.project_number) as project_number,
           r.d as rfis_asof, s.d as subs_asof
    from      (select project_number, max(loaded_at)::date as d from pms_rfis       group by 1) r
    full join (select project_number, max(loaded_at)::date as d from pms_submittals group by 1) s
      on s.project_number = r.project_number
    where coalesce(r.project_number, s.project_number) is not null
  ) t;
$function$;

grant execute on function public.pms_register_asof() to anon, authenticated;
