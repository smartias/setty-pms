-- pms_append_milestone dedupes on driveFolder too (2026-09-15, Codex on
-- #267). The transmittal tool's register-only mode logs a drive set's
-- milestone with driveFolder (canonical path) and no outgoingFolderUrl; the
-- client-side check before the RPC is not atomic, so two people backfilling
-- the same folder at once could both append. The comparison now lives in the
-- same statement as the append, case-folded because Windows paths are.
--
-- Rollback: re-apply 20260801000000_append_milestone.sql.

create or replace function public.pms_append_milestone(
  p_project_id text,
  p_milestone  jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_url      text := nullif(p_milestone->>'outgoingFolderUrl', '');
  v_drive    text := lower(nullif(p_milestone->>'driveFolder', ''));
  v_appended jsonb;
begin
  if p_project_id is null or p_milestone is null then
    raise exception 'pms_append_milestone: project id and milestone are both required';
  end if;

  -- Idempotent on outgoingFolderUrl (SharePoint sets) and, since 2026-09-15,
  -- on driveFolder (drive sets logged by the transmittal tool's register-only
  -- mode; compared case-folded because Windows paths are). A milestone with
  -- neither has nothing to dedupe on and is always appended.
  if (v_url is not null or v_drive is not null) and exists (
    select 1
      from pms_projects p,
           lateral jsonb_array_elements(coalesce(p.project->'milestones', '[]'::jsonb)) m
     where p.id = p_project_id
       and ((v_url is not null and m->>'outgoingFolderUrl' = v_url)
         or (v_drive is not null and lower(m->>'driveFolder') = v_drive))
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

comment on function public.pms_append_milestone(text, jsonb) is
  'Atomically append one milestone to pms_projects.project.milestones. Idempotent on outgoingFolderUrl and (case-folded) driveFolder. Bumps version so an open editor conflicts loudly instead of clobbering.';
