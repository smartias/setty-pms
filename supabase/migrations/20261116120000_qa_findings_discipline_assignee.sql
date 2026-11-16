-- QA punch list: who fixes a finding, and where the review's report lives.
--
-- The coordination review now produces a punch list grouped by discipline
-- (qa-coordination-review skill, 2026-11-16). The ledger had no place to say
-- which discipline a finding belongs to or who is working it, so the QA
-- Reviews tab could only show one flat list. This adds:
--
--   pms_qa_findings.discipline   Responsible discipline. Free text because
--                                PRIME jobs carry subconsultant disciplines
--                                (Structural, Architectural, Civil ...). The
--                                tools and the tab offer the usual names:
--                                Mechanical, Electrical, Plumbing, Fire
--                                Protection, Fire Alarm, Multi-discipline,
--                                PM / Project. Written by record_qa_findings
--                                at raise time, or by a person in the tab.
--   pms_qa_findings.assignee     The person working it. Written ONLY by a
--                                signed-in person in the tab: the review
--                                names a discipline, the PM names a person.
--   pms_qa_findings.assigned_by / assigned_at   Who set either field, when.
--   pms_qa_reviews.report_url    The SharePoint folder file_qa_report filed
--                                this review's report into, so the tab can
--                                link it instead of the link living only in
--                                a chat.
--
-- Same write posture as status and responses: direct table writes stay
-- admin-only (RLS), and the tab acts through a security-definer RPC that
-- stamps the signed-in caller from their JWT.

alter table public.pms_qa_findings
  add column if not exists discipline  text,
  add column if not exists assignee    text,
  add column if not exists assigned_by text,
  add column if not exists assigned_at timestamptz;

alter table public.pms_qa_reviews
  add column if not exists report_url text;

create index if not exists pms_qa_findings_project_discipline
  on public.pms_qa_findings (project, discipline);

-- Set the discipline and assignee of one finding. Both values are written as
-- passed: an empty or null value CLEARS that field, so the tab always sends
-- both (the current value for the one it is not changing).
create or replace function public.pms_qa_finding_set_assignment(p_id bigint, p_discipline text, p_assignee text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pms_qa_findings;
  v_email text;
  v_disc text;
  v_who text;
begin
  v_email := coalesce(
    nullif(current_setting('request.jwt.claims', true)::json ->> 'email', ''),
    nullif(current_setting('request.jwt.claims', true)::json ->> 'preferred_username', ''));
  if v_email is null then
    raise exception 'sign-in required: the ledger records who assigned each row';
  end if;
  v_disc := nullif(btrim(coalesce(p_discipline, '')), '');
  v_who  := nullif(btrim(coalesce(p_assignee, '')), '');
  if length(coalesce(v_disc, '')) > 80 or length(coalesce(v_who, '')) > 120 then
    raise exception 'discipline or assignee is too long';
  end if;
  update public.pms_qa_findings
     set discipline = v_disc,
         assignee = v_who,
         assigned_by = v_email,
         assigned_at = now()
   where id = p_id
   returning * into v_row;
  if v_row.id is null then
    raise exception 'no ledger finding with id %', p_id;
  end if;
  return json_build_object('id', v_row.id, 'discipline', v_row.discipline, 'assignee', v_row.assignee,
                           'assigned_by', v_email, 'assigned_at', v_row.assigned_at);
end;
$$;

revoke all on function public.pms_qa_finding_set_assignment(bigint, text, text) from public;
revoke all on function public.pms_qa_finding_set_assignment(bigint, text, text) from anon;
grant execute on function public.pms_qa_finding_set_assignment(bigint, text, text) to authenticated;
grant execute on function public.pms_qa_finding_set_assignment(bigint, text, text) to service_role;
