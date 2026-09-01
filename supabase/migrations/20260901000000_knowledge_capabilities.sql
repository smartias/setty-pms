-- Knowledge write-back K1 — capabilities + RLS on the intelligence tables.
-- (PROPOSAL-knowledge-writeback.md, slice K1, revised against the live DB.)
--
-- The proposal sketched a new pms_knowledge table. The live DB already has
-- one: pms_lessons (128 rows, mined + approved, reviewed in
-- SettyIntelligence.html) carries project_id AS A PROJECT NUMBER, agency,
-- discipline, source_reference, superseded_by, and a status check that
-- already includes 'suggested' — the pending state K2 needs. Creating
-- pms_knowledge alongside it would split firm knowledge across two homes,
-- which is the exact failure the proposal warns about for agency
-- preferences. So K1 gates and extends the EXISTING tables instead, which
-- also closes the Phase 5 "Not in the catalog" open decision: the three
-- intelligence tables were the last ones on blanket authenticated-wide
-- ALL policies.
--
-- Matrix defaults preserve today's behavior (the Phase 5 zero-behavior-
-- change posture): every role that can write these tables today keeps both
-- capabilities, EXCEPT qaqc, extending Gate B's deliberate read-only
-- stance. Tightening knowledge.review to admin + project_manager (the
-- proposal's suggested default, open question 1) is a checkbox on the
-- Users & Roles tab, not a migration.
--
-- Run order: this file (rollback capture is section 1) -> verify with
-- ../k1-knowledge-verify.sql (persona sweep) -> watch SettyIntelligence
-- the next workday.

-- ── 1. Rollback capture (Phase 5 pattern) ───────────────────────────────────
insert into pms_ops_snapshots (name, content)
select 'k1-knowledge-caps-rollback-2026-09-01',
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
  and tablename in ('pms_lessons','pms_agency_preferences','pms_best_practices');

-- ── 2. Capability catalog (console grid is catalog-driven) ──────────────────
insert into pms_capability_catalog (capability, label, description, sort)
values
  ('knowledge.contribute', 'Contribute knowledge',
   'Add lessons, agency preferences and best practices as suggestions for review (Intelligence tables; the Claude connector''s save_knowledge tool writes suggested-only under this).',
   60),
  ('knowledge.review', 'Review knowledge',
   'Approve, edit, archive or delete intelligence entries — promotes suggestions into what search_knowledge and briefings serve as firm knowledge.',
   61)
on conflict (capability) do nothing;

-- ── 3. Matrix defaults: today's behavior, minus qaqc (Gate B extended) ──────
insert into pms_role_permissions (role, capability, allowed)
select r.role, c.capability, r.role <> 'qaqc'
from (values ('admin'),('project_manager'),('engineer'),('operations'),
             ('accounting'),('contracts'),('marketing'),('qaqc'),('staff')) as r(role),
     (values ('knowledge.contribute'),('knowledge.review')) as c(capability)
on conflict (role, capability) do nothing;

-- ── 4. pms_lessons: attribution + review-trail columns for K2/K4 ────────────
-- approved_by already exists (the reviewer); what is missing is who
-- CONTRIBUTED the row — the Phase A caller identity the connector resolves —
-- and the review response a contributor sees when a suggestion is rejected.
alter table public.pms_lessons
  add column if not exists author_email text,
  add column if not exists author_name  text,
  add column if not exists reviewed_at  timestamptz,
  add column if not exists review_note  text;

-- 'rejected' joins the lifecycle: a reviewed-and-declined suggestion keeps
-- its review_note for the author instead of being deleted without a trace.
alter table public.pms_lessons drop constraint if exists pms_lessons_status_check;
alter table public.pms_lessons add constraint pms_lessons_status_check
  check (status = any (array['draft','suggested','approved','rejected','archived']));

-- 'connector' joins origin: rows saved by the MCP tool are distinguishable
-- from console entries ('manual') and the mining pipeline ('mined').
alter table public.pms_lessons drop constraint if exists pms_lessons_origin_check;
alter table public.pms_lessons add constraint pms_lessons_origin_check
  check (origin = any (array['manual','mined','connector']));

create index if not exists pms_lessons_project on public.pms_lessons (project_id);
create index if not exists pms_lessons_status  on public.pms_lessons (status);

-- ── 5. Policy swap: reads stay wide, writes carry pms_has_cap() ─────────────
-- Same split as every Phase 5 slice. project_id on pms_lessons is a project
-- number, so per-project overrides resolve (lock a confidential job's
-- lessons to its team). The other two tables have no project scope → null.
-- The connector itself runs service-role and is unaffected; it enforces the
-- same capabilities in-handler from its resolved caps (K2).
drop policy if exists anon_full_pms_lessons on public.pms_lessons;
create policy pms_lessons_select on public.pms_lessons
  for select to authenticated using (true);
create policy pms_lessons_insert on public.pms_lessons
  for insert to authenticated
  with check (pms_has_cap('knowledge.contribute', project_id));
create policy pms_lessons_update on public.pms_lessons
  for update to authenticated
  using (pms_has_cap('knowledge.review', project_id))
  with check (pms_has_cap('knowledge.review', project_id));
create policy pms_lessons_delete on public.pms_lessons
  for delete to authenticated
  using (pms_has_cap('knowledge.review', project_id));

drop policy if exists anon_full_pms_agency_preferences on public.pms_agency_preferences;
create policy pms_agency_preferences_select on public.pms_agency_preferences
  for select to authenticated using (true);
create policy pms_agency_preferences_insert on public.pms_agency_preferences
  for insert to authenticated
  with check (pms_has_cap('knowledge.contribute', null));
create policy pms_agency_preferences_update on public.pms_agency_preferences
  for update to authenticated
  using (pms_has_cap('knowledge.review', null))
  with check (pms_has_cap('knowledge.review', null));
create policy pms_agency_preferences_delete on public.pms_agency_preferences
  for delete to authenticated
  using (pms_has_cap('knowledge.review', null));

drop policy if exists anon_full_pms_best_practices on public.pms_best_practices;
create policy pms_best_practices_select on public.pms_best_practices
  for select to authenticated using (true);
create policy pms_best_practices_insert on public.pms_best_practices
  for insert to authenticated
  with check (pms_has_cap('knowledge.contribute', null));
create policy pms_best_practices_update on public.pms_best_practices
  for update to authenticated
  using (pms_has_cap('knowledge.review', null))
  with check (pms_has_cap('knowledge.review', null));
create policy pms_best_practices_delete on public.pms_best_practices
  for delete to authenticated
  using (pms_has_cap('knowledge.review', null));
