-- Resubmittal Required is not an open submittal.
--
-- Stamped Revise and Resubmit / Rejected means the contractor owes the next
-- move. The PMS (SUB_OPEN_STATUSES), the Tracker and the connector's
-- SUBMITTAL_OPEN (PR #431) all count only Received / Under Review / Pending
-- Sub Review as open. pms_ca_item_is_open still listed Resubmittal Required,
-- so search_ca_items(open_only) and pms_heatmap_live_signals() disagreed with
-- the briefing and digest counts. Same definition everywhere now.
--
-- is_open is a plain column filled by pms_ca_items_project_row() at projection
-- time, so existing rows are recomputed here; future projections use the new
-- function.

create or replace function public.pms_ca_item_is_open(p_type text, p_status text)
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case p_type
    when 'rfi'       then coalesce(p_status, '') in ('Open', 'Pending Sub Response')
    when 'submittal' then coalesce(p_status, '') in ('Received', 'Under Review', 'Pending Sub Review')
    else false end
$$;

update public.pms_ca_items
   set is_open = public.pms_ca_item_is_open(item_type, status)
 where is_open is distinct from public.pms_ca_item_is_open(item_type, status);
