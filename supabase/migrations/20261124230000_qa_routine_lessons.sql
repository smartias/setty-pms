-- QA checklist review routine: promote recurring LESSONS, not only RFIs.
--
-- The routine (20261124220000) proposes a checklist item when a kind of
-- preventable RFI recurs. Approved lessons in the knowledge layer are the
-- other record of what keeps going wrong: a QA review already reads them in
-- its second pass, but one that keeps recurring across projects never became
-- a checklist item unless a person wrote it. This lets a proposal rest on
-- lessons as well:
--
--   * pms_qa_item_proposals.lessons: the approved lessons a proposal rests on,
--     [{ "id": "<lesson uuid>", "project": "...", "summary": "..." }].
--   * pms_qa_lesson_coverage: which checklist item a lesson is described by.
--     Written when a proposal resting on the lesson is approved, and by the
--     connector when a run finds an EXISTING item already describes the
--     lesson. A lesson with a row here is not read by later runs. The lesson
--     itself is untouched and stays in the knowledge layer.
--
-- A proposal resting on lessons needs at least 2 approved lessons from at
-- least 2 projects (qaRoutine.js); the counts are computed by the connector.

alter table public.pms_qa_item_proposals
  add column if not exists lessons      jsonb   not null default '[]'::jsonb,
  add column if not exists lesson_count integer not null default 0;
alter table public.pms_qa_routine_runs
  add column if not exists lessons_count integer;   -- approved lessons with no checklist item when the run started

create table if not exists public.pms_qa_lesson_coverage (
  lesson_id uuid primary key references public.pms_lessons(lesson_id) on delete cascade,
  qa_item   text not null,
  set_by    text,
  set_at    timestamptz not null default now()
);
alter table public.pms_qa_lesson_coverage enable row level security;
drop policy if exists qa_lesson_coverage_read on public.pms_qa_lesson_coverage;
create policy qa_lesson_coverage_read on public.pms_qa_lesson_coverage for select to authenticated using (true);
drop policy if exists qa_lesson_coverage_admin_write on public.pms_qa_lesson_coverage;
create policy qa_lesson_coverage_admin_write on public.pms_qa_lesson_coverage for all
  using (is_pms_admin()) with check (is_pms_admin());

-- Same function as 20261124220000, plus: on approval, record the lessons the
-- proposal rests on as described by the new item.
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
  linked   integer := 0;
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
          coalesce(p.phases, '["CD","Permit","Bid","Addendum"]'::jsonb),
          case when p.rfi_count > 0 then 'rfi-lesson' else 'lesson' end,
          'qa-routine-proposal-' || p_id || ' approved by ' || who);

  -- The RFIs the proposal rests on now have a check: tag them, but only the
  -- ones still uncovered, so a tag someone set meanwhile is never overwritten.
  update public.pms_rfi_root_causes rc
     set qa_item = new_id
    from jsonb_to_recordset(p.rfis) as x(project text, number text)
   where rc.item_type = 'rfi' and rc.preventable is true and rc.qa_item is null
     and upper(rc.project) = upper(x.project) and upper(rc.item_number) = upper(x.number);
  get diagnostics tagged = row_count;

  -- The lessons it rests on are now described by the item. A lesson someone
  -- already linked to another item keeps that link; a lesson deleted since
  -- the proposal was written is skipped.
  insert into public.pms_qa_lesson_coverage (lesson_id, qa_item, set_by)
  select l.lesson_id, new_id, who
    from jsonb_to_recordset(p.lessons) as x(id text)
    join public.pms_lessons l on l.lesson_id::text = x.id
  on conflict (lesson_id) do nothing;
  get diagnostics linked = row_count;

  update public.pms_qa_item_proposals
     set status = 'approved', decided_by = who, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), item_id = new_id
   where id = p_id;
  return jsonb_build_object('status', 'approved', 'proposal', p_id, 'item_id', new_id, 'rfis_tagged', tagged, 'lessons_linked', linked);
end;
$$;

revoke all on function public.pms_decide_qa_item_proposal(bigint, boolean, text) from public, anon;
grant execute on function public.pms_decide_qa_item_proposal(bigint, boolean, text) to authenticated;
