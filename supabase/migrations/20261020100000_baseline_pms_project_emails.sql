-- Baseline for pms_project_emails and its keyword search function, which
-- exist in production (created from the PMS and the SQL editor) but not in
-- this folder.
--
-- Why this exists: a fresh replay of supabase/migrations/ (the Supabase
-- Preview check, a local reset) stops at 20261020120000_emails_embeddings.sql
-- with: relation "public.pms_project_emails" does not exist. That migration
-- alters the table and wraps the keyword function, so both must exist first.
--
-- Production already has both, so this file does NOTHING there: every object
-- is created inside a guard that first checks it is missing. Nothing here is
-- an unguarded `alter table` or RLS change, so a production apply cannot
-- touch the live table or its policies.
--
-- The column list is the one the PMS writes (saveProjectEmailRowFromPMS in
-- SettyPMS.html) and the connector reads (search_emails, read_email,
-- summarize_project_emails), with the types those readers rely on. `direction`
-- is never written by the PMS, so it is derived here from the sender's domain;
-- production's own definition may differ. Section 0 of
-- supabase/emails-verify.sql prints production's real columns; correct this
-- file from that output when it is in hand (it stays a no-op in production
-- either way).
--
-- The keyword function below is a STAND-IN with the live function's contract
-- (q, proj, lim; one row per email with record_id and rank, best first), not
-- its text. The capture migration (20261020110000, written from
-- pg_get_functiondef) carries the real text under the name
-- pms_emails_search_lexical; 20261020120000 renames whichever of the two it
-- finds and wraps it.

do $$
begin
  if to_regclass('public.pms_project_emails') is not null then
    raise notice 'pms_project_emails exists; baseline skipped';
    return;
  end if;

  create table public.pms_project_emails (
    record_id            text primary key,
    project_id           text not null,
    msg_id               text,
    conversation_id      text,
    subject              text,
    from_name            text,
    from_address         text,
    to_addresses         text,
    cc_addresses         text,
    direction            text generated always as
                           (case when lower(coalesce(from_address, '')) like '%@setty.com' then 'outgoing' else 'incoming' end) stored,
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
  create index pms_project_emails_project_date_idx
    on public.pms_project_emails (project_id, email_date desc);
  grant all on public.pms_project_emails to service_role;
  grant select, insert on public.pms_project_emails to authenticated;
end $$;

do $$
begin
  if exists (select 1 from pg_proc
             where pronamespace = 'public'::regnamespace
               and proname in ('search_project_emails', 'pms_emails_search_lexical')) then
    raise notice 'an email keyword search function exists; stand-in skipped';
    return;
  end if;

  create function public.search_project_emails(q text, proj text, lim integer)
  returns table (
    record_id text, project_id text, subject text, from_name text, from_address text,
    to_addresses text, direction text, email_date timestamptz, preview text,
    has_attachments boolean, rank real
  )
  language sql stable security definer set search_path = public
  as $fn$
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
  $fn$;
  revoke all on function public.search_project_emails(text, text, integer) from public, anon, authenticated;
  grant execute on function public.search_project_emails(text, text, integer) to service_role;
end $$;
