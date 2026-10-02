-- Gate engineering-standards writes behind the knowledge capabilities, matching
-- pms_agency_preferences / pms_best_practices (20260901000000_knowledge_capabilities).
-- Reads stay open to any signed-in user; approving/editing/superseding (UPDATE)
-- and deleting need knowledge.review; inserting needs knowledge.contribute.
-- The connector runs service-role and is unaffected.
drop policy if exists anon_full_pms_engineering_standards on public.pms_engineering_standards;
drop policy if exists pms_engineering_standards_select on public.pms_engineering_standards;
drop policy if exists pms_engineering_standards_insert on public.pms_engineering_standards;
drop policy if exists pms_engineering_standards_update on public.pms_engineering_standards;
drop policy if exists pms_engineering_standards_delete on public.pms_engineering_standards;

create policy pms_engineering_standards_select on public.pms_engineering_standards
  for select to authenticated using (true);
create policy pms_engineering_standards_insert on public.pms_engineering_standards
  for insert to authenticated
  with check (pms_has_cap('knowledge.contribute', null));
create policy pms_engineering_standards_update on public.pms_engineering_standards
  for update to authenticated
  using (pms_has_cap('knowledge.review', null))
  with check (pms_has_cap('knowledge.review', null));
create policy pms_engineering_standards_delete on public.pms_engineering_standards
  for delete to authenticated
  using (pms_has_cap('knowledge.review', null));
