-- Minimal stand-in for the production objects migration 20261020120000 touches.
-- See supabase/emails-local-test.sql for how to use it. Not for production.
--
-- The real pms_project_emails was created from the PMS, not by a migration;
-- the columns and types below are the ones the migration and the connector
-- rely on. The stand-in keyword function plays the part of the live
-- search_project_emails (which the migration renames to
-- pms_emails_search_lexical): it only has to return one row per email with
-- a record_id and a rank, best first, for the wrapper to be exercised.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;   -- where Supabase keeps extensions (vector)
create extension if not exists vector with schema extensions;

create table if not exists public.pms_project_emails (
  record_id            text primary key,
  project_id           text not null,
  msg_id               text,
  conversation_id      text,
  subject              text,
  from_name            text,
  from_address         text,
  to_addresses         text,
  cc_addresses         text,
  direction            text,
  email_date           timestamptz,
  saved_at             timestamptz,
  saved_by             text,
  sp_folder_url        text,
  saved_to_sharepoint  boolean,
  body_html_compressed text,
  body_html_size       integer,
  body_text            text,
  preview              text,
  has_attachments      boolean,
  attachment_names     jsonb
);
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- Stand-in for the live keyword search, under the name the migration gives it.
-- (In production the migration renames the live function; here it finds this
-- one already in place and leaves it alone.)
create or replace function public.pms_emails_search_lexical(q text, proj text, lim integer)
returns table (
  record_id text, project_id text, subject text, from_name text, from_address text,
  to_addresses text, direction text, email_date timestamptz, preview text,
  has_attachments boolean, rank real
)
language sql stable security definer set search_path = public
as $$
  select e.record_id, e.project_id, e.subject, e.from_name, e.from_address, e.to_addresses,
         e.direction, e.email_date, e.preview, e.has_attachments,
         ts_rank(to_tsvector('english', coalesce(e.subject, '') || ' ' || coalesce(e.body_text, '')),
                 websearch_to_tsquery('english', q))::real as rank
  from public.pms_project_emails e
  where (proj is null or e.project_id = proj)
    and to_tsvector('english', coalesce(e.subject, '') || ' ' || coalesce(e.body_text, ''))
        @@ websearch_to_tsquery('english', q)
  order by rank desc, e.email_date desc nulls last
  limit greatest(1, least(coalesce(lim, 25), 100))
$$;
