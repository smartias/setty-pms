-- Atomic region save (2026-09-14, Codex P1 on #261): the console used to
-- upsert pms_regions, DELETE the team's pms_region_shares rows, then POST
-- the new set as three REST calls. A dropped connection between the DELETE
-- and the POST erased a region's drive access with nothing to show for it
-- but "Save failed". This function does all three in one transaction: either
-- the whole new configuration lands, or nothing changes.
--
-- SECURITY INVOKER on purpose: the caller's RLS applies, so only is_pms_admin()
-- can write (the same policies the REST path enforced). The explicit check
-- below just turns a silent zero-row write into a clear error.
--
-- Rollback: drop function public.pms_region_save(jsonb, jsonb);

create or replace function public.pms_region_save(p_region jsonb, p_shares jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_team text := upper(trim(coalesce(p_region->>'team', '')));
  v_first jsonb;
begin
  if not is_pms_admin() then
    raise exception 'pms_region_save: admin only' using errcode = '42501';
  end if;
  if v_team = '' then
    raise exception 'pms_region_save: team is required';
  end if;

  -- The legacy single-share columns receive the first ENABLED share so a
  -- connector build older than 1.15.0 keeps working until it is redeployed.
  select s into v_first
  from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) with ordinality as t(s, ord)
  where coalesce((s->>'enabled')::boolean, true)
  order by ord limit 1;

  insert into public.pms_regions (team, region_name, sharepoint_site_id, doc_library, storage_kind,
                                  azure_share_url, azure_sas_env, notes, enabled, updated_at)
  values (v_team,
          coalesce(nullif(trim(p_region->>'region_name'), ''), v_team),
          p_region->>'sharepoint_site_id',
          coalesce(nullif(trim(p_region->>'doc_library'), ''), 'Project Document Library'),
          case when p_region->>'storage_kind' = 'azure_files' then 'azure_files' else 'sharepoint' end,
          v_first->>'share_url', v_first->>'sas_env',
          nullif(trim(coalesce(p_region->>'notes', '')), ''),
          coalesce((p_region->>'enabled')::boolean, true),
          now())
  on conflict (team) do update set
    region_name = excluded.region_name, sharepoint_site_id = excluded.sharepoint_site_id,
    doc_library = excluded.doc_library, storage_kind = excluded.storage_kind,
    azure_share_url = excluded.azure_share_url, azure_sas_env = excluded.azure_sas_env,
    notes = excluded.notes, enabled = excluded.enabled, updated_at = now();

  -- Replace the share set. Same transaction as the upsert above: a failure
  -- anywhere (a bad label, a duplicate, a lost connection) rolls it all back.
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

revoke all on function public.pms_region_save(jsonb, jsonb) from public;
grant execute on function public.pms_region_save(jsonb, jsonb) to authenticated;
