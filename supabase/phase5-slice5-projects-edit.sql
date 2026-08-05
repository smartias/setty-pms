-- Phase 5 Slice 5 — projects.edit  ** DRAFT, NOT APPLIED **
--
-- Splits the remaining blanket policies so writes carry a pms_has_cap()
-- term. Reads stay open to every signed-in user, exactly as slices 1-3.
--
-- ONE DECISION IS STILL OPEN: see the marked block for pms_projects.
--
-- Run order: capture rollback -> apply -> verify (personas) -> watch.

-- ── 1. Rollback capture ─────────────────────────────────────────────────────
insert into pms_ops_snapshots (name, content)
select 'phase5-slice5-rollback-2026-08-05',
       string_agg(
         format(
           'drop policy if exists %I on public.%I; create policy %I on public.%I as %s for %s to %s%s%s;',
           policyname, tablename, policyname, tablename,
           case when permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
           cmd, array_to_string(roles, ','),
           coalesce(' using (' || qual || ')', ''),
           coalesce(' with check (' || with_check || ')', '')
         ), E'\n')
from pg_policies
where schemaname = 'public'
  and tablename in ('pms_projects','pms_rfis','pms_submittals','pms_rfi_events',
                    'pms_submittal_events','pms_clients','pms_meta','pms_data');

-- ── 2. pms_projects ─────────────────────────────────────────────────────────
drop policy if exists anon_full_pms_projects on public.pms_projects;

create policy pms_projects_select on public.pms_projects
  for select to authenticated using (true);

-- Option B (Sara, 2026-08-05): PROJECT-SCOPED. Reads the number out of the
-- JSON so per-project overrides finally resolve — "lock a confidential job
-- to its team" becomes a working checkbox instead of a future migration.
-- Both USING and WITH CHECK are required: USING alone would let someone edit
-- a locked project by renumbering it, WITH CHECK alone would let them move
-- one INTO a locked scope.
create policy pms_projects_write on public.pms_projects
  for all to authenticated
  using (pms_has_cap('projects.edit', project->>'projectNumber'))
  with check (pms_has_cap('projects.edit', project->>'projectNumber'));

-- ── 3. RFI / submittal registers (project_number is a real column) ──────────
drop policy if exists pms_rfis_insert_anon on public.pms_rfis;
drop policy if exists pms_rfis_update_anon on public.pms_rfis;
create policy pms_rfis_insert on public.pms_rfis
  for insert to authenticated with check (pms_has_cap('projects.edit', project_number));
create policy pms_rfis_update on public.pms_rfis
  for update to authenticated
  using (pms_has_cap('projects.edit', project_number))
  with check (pms_has_cap('projects.edit', project_number));

drop policy if exists pms_submittals_insert_anon on public.pms_submittals;
drop policy if exists pms_submittals_update_anon on public.pms_submittals;
create policy pms_submittals_insert on public.pms_submittals
  for insert to authenticated with check (pms_has_cap('projects.edit', project_number));
create policy pms_submittals_update on public.pms_submittals
  for update to authenticated
  using (pms_has_cap('projects.edit', project_number))
  with check (pms_has_cap('projects.edit', project_number));

drop policy if exists pms_rfi_events_insert_anon on public.pms_rfi_events;
drop policy if exists pms_rfi_events_update_anon on public.pms_rfi_events;
create policy pms_rfi_events_insert on public.pms_rfi_events
  for insert to authenticated with check (pms_has_cap('projects.edit', project_number));
create policy pms_rfi_events_update on public.pms_rfi_events
  for update to authenticated
  using (pms_has_cap('projects.edit', project_number))
  with check (pms_has_cap('projects.edit', project_number));

drop policy if exists pms_submittal_events_insert_anon on public.pms_submittal_events;
drop policy if exists pms_submittal_events_update_anon on public.pms_submittal_events;
create policy pms_submittal_events_insert on public.pms_submittal_events
  for insert to authenticated with check (pms_has_cap('projects.edit', project_number));
create policy pms_submittal_events_update on public.pms_submittal_events
  for update to authenticated
  using (pms_has_cap('projects.edit', project_number))
  with check (pms_has_cap('projects.edit', project_number));

-- ── 4. pms_clients (no project scope; global only) ──────────────────────────
drop policy if exists anon_full_pms_clients on public.pms_clients;
create policy pms_clients_select on public.pms_clients
  for select to authenticated using (true);
create policy pms_clients_write on public.pms_clients
  for all to authenticated
  using (pms_has_cap('projects.edit', null))
  with check (pms_has_cap('projects.edit', null));

-- ── 5. pms_meta — BOOT PATH, read must stay wide open ───────────────────────
-- saveMetaV2 only fires when staff/termContracts actually changed
-- (SettyPMS.html:1825 diffs against the snapshot seeded at load, :28112),
-- so gating writes here does NOT break app boot. Verify anyway.
drop policy if exists anon_full_pms_meta on public.pms_meta;
create policy pms_meta_select on public.pms_meta
  for select to authenticated using (true);
create policy pms_meta_write on public.pms_meta
  for all to authenticated
  using (pms_has_cap('projects.edit', null))
  with check (pms_has_cap('projects.edit', null));

-- ── 6. pms_data (legacy; kill the duplicate SELECT policies while here) ─────
drop policy if exists anon_read on public.pms_data;
drop policy if exists anon_select on public.pms_data;
drop policy if exists anon_insert on public.pms_data;
drop policy if exists anon_update on public.pms_data;
create policy pms_data_select on public.pms_data
  for select to authenticated using (true);
create policy pms_data_write on public.pms_data
  for all to authenticated
  using (pms_has_cap('projects.edit', null))
  with check (pms_has_cap('projects.edit', null));
