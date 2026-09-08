-- Status moves from the QA Reviews tab. Direct writes on pms_qa_findings are
-- admin-only under RLS; the app's signed-in engineers move status through
-- this SECURITY DEFINER function instead, which enforces the ledger's
-- contract server-side: valid statuses only, a note REQUIRED for terminal
-- states (closed/dismissed), and every move stamped with the caller's own
-- identity from their JWT - never a client-supplied name. Closing an
-- external-source row from the app IS the human click the ledger design
-- requires; automated passes use the connector tools, which stop external
-- rows at ready_to_backcheck.
create or replace function public.pms_qa_finding_set_status(p_id bigint, p_status text, p_note text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pms_qa_findings;
  v_email text;
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
  if p_status in ('closed','dismissed') and (p_note is null or btrim(p_note) = '') then
    raise exception 'a note is required to mark a finding % - the ledger records why, not just that', p_status;
  end if;
  update public.pms_qa_findings
     set status = p_status,
         status_note = nullif(btrim(coalesce(p_note, '')), ''),
         status_by = v_email,
         status_at = now()
   where id = p_id
   returning * into v_row;
  if v_row.id is null then
    raise exception 'no ledger finding with id %', p_id;
  end if;
  return json_build_object('id', v_row.id, 'status', v_row.status, 'status_by', v_email, 'source', v_row.source);
end;
$$;

revoke all on function public.pms_qa_finding_set_status(bigint, text, text) from public;
revoke all on function public.pms_qa_finding_set_status(bigint, text, text) from anon;
grant execute on function public.pms_qa_finding_set_status(bigint, text, text) to authenticated;
grant execute on function public.pms_qa_finding_set_status(bigint, text, text) to service_role;
