-- QA checklist review routine: proposed checklist items from the RFI log.
--
-- Preventable RFIs that no checklist item covers are the signal that a check
-- is missing (pms_rfi_root_causes: preventable, qa_item null). Until now a
-- person had to ask for them to be read and grouped. This makes it a routine
-- anyone with the Admin Console can start, with a record of each run:
--
--   1. An admin clicks "Run with Claude" on the console's QA Checklist tab.
--      pms_request_qa_routine() records who asked and when.
--   2. A Claude session runs it through the connector: start_checklist_routine
--      stamps the start and hands over the uncovered RFIs;
--      propose_checklist_items writes rows to pms_qa_item_proposals and stamps
--      the finish. The connector never writes pms_qa_checklist.
--   3. An admin approves or rejects each proposal in the console.
--      pms_decide_qa_item_proposal() is the ONLY path from a proposal to the
--      checklist: on approval it numbers the item, inserts it, and tags the
--      RFIs the proposal rests on so they stop counting as uncovered.
--
-- A proposal must rest on at least 3 uncovered preventable RFIs on at least 2
-- projects (qaRoutine.js); the counts stored here are computed by the
-- connector from the tags, never taken from the model.

create table if not exists public.pms_qa_routine_runs (
  id              bigserial primary key,
  requested_at    timestamptz not null default now(),
  requested_by    text not null,
  started_at      timestamptz,
  started_by      text,
  finished_at     timestamptz,
  uncovered_count integer,          -- preventable RFIs with no checklist item when the run started
  proposals_count integer,          -- proposals stored by this run
  refused_count   integer,          -- proposals the rules refused
  summary         text              -- what the run found, in a few sentences
);
create index if not exists pms_qa_routine_runs_requested on public.pms_qa_routine_runs (requested_at desc);

create table if not exists public.pms_qa_item_proposals (
  id              bigserial primary key,
  run_id          bigint references public.pms_qa_routine_runs(id) on delete set null,
  text            text not null,
  details         jsonb not null default '[]'::jsonb,
  automation      text not null default 'assisted' check (automation in ('auto','assisted','manual')),
  automation_hint text,
  phases          jsonb,
  rationale       text,
  rfis            jsonb not null default '[]'::jsonb,   -- [{ "project": "...", "number": "..." }]
  rfi_count       integer not null default 0,
  project_count   integer not null default 0,
  status          text not null default 'proposed' check (status in ('proposed','approved','rejected')),
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text,
  item_id         text,             -- the checklist item it became, once approved
  created_by      text,
  created_at      timestamptz not null default now()
);
create index if not exists pms_qa_item_proposals_status on public.pms_qa_item_proposals (status, created_at desc);

alter table public.pms_qa_routine_runs enable row level security;
alter table public.pms_qa_item_proposals enable row level security;
drop policy if exists qa_routine_runs_admin_all on public.pms_qa_routine_runs;
create policy qa_routine_runs_admin_all on public.pms_qa_routine_runs for all
  using (is_pms_admin()) with check (is_pms_admin());
drop policy if exists qa_item_proposals_admin_all on public.pms_qa_item_proposals;
create policy qa_item_proposals_admin_all on public.pms_qa_item_proposals for all
  using (is_pms_admin()) with check (is_pms_admin());

-- "Run with Claude": record the request under the caller's own email.
create or replace function public.pms_request_qa_routine()
returns public.pms_qa_routine_runs
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  r public.pms_qa_routine_runs;
begin
  if not public.is_pms_admin() then
    raise exception 'Admin role required';
  end if;
  insert into public.pms_qa_routine_runs (requested_by)
  values (coalesce(nullif(auth.jwt()->>'email', ''), 'unknown'))
  returning * into r;
  return r;
end;
$$;

-- Approve or reject one proposal. Approval is the only way a proposal becomes
-- a checklist item.
create or replace function public.pms_decide_qa_item_proposal(p_id bigint, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  p        public.pms_qa_item_proposals;
  who      text := coalesce(nullif(auth.jwt()->>'email', ''), 'unknown');
  new_id   text;
  new_sort integer;
  tagged   integer := 0;
begin
  if not public.is_pms_admin() then
    raise exception 'Admin role required';
  end if;
  select * into p from public.pms_qa_item_proposals where id = p_id for update;
  if not found then
    raise exception 'No proposal %', p_id;
  end if;
  if p.status <> 'proposed' then
    raise exception 'Proposal % was already % by %', p_id, p.status, coalesce(p.decided_by, 'someone');
  end if;

  if not p_approve then
    update public.pms_qa_item_proposals
       set status = 'rejected', decided_by = who, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_id;
    return jsonb_build_object('status', 'rejected', 'proposal', p_id);
  end if;

  -- One approval at a time, so two admins cannot be handed the same number.
  lock table public.pms_qa_checklist in share row exclusive mode;
  select 'qa-' || (coalesce(max((substring(item_id from '^qa-(\d+)$'))::integer), 0) + 1)::text
    into new_id from public.pms_qa_checklist where item_id ~ '^qa-\d+$';
  select coalesce(max(sort), 1790) + 10 into new_sort from public.pms_qa_checklist where section = 'RFI History';

  insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, phases, source, added_by)
  values (new_id, 'deliverable-qa', 'RFI History', new_sort, p.text, p.details, p.automation, p.automation_hint,
          coalesce(p.phases, '["CD","Permit","Bid","Addendum"]'::jsonb), 'rfi-lesson', 'qa-routine-proposal-' || p_id || ' approved by ' || who);

  -- The RFIs the proposal rests on now have a check: tag them, but only the
  -- ones still uncovered, so a tag someone set meanwhile is never overwritten.
  update public.pms_rfi_root_causes rc
     set qa_item = new_id
    from jsonb_to_recordset(p.rfis) as x(project text, number text)
   where rc.item_type = 'rfi' and rc.preventable is true and rc.qa_item is null
     and upper(rc.project) = upper(x.project) and upper(rc.item_number) = upper(x.number);
  get diagnostics tagged = row_count;

  update public.pms_qa_item_proposals
     set status = 'approved', decided_by = who, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), item_id = new_id
   where id = p_id;
  return jsonb_build_object('status', 'approved', 'proposal', p_id, 'item_id', new_id, 'rfis_tagged', tagged);
end;
$$;

revoke all on function public.pms_request_qa_routine() from public, anon;
revoke all on function public.pms_decide_qa_item_proposal(bigint, boolean, text) from public, anon;
grant execute on function public.pms_request_qa_routine() to authenticated;
grant execute on function public.pms_decide_qa_item_proposal(bigint, boolean, text) to authenticated;
