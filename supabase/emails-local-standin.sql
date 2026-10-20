-- Minimal stand-in for what a throwaway Postgres lacks before the email
-- migrations run: the Supabase roles and the extensions schema. The table and
-- the keyword search function come from the baseline migration
-- 20261020100000 (which creates them only when missing, as on a Supabase
-- Preview branch). See supabase/emails-local-test.sql for how to use it.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;   -- where Supabase keeps extensions (vector)
create extension if not exists vector with schema extensions;
grant usage on schema public to anon, authenticated, service_role;
