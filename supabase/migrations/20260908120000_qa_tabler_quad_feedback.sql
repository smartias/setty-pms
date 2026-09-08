-- Tabler Quad pilot feedback (Sara, 2026-09-08), two parts:
--
-- 1) Eight checklist items retire as noise — "I don't see anyone doing
--    these." All eight are the automation='manual' judgment-only tier
--    (drafting cosmetics, plot hygiene, ceiling-congestion eyeball), so
--    disabling them also empties the QA tab's "Reviewer's own checks"
--    card, which reads enabled manual items. Rows stay (disabled, not
--    deleted): per-project history keyed on these ids remains readable,
--    and any of them can come back by flipping enabled.
update public.pms_qa_checklist
   set enabled = false
 where item_id in ('qa-006','qa-009','qa-023','qa-024','qa-031','qa-033','qa-085','qa-086');

-- 2) Human sign-off on an auto-backchecked row shouldn't demand a note.
--    When an automated pass already moved a row to ready_to_backcheck it
--    recorded its evidence in status_note; the person closing it is
--    confirming that evidence, not adding new reasoning. So: closing a
--    row that is CURRENTLY ready_to_backcheck no longer requires a note,
--    and an empty note PRESERVES the recorded evidence instead of wiping
--    it. Every other terminal move keeps the note requirement (closing
--    straight from open, and every dismissal, still records why).
create or replace function public.pms_qa_finding_set_status(p_id bigint, p_status text, p_note text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pms_qa_findings;
  v_prev public.pms_qa_findings;
  v_email text;
  v_note text;
begin
  v_email := coalesce(
    nullif(current_setting('request.jwt.claims', true)::json ->> 'email', ''),
    nullif(current_setting('request.jwt.claims', true)::json ->> 'preferred_username', ''));
  if v_email is null then
    raise exception 'sign-in required: the ledger records who moved each row';
  end if;
  if p_status not in ('open','ready_to_backcheck','closed','dismissed') then
    raise exception 'invalid status %', p_status;
  end if;
  select * into v_prev from public.pms_qa_findings where id = p_id;
  if v_prev.id is null then
    raise exception 'no ledger finding with id %', p_id;
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_status = 'dismissed' and v_note is null then
    raise exception 'a note is required to mark a finding dismissed - the ledger records why, not just that';
  end if;
  if p_status = 'closed' and v_note is null and v_prev.status <> 'ready_to_backcheck' then
    raise exception 'a note is required to mark a finding closed - the ledger records why, not just that';
  end if;
  update public.pms_qa_findings
     set status = p_status,
         status_note = case
           when p_status = 'closed' and v_note is null then v_prev.status_note
           else v_note
         end,
         status_by = v_email,
         status_at = now()
   where id = p_id
   returning * into v_row;
  return json_build_object('id', v_row.id, 'status', v_row.status, 'status_by', v_email, 'source', v_row.source);
end;
$$;

revoke all on function public.pms_qa_finding_set_status(bigint, text, text) from public;
revoke all on function public.pms_qa_finding_set_status(bigint, text, text) from anon;
grant execute on function public.pms_qa_finding_set_status(bigint, text, text) to authenticated;
grant execute on function public.pms_qa_finding_set_status(bigint, text, text) to service_role;
