-- pms_emails_search_lexical: find the matches through the index, and rank only
-- the newest 2,000 of them.
--
-- An unscoped search_emails for a common word took 10 to 22 seconds and
-- sometimes hit the statement timeout (58 of 307 unscoped searches over 8 s
-- and 3 timeouts in the 30 days to 2026-11-24; "Sara", "thank you", "team").
-- EXPLAIN ANALYZE of this function's query for 'Sara':
--
--   Seq Scan on pms_project_emails   rows=10297, removed 20222
--   Buffers: shared hit=141481 read=37893          Execution Time: 22039 ms
--
-- The planner chose a sequential scan because a third of the table matches,
-- and its cost model does not see that search_tsv is a large out-of-line
-- value (about 47 kB a row): the scan decompressed 1.4 GB of word indexes to
-- test every email, then ts_rank read the 10,297 that matched again.
--
-- Now, in two steps:
--   1. `hits`: the matching rows come from the GIN index
--      (pms_project_emails_search_idx), which needs no word index read from
--      the table, and the newest 2,000 by email_date are kept;
--   2. only those are ranked with ts_rank.
-- The same query for 'Sara': 331 ms, 21,541 buffers.
--
-- enable_seqscan is off for this function so step 1 cannot fall back to the
-- sequential scan when the planner's estimate says a seq scan is cheaper.
--
-- What changes for callers: a query that matches MORE than 2,000 emails is
-- ranked among its newest 2,000 instead of among all of them. A word that
-- common ranks poorly anyway (ts_rank counts occurrences), and the newest are
-- what such a search is usually after. A query with 2,000 matches or fewer
-- returns the same emails as before (checked on production with a temporary
-- copy, 2026-11-24: ten queries, identical rows for every one under the cap).
-- Rows that tie on rank and date now come back in record_id order, where the
-- order between them used to be arbitrary. Signature, grants and the
-- sender/direction filters (20261124100000) are unchanged.
--
-- Rollback: re-apply the function from 20261124100000.

create or replace function public.pms_emails_search_lexical(
  q           text,
  proj        text    default null,
  lim         integer default 25,
  p_sender    text    default null,
  p_direction text    default null
)
returns table (
  record_id text, project_id text, subject text, from_name text, from_address text,
  to_addresses text, direction text, email_date timestamptz, preview text,
  has_attachments boolean, rank real
)
language sql
stable
set search_path = public
set enable_seqscan = off
as $$
  with tq as (
    select websearch_to_tsquery('english', q) as tsq
  ),
  hits as materialized (
    select e.record_id as rid
    from pms_project_emails e, tq
    where e.search_tsv @@ tq.tsq
      and (proj is null or e.project_id::text = proj)
      and (nullif(btrim(p_sender), '') is null
           or position(lower(btrim(p_sender)) in lower(coalesce(e.from_address, ''))) > 0)
      and (nullif(btrim(p_direction), '') is null or e.direction = p_direction)
    order by e.email_date desc nulls last, e.record_id
    limit 2000
  )
  select e.record_id::text, e.project_id::text, e.subject::text, e.from_name::text,
         e.from_address::text, e.to_addresses::text, e.direction::text, e.email_date::timestamptz,
         e.preview::text, e.has_attachments::boolean,
         ts_rank(e.search_tsv, tq.tsq)::real as rank
  from hits h
  join pms_project_emails e on e.record_id = h.rid
  cross join tq
  order by rank desc, e.email_date desc nulls last, e.record_id
  limit greatest(1, least(coalesce(lim, 25), 100));
$$;
