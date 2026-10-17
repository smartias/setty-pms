-- Minimal stand-in for the production objects migration 20261017120000 touches.
-- See supabase/ca-items-local-test.sql for how to use it.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create table if not exists public.pms_projects (
  id         text not null,
  project    jsonb not null,
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  team       text,
  updated_by text,
  constraint pms_projects_pkey primary key (id)
);
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
