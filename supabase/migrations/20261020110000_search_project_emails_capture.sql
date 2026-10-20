-- Step 0 of PROPOSAL-emails-embeddings.md: the keyword email search as it ran
-- in production on 2026-10-20, captured with pg_get_functiondef so the
-- repository holds it. Only the name differs: migration 20261020120000
-- renames the live search_project_emails to pms_emails_search_lexical and
-- wraps it, so this file is a no-op after that migration (same text under the
-- same name) and creates the function before it. Nothing about the ranking is
-- changed here.
--
-- What it relies on, all present in production: the search_tsv tsvector
-- column (GIN index pms_project_emails_search_idx), websearch_to_tsquery with
-- the english configuration, and rows ordered best first then newest.
--
-- A replay table built by an earlier version of the baseline (20261020100000)
-- has no search_tsv, and a function body is checked against the table when it
-- is created, so the column is added there first. Production has it; the
-- guard makes this a no-op there (the baseline's own definition is reused).

do $$
begin
  if to_regclass('public.pms_project_emails') is not null
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'pms_project_emails'
                       and column_name = 'search_tsv') then
    alter table public.pms_project_emails
      add column search_tsv tsvector generated always as
        (to_tsvector('english',
           coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' ||
           coalesce(body_text, '') || ' ' || coalesce(attachment_names::text, ''))) stored;
    create index if not exists pms_project_emails_search_idx
      on public.pms_project_emails using gin (search_tsv);
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.pms_emails_search_lexical(q text, proj text DEFAULT NULL::text, lim integer DEFAULT 25)
 RETURNS TABLE(record_id text, project_id text, subject text, from_name text, from_address text, to_addresses text, direction text, email_date timestamp with time zone, preview text, has_attachments boolean, rank real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select e.record_id::text, e.project_id::text, e.subject::text, e.from_name::text,
         e.from_address::text, e.to_addresses::text, e.direction::text, e.email_date::timestamptz,
         e.preview::text, e.has_attachments::boolean,
         ts_rank(e.search_tsv, websearch_to_tsquery('english', q))::real as rank
  from pms_project_emails e
  where e.search_tsv @@ websearch_to_tsquery('english', q)
    and (proj is null or e.project_id::text = proj)
  order by rank desc, e.email_date desc nulls last
  limit greatest(1, least(coalesce(lim, 25), 100));
$function$
