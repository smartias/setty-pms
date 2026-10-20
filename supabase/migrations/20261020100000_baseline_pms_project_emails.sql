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
-- The column list, types and nullability are production's, read on 2026-10-20
-- (section 0 of supabase/emails-verify.sql). Two columns are derived here
-- because nothing in a replay fills them: `search_tsv`, the full-text column
-- the keyword search reads (in production it is maintained by the PMS side;
-- the expression below covers what the search_emails tool promises: subject,
-- sender, body and attachment names), and `direction`, which the PMS never
-- writes (derived from the sender's domain here; a plain column in
-- production). Both only matter where this file creates the table.
--
-- The keyword function below is a STAND-IN for the live search_project_emails
-- with the same contract and, as it happens, the same body (the capture
-- migration 20261020110000 holds the verbatim text under the name
-- pms_emails_search_lexical). It exists so a replay has, under the live name,
-- what production has, and 20261020120000 takes the same path in both.

do $$
begin
  if to_regclass('public.pms_project_emails') is not null then
    raise notice 'pms_project_emails exists; baseline skipped';
    return;
  end if;

  create table public.pms_project_emails (
    record_id            text not null,
    project_id           text not null,
    msg_id               text not null,
    conversation_id      text,
    subject              text not null,
    from_name            text not null,
    from_address         text not null,
    to_addresses         text,
    cc_addresses         text,
    direction            text generated always as
                           (case when lower(from_address) like '%@setty.com' then 'outgoing' else 'incoming' end) stored,
    email_date           timestamptz,
    saved_at             timestamptz not null,
    saved_by             text,
    sp_folder_url        text not null,
    saved_to_sharepoint  boolean not null,
    body_html_compressed text,
    body_html_size       integer,
    body_text            text,
    preview              text,
    has_attachments      boolean,
    attachment_names     jsonb,
    created_at           timestamptz not null default now(),
    migrated_from_v5     boolean,
    search_tsv           tsvector generated always as
                           (to_tsvector('english',
                              coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' ||
                              coalesce(body_text, '') || ' ' || coalesce(attachment_names::text, ''))) stored,
    constraint pms_project_emails_pkey primary key (record_id)
  );
  create index idx_pms_project_emails_msg_id on public.pms_project_emails (msg_id);
  create index idx_pms_project_emails_project_id on public.pms_project_emails (project_id);
  create index pms_project_emails_from_idx on public.pms_project_emails (from_address);
  create index pms_project_emails_search_idx on public.pms_project_emails using gin (search_tsv);
  create unique index pms_project_emails_project_msg_uniq on public.pms_project_emails (project_id, msg_id)
    where coalesce(msg_id, '') <> '';
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

  create function public.search_project_emails(q text, proj text default null, lim integer default 25)
  returns table (
    record_id text, project_id text, subject text, from_name text, from_address text,
    to_addresses text, direction text, email_date timestamptz, preview text,
    has_attachments boolean, rank real
  )
  language sql stable set search_path = public
  as $fn$
    select e.record_id, e.project_id, e.subject, e.from_name, e.from_address, e.to_addresses,
           e.direction, e.email_date, e.preview, e.has_attachments,
           ts_rank(e.search_tsv, websearch_to_tsquery('english', q))::real as rank
    from public.pms_project_emails e
    where e.search_tsv @@ websearch_to_tsquery('english', q)
      and (proj is null or e.project_id = proj)
    order by rank desc, e.email_date desc nulls last
    limit greatest(1, least(coalesce(lim, 25), 100))
  $fn$;
  revoke all on function public.search_project_emails(text, text, integer) from public, anon, authenticated;
  grant execute on function public.search_project_emails(text, text, integer) to service_role;
end $$;
