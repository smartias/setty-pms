-- Project brief cleanup (Sara, 2026-09-01) + team-from-directory.
--
-- The Overview brief carried sections that read as noise or duplicate other
-- tabs, so they are REMOVED from pms_project_brief():
--   milestones                    -- Schedule lives on the Schedule tab
--   email_open_issues,
--   email_sentiment               -- inbox signals: not helpful/accurate
--   best_practices                -- goes global, too noisy per-project
--   workflow_practices            -- same
--   common_coordination_issues    -- similar-project roll-up, too noisy
--   similar_projects              -- not accurate enough to be useful
-- KEPT: utilities/AHJs/codes, agency preferences, governing standards,
-- regulations & sustainability, owner comments, submittal intel, project
-- analysis, lessons (now "project knowledge", including connector-saved
-- entries), and team & ratings — which now includes EVERY company in the
-- project's own directory (people added from email or by hand), not just the
-- owner/prime/client trio, each joined to the Global Directory star ratings.
--
-- SettyIntelligence.html's renderer and text export are pruned to match in
-- the same commit. The removed sections' feedback votes (pms_ii_brief_feedback)
-- keep their rows; they simply no longer gate anything.
--
-- Rollback: the previous function body is captured below into
-- pms_ops_snapshots as 'brief-cleanup-rollback-2026-09-01'; run its content.

insert into pms_ops_snapshots (name, content)
select 'brief-cleanup-rollback-2026-09-01', pg_get_functiondef(oid)
from pg_proc where proname = 'pms_project_brief'
on conflict (name) do nothing;

CREATE OR REPLACE FUNCTION public.pms_project_brief(p_number text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with me as (
  select slug, num, name, bldg_cat, proj_type, client, owner, prime, status, sqft, agency,
         construction_type, is_campus, scope_tags, scope_summary, authorities,
         city, is_nyc, borough, region, code_regime, electric_utility, gas_utility
  from pms_project_index where num = p_number limit 1
),
dv as (
  select section_key, item_key from pms_ii_brief_feedback
  where project_id = p_number and item_key is not null
  group by 1,2 having sum(vote) < 0
),
my_disc as (select disciplines as d from pms_project_disciplines where project_number = (select num from me)),
is_study as (
  select coalesce((select scope_tags from me),'{}'::text[])
         && array['master-plan','feasibility','feasibility-study','facility-condition-assessment','space-needs-assessment','study'] as s
),
ctx as (
  select array(select distinct lower(replace(t,' ','-')) from unnest(
    coalesce((select scope_tags from me),'{}'::text[])
    || array_remove(array[(select construction_type from me),
                          case when (select is_campus from me) then 'campus' end,
                          (select agency from me), (select bldg_cat from me)], null)
  ) t) as tags
),
scope_ctx as (
  select array(select distinct lower(replace(t,' ','-'))
               from unnest(coalesce((select scope_tags from me),'{}'::text[])) t) as tags
),
tags as (
  select array_remove(array[
    case when (select code_regime from me)='NYC' then 'nyc' end,
    case when (select code_regime from me)='NYS' then 'nys' end,
    (select agency from me), (select bldg_cat from me)], null)
    || coalesce((select authorities from me),'{}'::text[]) as t
),
reg_tags as (
  select array_remove(array[
    case when (select code_regime from me)='NYC' then 'nyc_all' end,
    case when (select code_regime from me) in ('NYC','NYS') then 'ny_project' end,
    case when (select agency from me) in ('SUNY','DASNY','OGS') then 'state' end,
    (select agency from me), (select bldg_cat from me),
    case when (select construction_type from me)='new construction' then 'new_construction' end,
    case when (select construction_type from me)='renovation' then 'renovation' end,
    case when coalesce((select sqft from me),0) >= 25000 then 'gt25k' end,
    case when coalesce((select sqft from me),0) >= 50000 then 'gt50k' end], null) as t
),
owner_comment_items as (
  select oc.id, oc.reviewer, oc.discipline, oc.comment_text, oc.category, oc.recurring, oc.source_file, oc.review_date, oc.agency,
         (oc.project_number = (select num from me)) as own
  from pms_owner_comments oc
  where (oc.project_number = (select num from me)
     or (oc.agency is not null and oc.agency = (select agency from me)))
    and not exists (select 1 from dv where dv.section_key='owner_comments'
                    and dv.item_key in (oc.id::text, left(oc.comment_text,60)))
  order by (oc.project_number = (select num from me)) desc, oc.recurring desc,
           array_position(array['code','scope','coordination','mep','site','design','structural'], oc.category), oc.id
  limit 14
),
lessons as (
  select lesson_id, lesson_summary, discipline, system, issue_type, confidence, reusable_prompt,
         source_reference, status, origin, own, ctx_hits, project_id, date_added
  from (
    select x.*, row_number() over (partition by x.own order by
      (x.status='approved') desc, x.ctx_hits desc, (x.confidence='high') desc, x.date_added desc) as rn
    from (
      select l.lesson_id, l.lesson_summary, l.discipline, l.system, l.issue_type, l.confidence, l.reusable_prompt,
        l.source_reference, l.status, l.origin, l.project_id, l.date_added,
        (l.project_id = (select num from me)) as own,
        (select count(*) from unnest(coalesce(l.tags,'{}'::text[])) t
           where lower(replace(t,' ','-')) = any(c.tags))::int
        + ((l.agency is not null and l.agency = (select agency from me)))::int as ctx_hits,
        (select count(*) from unnest(coalesce(l.tags,'{}'::text[])) t
           where lower(replace(t,' ','-')) = any(sc.tags))::int as scope_hits
      from pms_lessons l cross join ctx c cross join scope_ctx sc
      where ((l.status in ('approved','draft') and l.project_id = (select num from me))
         or (l.status = 'approved' and coalesce(l.project_id,'') <> (select num from me)))
        and not exists (select 1 from dv where dv.section_key='lessons' and dv.item_key = l.lesson_id::text)
    ) x
    where x.own
       or (x.ctx_hits >= 2 and ((select not s from is_study) or x.scope_hits >= 1))
  ) r
  where (own and rn <= 8) or (not own and rn <= 4)
  order by own desc, rn
),
proj_analysis as (
  select category, title, detail, source_ref, severity, status from pms_project_analysis
  where project_id = (select num from me) and status <> 'resolved'
  order by array_position(array['scope_risk','open_request','owner_directive'], category), array_position(array['high','medium','low'], severity)
),
agency_reqs as (
  select ap.pref_id, ap.preference_type, ap.discipline, ap.requirement_or_preference, ap.source
  from pms_agency_preferences ap
  where ap.status='active' and ap.agency = (select agency from me)
    and not exists (select 1 from dv where dv.section_key='agency_prefs'
                    and dv.item_key in (ap.pref_id::text, left(ap.requirement_or_preference,60)))
  limit 8
),
gov as (select owner_name, construction_fund, design_standards, typical_projects, mep_considerations, source_urls from pms_agency_profiles where agency = (select agency from me) limit 1),
add_auth as (
  select pr.agency, pr.owner_name, pr.design_standards, pr.mep_considerations, pr.source_urls
  from pms_agency_profiles pr
  where pr.agency = any(coalesce((select authorities from me),'{}'::text[])) and pr.agency is distinct from (select agency from me)
),
ahjs as (
  select ahj, jurisdiction, codes_standards, mep_impact from (
    select (select electric_utility from me) as ahj, 'Electric utility' as jurisdiction, null::text as codes_standards, 'Electric service, transformers, vaults, metering' as mep_impact, 0 as sort
      where (select electric_utility from me) is not null
    union all
    select (select gas_utility from me), 'Gas utility', null, 'Gas service, meters, piping', 1
      where (select gas_utility from me) is not null
    union all
    select a.ahj, a.jurisdiction, a.codes_standards, a.mep_impact, 2
    from pms_ahj_codes a where a.scope && (select t from tags)
  ) u order by sort, ahj limit 14
),
regs as (
  select category, ref_code, title, mep_impact from pms_regulations r
  where r.scope && (select t from reg_tags) and (r.category <> 'local_law' or (select code_regime from me) = 'NYC')
    and not exists (select 1 from dv where dv.section_key='regulations'
                    and dv.item_key = coalesce(r.ref_code,'')||' '||left(coalesce(r.title,''),40))
  order by array_position(array['local_law','energy_code','sustainability','resiliency'], category), ref_code limit 12
),
-- Submitting parties on THIS project with their firm-wide review history
sub_parties as (
  select coalesce(nullif(btrim(substring(from_party from '\(([^)]*)\)')),''),
                  pms_person_norm(coalesce(nullif(from_party,''), originated_by))) as party,
         count(*) as here_n
  from pms_submittals where project_number = (select num from me)
  group by 1
),
sub_intel as (
  select p.party, p.here_n::int, cs.submittals, cs.projects, cs.avg_review_days, cs.rr_pct
  from sub_parties p
  join pms_contractor_stats cs on cs.party = p.party
  where coalesce(p.party,'') <> ''
    and not exists (select 1 from dv where dv.section_key='submittal_intel' and dv.item_key = p.party)
  order by p.here_n desc limit 6
),
firms as (
  select role, firm from (
    select 'Owner / Agency' role, (select owner from me) firm
    union all select 'Prime', (select prime from me)
    union all select 'Client / Architect', (select client from me)) s
  where firm is not null and firm <> ''
),
-- Every company in the project's OWN directory (people added from filed email
-- or by hand), beyond the owner/prime/client trio. Role is the most common
-- person-type recorded for that company; `people` is how many contacts we hold.
dir_firms as (
  select x.company as firm,
         coalesce(nullif(mode() within group (order by nullif(btrim(x.dtype),'')), ''), 'Directory') as role,
         count(*)::int as people
  from (
    select nullif(btrim(d->>'company'),'') as company, d->>'type' as dtype
    from pms_projects pj
    cross join lateral jsonb_array_elements(coalesce(pj.project->'directory','[]'::jsonb)) d
    where pj.id = (select slug from me)
  ) x
  where x.company is not null
    and not exists (select 1 from firms f where lower(f.firm) = lower(x.company))
  group by x.company
),
project_team as (
  select t.role, t.firm, t.people, t.ord,
    (select round(avg(v::numeric),1) from pms_clients c, jsonb_each_text(c.client->'ratings') r(k,v) where c.client->>'name' ilike t.firm) as rating,
    (select c.client->'types' from pms_clients c where c.client->>'name' ilike t.firm limit 1) as types
  from (
    select role, firm, null::int as people, 0 as ord from firms
    union all
    select role, firm, people, 1 from dir_firms
  ) t
)
select jsonb_build_object(
  'project', (select to_jsonb(me) from me), 'generated_at', now(),
  'scope_disciplines', (select d from my_disc),
  'project_analysis', coalesce((select jsonb_agg(to_jsonb(proj_analysis)) from proj_analysis), '[]'::jsonb),
  'owner_comment_items', coalesce((select jsonb_agg(to_jsonb(owner_comment_items)) from owner_comment_items), '[]'::jsonb),
  'lessons_learned', coalesce((select jsonb_agg(to_jsonb(lessons)) from lessons), '[]'::jsonb),
  'agency_requirements', coalesce((select jsonb_agg(to_jsonb(agency_reqs)) from agency_reqs), '[]'::jsonb),
  'governing_standards', (select to_jsonb(gov) from gov),
  'additional_authorities', coalesce((select jsonb_agg(to_jsonb(add_auth)) from add_auth), '[]'::jsonb),
  'ahjs_codes', coalesce((select jsonb_agg(to_jsonb(ahjs)) from ahjs), '[]'::jsonb),
  'regulations', coalesce((select jsonb_agg(to_jsonb(regs)) from regs), '[]'::jsonb),
  'submittal_intel', coalesce((select jsonb_agg(to_jsonb(sub_intel)) from sub_intel), '[]'::jsonb),
  'project_team', coalesce((select jsonb_agg(to_jsonb(pt) order by pt.ord, pt.people desc nulls first, pt.firm) from project_team pt), '[]'::jsonb)
);
$function$;
