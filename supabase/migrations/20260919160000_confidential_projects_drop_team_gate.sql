-- Policy change (19 Sep 2026): drop team-based project visibility, add
-- "confidential" projects with a staffing exception.
--
-- Cross-office staffing turned out to be the norm, not the exception (SME
-- India works projects for every office; admin/accounting work everywhere
-- too), so restricting the Claude connector to a caller's own office (the
-- Phase C team-scoping rule, 22 Aug 2026) did more harm than good. That
-- restriction lived ONLY in TypeScript (supabase/functions/pms-mcp/index.ts
-- projectVisible()) and is being dropped there in the same change that adds
-- this migration — nothing here removes it on its own.
--
-- The replacement policy: anyone with the firm-level projects.view
-- capability sees every project, UNLESS it is marked "confidential" — in
-- which case only admins, anyone explicitly allowed back in via a
-- person/role-level pms_project_permissions row (unchanged mechanism), and
-- anyone STAFFED on the project (present in the project's own
-- project->'teamMembers' roster) can see it.
--
-- No new column: "confidential" is defined as the project already carrying
-- the override row {subject_kind:'everyone', capability:'*', allowed:false}
-- — exactly the mechanism the Users & Roles tab's per-project overrides
-- card already documented ("lock a confidential job down with everyone ·
-- ★ all · deny, then allow its team back in person by person"). The Admin
-- Console's new Confidential checkbox (Teams card) just creates/removes
-- this one row; nothing else changes shape.
--
-- pms_has_cap_for's precedence is otherwise UNCHANGED: a person- or
-- role-level row for this project still wins outright over 'everyone',
-- exactly as before. The staffing exception applies ONLY when the winning
-- row is the 'everyone' tier and it denies — i.e. only to the confidential
-- case, never to an ordinary allow.
--
-- Three Codex P1s on the first version of this migration, all fixed here:
--   1. A staffed caller's exception must resolve ONLY projects.view, not
--      whatever capability happened to be asked — the original `return
--      true` handed a staffed engineer fees.view or projects.edit on a
--      confidential project even when their ROLE denies it everywhere else,
--      a real privilege escalation. Fixed by falling through to the normal
--      global-override-then-role-matrix path for every OTHER capability,
--      exactly as if the confidential row did not exist for them — a
--      staffed person gets their own ordinary role verdict, nothing more.
--   2. teamMembers rows are matched by email OR by the caller's own
--      staff-directory name (mirroring SettyPMS.html's isMine(), which does
--      the same OR), because a manually-typed or legacy roster row can
--      carry a name with no email at all. The staff directory itself is
--      pms_meta.data->'staff' (id='app_meta') — the same roster
--      SettyPMS.html's "pick from directory" UI reads, not a separate
--      table.
--   3. (UI-side, SettyAdmin.html, same PR) unchecking Confidential now
--      confirms before deleting the row, matching dropOverride().

-- Supports the new project->>'projectNumber' lookup pms_has_cap_for gains
-- below. STABLE SECURITY DEFINER functions run per call, uncached, so an
-- unindexed lookup would cost a sequential scan of pms_projects on every
-- capability check against a confidential project.
create index if not exists pms_projects_project_number_idx
  on public.pms_projects ((project ->> 'projectNumber'));

create or replace function public.pms_has_cap_for(p_email text, p_cap text, p_project text default null::text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_email text := lower(coalesce(p_email,''));
  v_role  text;
  v_over  boolean;
  v_kind  text;
  v_staffed boolean;
begin
  if v_email = '' then return false; end if;
  select role into v_role from pms_user_roles where lower(email) = v_email limit 1;
  v_role := coalesce(v_role, 'staff');
  if v_role = 'admin' then return true; end if;

  if p_project is not null then
    select allowed, subject_kind into v_over, v_kind
    from pms_project_permissions
    where project_number = p_project
      and (capability = p_cap or capability = '*')
      and ( (subject_kind = 'user' and lower(subject) = v_email)
         or (subject_kind = 'role' and subject = v_role)
         or subject_kind = 'everyone' )
    order by case subject_kind when 'user' then 0 when 'role' then 1 else 2 end,
             case when capability = p_cap then 0 else 1 end
    limit 1;
    if found then
      -- Confidential exception: an 'everyone' DENY is the only tier this
      -- applies to (a person/role rule is a deliberate, specific decision
      -- and still wins outright, same as before, by never reaching here —
      -- it would already have been the winning row above).
      v_staffed := v_over = false and v_kind = 'everyone' and exists (
        select 1
        from pms_projects pr, jsonb_array_elements(coalesce(pr.project->'teamMembers', '[]'::jsonb)) tm
        where pr.project ->> 'projectNumber' = p_project
          and ( lower(tm ->> 'email') = v_email
             or lower(tm ->> 'name') = (
                  select lower(s ->> 'name')
                  from pms_meta m, jsonb_array_elements(coalesce(m.data->'staff', '[]'::jsonb)) s
                  where m.id = 'app_meta' and lower(s ->> 'email') = v_email
                  limit 1
                ) )
      );
      if not v_staffed then
        return v_over;
      end if;
      -- Staffed on a confidential project: fall through to the SAME path a
      -- project with no override at all would take, so this capability
      -- resolves to the caller's ordinary global-override/role-matrix
      -- verdict — visible, but no capability grant beyond what their role
      -- already gives them anywhere else.
    end if;
  end if;

  select allowed into v_over
  from pms_project_permissions
  where project_number is null
    and subject_kind = 'user' and lower(subject) = v_email
    and (capability = p_cap or capability = '*')
  order by case when capability = p_cap then 0 else 1 end
  limit 1;
  if found then return v_over; end if;

  return coalesce((select allowed from pms_role_permissions
                   where role = v_role and capability = p_cap), false);
end;
$function$;
