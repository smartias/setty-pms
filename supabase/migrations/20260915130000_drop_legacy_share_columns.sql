-- Drop the legacy single-share columns on pms_regions (2026-09-15). Since
-- 1.15.0 a region's drives live in pms_region_shares; the two columns were a
-- fallback for an older connector build. Every environment runs 1.18.1+,
-- which no longer selects them, so pms_region_save stops writing them and
-- the columns go.
--
-- ORDER MATTERS: deploy connector 1.18.1 (build
-- 2026-09-15-drop-legacy-share-columns) BEFORE applying this, or the live
-- regionMap() query fails on the missing columns and every region routes to
-- the default site.
--
-- Rollback: alter table public.pms_regions add column azure_share_url text,
--   add column azure_sas_env text; re-apply 20260914190000_region_save_rpc.sql.

create or replace function public.pms_region_save(p_region jsonb, p_shares jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_team text := upper(trim(coalesce(p_region->>'team', '')));
begin
  if not is_pms_admin() then
    raise exception 'pms_region_save: admin only' using errcode = '42501';
  end if;
  if v_team = '' then
    raise exception 'pms_region_save: team is required';
  end if;

  insert into public.pms_regions (team, region_name, sharepoint_site_id, doc_library, storage_kind,
                                  notes, enabled, updated_at)
  values (v_team,
          coalesce(nullif(trim(p_region->>'region_name'), ''), v_team),
          p_region->>'sharepoint_site_id',
          coalesce(nullif(trim(p_region->>'doc_library'), ''), 'Project Document Library'),
          case when p_region->>'storage_kind' = 'azure_files' then 'azure_files' else 'sharepoint' end,
          nullif(trim(coalesce(p_region->>'notes', '')), ''),
          coalesce((p_region->>'enabled')::boolean, true),
          now())
  on conflict (team) do update set
    region_name = excluded.region_name, sharepoint_site_id = excluded.sharepoint_site_id,
    doc_library = excluded.doc_library, storage_kind = excluded.storage_kind,
    notes = excluded.notes, enabled = excluded.enabled, updated_at = now();

  -- Replace the share set in the same transaction as the upsert above.
  delete from public.pms_region_shares where team = v_team;
  insert into public.pms_region_shares (team, label, share_url, sas_env, enabled, sort_order, notes)
  select v_team, s->>'label', s->>'share_url', s->>'sas_env',
         coalesce((s->>'enabled')::boolean, true),
         coalesce((s->>'sort_order')::int, (ord - 1)::int),
         nullif(trim(coalesce(s->>'notes', '')), '')
  from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) with ordinality as t(s, ord);

  return jsonb_build_object(
    'team', v_team,
    'shares', (select count(*) from public.pms_region_shares where team = v_team));
end $$;

alter table public.pms_regions
  drop column if exists azure_share_url,
  drop column if exists azure_sas_env;
