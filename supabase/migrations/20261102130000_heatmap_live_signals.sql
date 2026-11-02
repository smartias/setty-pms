-- Live CA + QA signals for the portfolio heatmap.
--
-- Why: the heatmap's RFI/submittal counts come from pms_rfis / pms_submittals,
-- whose status text ("Open - Overdue") is a SNAPSHOT frozen when the Procore /
-- Autodesk register was imported (see 20260728000000_register_asof.sql). The
-- PMS now keeps its own live CA log, projected into pms_ca_items with real
-- due dates, and a QA findings ledger (pms_qa_findings) that the heatmap never
-- saw at all.
--
-- Same posture as pms_register_asof: ADDITIVE, so pms_portfolio_heatmap() (the
-- big function, defined in production) needs no risky rewrite. The client
-- prefers these counts for projects that have rows in the live CA log and
-- falls back to the register snapshot elsewhere — the two sources OVERLAP for
-- backloaded items, so adding them would double-count; preference is the only
-- safe merge during the hybrid Newforma cutover.
--
-- SECURITY INVOKER on purpose: pms_ca_items and pms_qa_findings are
-- select-to-authenticated by RLS. A signed-in Intelligence session (real JWT)
-- gets the live counts; a signed-out (anon) viewer gets '{}' and the heatmap
-- quietly keeps the register snapshot with its as-of label.

create or replace function public.pms_heatmap_live_signals()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with ca as (
    select upper(trim(project_number)) as num,
           count(*) filter (where item_type = 'rfi'       and is_open) as rfis_open,
           count(*) filter (where item_type = 'rfi'       and is_open
                              and due_date is not null and due_date < current_date) as rfis_overdue,
           count(*) filter (where item_type = 'submittal' and is_open) as subs_open,
           count(*) filter (where item_type = 'submittal' and is_open
                              and due_date is not null and due_date < current_date) as subs_overdue,
           count(*) filter (where item_type = 'rfi')       as rfis_total,
           count(*) filter (where item_type = 'submittal') as subs_total
    from pms_ca_items
    where project_number is not null and trim(project_number) <> ''
    group by 1
  ),
  qa as (
    select upper(trim(project)) as num,
           count(*) filter (where severity = 'life-safety') as qa_lifesafety,
           count(*) filter (where severity = 'agency')      as qa_agency,
           count(*) filter (where severity = 'cost')        as qa_cost,
           count(*)                                         as qa_open
    from pms_qa_findings
    where status in ('open', 'ready_to_backcheck')
    group by 1
  )
  select coalesce(jsonb_object_agg(t.num, to_jsonb(t) - 'num'), '{}'::jsonb)
  from (
    select coalesce(ca.num, qa.num) as num,
           coalesce(ca.rfis_open, 0)     as rfis_open,
           coalesce(ca.rfis_overdue, 0)  as rfis_overdue,
           coalesce(ca.subs_open, 0)     as subs_open,
           coalesce(ca.subs_overdue, 0)  as subs_overdue,
           coalesce(ca.rfis_total, 0)    as rfis_total,
           coalesce(ca.subs_total, 0)    as subs_total,
           coalesce(qa.qa_lifesafety, 0) as qa_lifesafety,
           coalesce(qa.qa_agency, 0)     as qa_agency,
           coalesce(qa.qa_cost, 0)       as qa_cost,
           coalesce(qa.qa_open, 0)       as qa_open
    from ca
    full join qa on qa.num = ca.num
  ) t;
$function$;

grant execute on function public.pms_heatmap_live_signals() to anon, authenticated;
