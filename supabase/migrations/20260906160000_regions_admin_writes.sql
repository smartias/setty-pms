-- Regions become admin-manageable from the Admin console (2026-09-06):
-- same posture as the other config tables (pms_capability_catalog,
-- pms_role_permissions): everyone signed-in reads, admins write.
-- The SAS token itself stays OUT of this table by design — azure_sas_env
-- only names the Edge Function secret that holds it.

drop policy if exists pms_regions_admin on public.pms_regions;
create policy pms_regions_admin on public.pms_regions
  as permissive for all to authenticated
  using (is_pms_admin())
  with check (is_pms_admin());
