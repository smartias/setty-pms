-- Applied live on 2026-10-08 as 20261008154356_my_pms_permissions_add_team
-- (from the Outlook add-in session); this file records it so the repo matches
-- supabase_migrations.schema_migrations. Statement copied from that record.
--
-- Adds `team` to the browser-side permission call so the Outlook add-in can
-- stop calling the service-role-only pms_caps_for (403 for signed-in users).
-- Same signature and settings as before, so the authenticated grant stays.
create or replace function public.my_pms_permissions(p_project text default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'email', nullif(lower(coalesce(auth.jwt()->>'email','')), ''),
    'role', (select role from pms_user_roles
             where lower(email) = lower(coalesce(auth.jwt()->>'email','')) limit 1),
    'team', (select team from pms_user_roles
             where lower(email) = lower(coalesce(auth.jwt()->>'email','')) limit 1),
    'caps', coalesce((select jsonb_object_agg(c.capability, pms_has_cap(c.capability, p_project))
                      from pms_capability_catalog c), '{}'::jsonb));
$$;
