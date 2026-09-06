-- Storage seam, slice A (2026-09-06): each region declares HOW its project
-- files are stored, not just where. 'sharepoint' is full-capability (search,
-- photos, drawings, transmittals); 'azure_files' is the browse-and-read
-- bridge for regions whose project folders still live on network shares
-- synced into Azure Files (Nikhil's mapping) until they migrate.
--
-- The Azure columns are config only: azure_sas_env NAMES the Edge Function
-- secret holding the region's read-only SAS token (e.g. 'AZURE_SAS_DC').
-- The token itself never enters the database.
--
-- Rollback: alter table public.pms_regions
--   drop column storage_kind, drop column azure_share_url, drop column azure_sas_env;

alter table public.pms_regions
  add column if not exists storage_kind text not null default 'sharepoint'
    check (storage_kind in ('sharepoint', 'azure_files')),
  add column if not exists azure_share_url text,
  add column if not exists azure_sas_env text;
