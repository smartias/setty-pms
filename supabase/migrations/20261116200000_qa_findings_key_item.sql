-- QA punch list: key items.
--
-- A long punch list reads flat: forty rows of the same weight. A KEY ITEM is a
-- finding the team should see first, shown in bold in the QA Reviews tab, the
-- Send to team email and the export. Three reasons earn it:
--   recurring         the same kind of problem keeps coming up, on this
--                     project or across projects (a checklist RFI-prevention
--                     item, a lesson in the knowledge layer)
--   clear miss        a plain error on the face of the documents that a
--                     check should have caught (220 V on a 208 V unit)
--   high consequence  life safety, a failed inspection, or a change order
--
--   pms_qa_findings.key_item    true when marked
--   pms_qa_findings.key_reason  one of the three reasons above, or free text
--   pms_qa_findings.key_by / key_at   who marked or unmarked it, when
--
-- Written by record_qa_findings / mark_qa_key_item (the review marks a few),
-- or by a signed-in person in the tab through the RPC below. Same write
-- posture as status, responses and assignment: direct table writes stay
-- admin-only (RLS).

alter table public.pms_qa_findings
  add column if not exists key_item   boolean not null default false,
  add column if not exists key_reason text,
  add column if not exists key_by     text,
  add column if not exists key_at     timestamptz;

create or replace function public.pms_qa_finding_set_key(p_id bigint, p_key boolean, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pms_qa_findings;
  v_email text;
  v_reason text;
begin
  v_email := coalesce(
    nullif(current_setting('request.jwt.claims', true)::json ->> 'email', ''),
    nullif(current_setting('request.jwt.claims', true)::json ->> 'preferred_username', ''));
  if v_email is null then
    raise exception 'sign-in required: the ledger records who marked each row';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if length(coalesce(v_reason, '')) > 120 then
    raise exception 'reason is too long';
  end if;
  update public.pms_qa_findings
     set key_item = coalesce(p_key, false),
         key_reason = case when coalesce(p_key, false) then v_reason else null end,
         key_by = v_email,
         key_at = now()
   where id = p_id
   returning * into v_row;
  if v_row.id is null then
    raise exception 'no ledger finding with id %', p_id;
  end if;
  return json_build_object('id', v_row.id, 'key_item', v_row.key_item, 'key_reason', v_row.key_reason,
                           'key_by', v_email, 'key_at', v_row.key_at);
end;
$$;

revoke all on function public.pms_qa_finding_set_key(bigint, boolean, text) from public;
revoke all on function public.pms_qa_finding_set_key(bigint, boolean, text) from anon;
grant execute on function public.pms_qa_finding_set_key(bigint, boolean, text) to authenticated;
grant execute on function public.pms_qa_finding_set_key(bigint, boolean, text) to service_role;
