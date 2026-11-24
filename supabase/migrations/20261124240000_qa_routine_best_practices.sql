-- QA checklist review routine: firm-wide lessons and best practices too.
--
-- 20261124230000 let a proposal rest on approved lessons, but only lessons
-- tied to a project, because its rule is "the same thing on two projects".
-- Two kinds of knowledge were left out: lessons saved firm-wide (no project)
-- and the firm's approved best practices (pms_best_practices). Both are
-- already statements about every project that a person approved, so ONE is
-- enough for a proposal (qaRoutine.js); an admin still approves each one.
--
--   * pms_qa_item_proposals.lessons entries may carry "kind": "practice"
--     (absent or "lesson" = a lesson). lesson_count counts both.
--   * pms_qa_practice_coverage: which checklist item a best practice is
--     described by, the twin of pms_qa_lesson_coverage. The practice itself
--     is untouched.

create table if not exists public.pms_qa_practice_coverage (
  practice_id uuid primary key references public.pms_best_practices(practice_id) on delete cascade,
  qa_item     text not null,
  set_by      text,
  set_at      timestamptz not null default now()
);
alter table public.pms_qa_practice_coverage enable row level security;
drop policy if exists qa_practice_coverage_read on public.pms_qa_practice_coverage;
create policy qa_practice_coverage_read on public.pms_qa_practice_coverage for select to authenticated using (true);
drop policy if exists qa_practice_coverage_admin_write on public.pms_qa_practice_coverage;
create policy qa_practice_coverage_admin_write on public.pms_qa_practice_coverage for all
  using (is_pms_admin()) with check (is_pms_admin());

-- Same function as 20261124230000, plus: best practices the proposal rests
-- on are linked to the new item.
create or replace function public.pms_decide_qa_item_proposal(p_id bigint, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  p         public.pms_qa_item_proposals;
  who       text := coalesce(nullif(auth.jwt()->>'email', ''), 'unknown');
  new_id    text;
  new_sort  integer;
  tagged    integer := 0;
  linked    integer := 0;
  practices integer := 0;
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

  -- The lessons and best practices it rests on are now described by the
  -- item. One already linked to another item keeps that link; one deleted
  -- since the proposal was written is skipped.
  insert into public.pms_qa_lesson_coverage (lesson_id, qa_item, set_by)
  select l.lesson_id, new_id, who
    from jsonb_to_recordset(p.lessons) as x(id text, kind text)
    join public.pms_lessons l on l.lesson_id::text = x.id
   where coalesce(x.kind, 'lesson') = 'lesson'
  on conflict (lesson_id) do nothing;
  get diagnostics linked = row_count;

  insert into public.pms_qa_practice_coverage (practice_id, qa_item, set_by)
  select b.practice_id, new_id, who
    from jsonb_to_recordset(p.lessons) as x(id text, kind text)
    join public.pms_best_practices b on b.practice_id::text = x.id
   where x.kind = 'practice'
  on conflict (practice_id) do nothing;
  get diagnostics practices = row_count;

  update public.pms_qa_item_proposals
     set status = 'approved', decided_by = who, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), item_id = new_id
   where id = p_id;
  return jsonb_build_object('status', 'approved', 'proposal', p_id, 'item_id', new_id, 'rfis_tagged', tagged,
                            'lessons_linked', linked, 'practices_linked', practices);
end;
$$;

revoke all on function public.pms_decide_qa_item_proposal(bigint, boolean, text) from public, anon;
grant execute on function public.pms_decide_qa_item_proposal(bigint, boolean, text) to authenticated;
