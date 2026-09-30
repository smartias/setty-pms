-- Review comment responses (P1.4, the drafting half).
--
-- Comment logs ingest into the ledger one row per comment (record_qa_findings
-- kind:'comment-log'). This adds the RESPONSE side of that register:
--
--   ai_response           Claude's draft, written by the connector's
--                         save_comment_responses (disposition, text, evidence,
--                         needs-verify note, links). A suggestion, never sent.
--   response              What actually goes back to the reviewer. Written ONLY
--                         by pms_qa_finding_set_response with the signed-in
--                         person's identity, from the QA Reviews tab.
--   response_disposition  comply / partial / clarify / no-change /
--                         already-addressed / not-in-scope / defer
--
-- Same contract as status: the machine drafts, a person decides, and the
-- ledger records who. Responses apply to EXTERNAL rows only (drchecks, owner,
-- architect, agency, other); an internal finding has nobody to answer.

alter table public.pms_qa_findings
  add column if not exists ai_response          jsonb,
  add column if not exists response             text,
  add column if not exists response_disposition text,
  add column if not exists response_by          text,
  add column if not exists response_at          timestamptz;

alter table public.pms_qa_findings drop constraint if exists pms_qa_findings_response_disposition_check;
alter table public.pms_qa_findings add constraint pms_qa_findings_response_disposition_check
  check (response_disposition is null or response_disposition in
    ('comply','partial','clarify','no-change','already-addressed','not-in-scope','defer'));

create or replace function public.pms_qa_finding_set_response(p_id bigint, p_disposition text, p_response text)
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
    raise exception 'sign-in required: the ledger records who answered each comment';
  end if;
  if p_disposition is not null and p_disposition not in
    ('comply','partial','clarify','no-change','already-addressed','not-in-scope','defer') then
    raise exception 'invalid disposition %', p_disposition;
  end if;
  if p_response is null or btrim(p_response) = '' then
    raise exception 'a response is required: the register records what went back, not just that something did';
  end if;
  select * into v_row from public.pms_qa_findings where id = p_id;
  if v_row.id is null then
    raise exception 'no ledger finding with id %', p_id;
  end if;
  if v_row.source not in ('drchecks','owner','architect','agency','other') then
    raise exception 'finding % is an internal finding (source %): responses are for reviewer comments', p_id, v_row.source;
  end if;
  update public.pms_qa_findings
     set response = btrim(p_response),
         response_disposition = p_disposition,
         response_by = v_email,
         response_at = now()
   where id = p_id
   returning * into v_row;
  return json_build_object('id', v_row.id, 'disposition', v_row.response_disposition,
                           'response_by', v_email, 'response_at', v_row.response_at);
end;
$$;
revoke all on function public.pms_qa_finding_set_response(bigint, text, text) from public;
revoke all on function public.pms_qa_finding_set_response(bigint, text, text) from anon;
grant execute on function public.pms_qa_finding_set_response(bigint, text, text) to authenticated;
grant execute on function public.pms_qa_finding_set_response(bigint, text, text) to service_role;
