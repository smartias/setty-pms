-- Append one milestone to a project's schedule, atomically.
--
-- The transmittal app needs to add a completed milestone when someone backfills
-- a past issue. It cannot do that the way SettyPMS does — read the whole project
-- blob, splice the array, PATCH it back under an optimistic version check —
-- because a second app doing read-modify-write on the same blob races the web
-- app, and last write wins on the whole project, not just the milestone. A user
-- with the project open could silently lose unrelated edits.
--
-- One UPDATE has no read-modify-write window at all. `version` still bumps, so
-- an open SettyPMS session hits its normal ConflictError on next save and
-- reloads, which is the loud, recoverable outcome rather than a silent clobber.
--
-- SECURITY INVOKER (the default) is deliberate: the caller needs the same rights
-- on pms_projects that a normal PATCH requires, so this cannot become a way
-- around RLS or the Phase 5 capability checks.
create or replace function public.pms_append_milestone(
  p_project_id text,
  p_milestone  jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_url      text := nullif(p_milestone->>'outgoingFolderUrl', '');
  v_appended jsonb;
begin
  if p_project_id is null or p_milestone is null then
    raise exception 'pms_append_milestone: project id and milestone are both required';
  end if;

  -- Idempotent on outgoingFolderUrl, so re-running a backfill cannot double the
  -- schedule. A milestone with no folder link has nothing to dedupe on and is
  -- always appended — callers that can produce those must guard themselves.
  if v_url is not null and exists (
    select 1
      from pms_projects p,
           lateral jsonb_array_elements(coalesce(p.project->'milestones', '[]'::jsonb)) m
     where p.id = p_project_id
       and m->>'outgoingFolderUrl' = v_url
  ) then
    return null;
  end if;

  update pms_projects p
     set project = jsonb_set(
           p.project,
           '{milestones}',
           coalesce(p.project->'milestones', '[]'::jsonb) || jsonb_build_array(p_milestone)
         ),
         version    = coalesce(p.version, 0) + 1,
         updated_at = now()
   where p.id = p_project_id
  returning p_milestone into v_appended;

  if v_appended is null then
    raise exception 'pms_append_milestone: no project with id %', p_project_id;
  end if;

  return v_appended;
end;
$$;

grant execute on function public.pms_append_milestone(text, jsonb) to authenticated;

comment on function public.pms_append_milestone(text, jsonb) is
  'Atomically append one milestone to pms_projects.project.milestones. Idempotent on outgoingFolderUrl. Bumps version so an open editor conflicts loudly instead of clobbering.';
