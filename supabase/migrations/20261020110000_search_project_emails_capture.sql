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
