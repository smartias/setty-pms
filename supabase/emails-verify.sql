-- pms_project_emails embeddings — PRODUCTION checks for migration
-- 20261020120000. Read-only except section 0. Run sections one at a time in
-- the Supabase SQL editor.

-- ── 0. BEFORE applying: capture the live keyword search (step 0 of the proposal) ──
-- Paste the whole result into the capture migration (20261020110000) so the
-- repository holds the function the hybrid search wraps. The three things
-- the wrapper assumes are visible in the output: the argument list
-- (q text, proj text, lim integer), a record_id column and a numeric rank
-- column in the result, ordered best first.
select 'func' as kind, pg_get_functiondef(p.oid) as detail
from pg_proc p
where p.proname in ('search_project_emails', 'pms_emails_search_lexical')
  and p.pronamespace = 'public'::regnamespace
union all
select 'col', column_name || ' ' || data_type || ' nullable=' || is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'pms_project_emails'
union all
select 'idx', indexdef from pg_indexes
where schemaname = 'public' and tablename = 'pms_project_emails'
order by 1, 2;

-- ── 1. AFTER applying: the objects exist, exactly one of each ─────────────────
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('search_project_emails', 'pms_emails_search_lexical', 'pms_emails_embed_text',
                    'pms_emails_thread_subject', 'pms_emails_to_embed', 'pms_emails_store_embeddings')
order by 1;

-- ── 2. Keyword search unchanged: the wrapper returns the lexical rows in order ──
-- Both lists must be identical. Pick any query that returns a few rows.
select 'lexical' as side, l.record_id, l.rank from public.pms_emails_search_lexical('chiller', null, 10) l
union all
select 'wrapper', w.record_id, w.rank from public.search_project_emails('chiller', null, 10) w;

-- ── 3. Coverage (run during and after the backfill) ──────────────────────────
select count(*)                                   as emails,
       count(*) filter (where embedding is not null) as embedded,
       count(*) filter (where embedding is null
                          and public.pms_emails_embed_text(subject, body_text) is not null) as queued,
       count(*) filter (where embedding is null
                          and public.pms_emails_embed_text(subject, body_text) is null)     as nothing_to_embed,
       max(embedded_at)                           as newest_embedding
from public.pms_project_emails;

-- per project, so a project whose mail never gets embedded stands out
select p.project->>'projectNumber' as project, p.project->>'status' as status,
       count(e.record_id) as filed, count(e.embedding) as embedded
from public.pms_projects p
join public.pms_project_emails e on e.project_id = p.id
group by 1, 2 order by 3 desc limit 40;

-- ── 4. What the queue would hand the job next (sanity on the cleaning) ────────
select record_id, left(embed_text, 300) as embed_text, length(embed_text) as chars
from public.pms_emails_to_embed(5);

-- ── 5. Latency after the backfill (decides whether an index is needed) ───────
-- Replace the zero vector with any stored embedding; a sequential cosine scan
-- over ~21,000 rows should be tens of milliseconds. Add an HNSW index only
-- past ~300 ms.
explain (analyze, buffers, timing)
select record_id from public.pms_project_emails
where embedding is not null
order by embedding <=> (select embedding from public.pms_project_emails where embedding is not null limit 1)
limit 75;

-- ── 6. Thread collapse in hybrid mode (needs a query embedding; the connector
--       PR adds a route for this, until then run through search_project_emails
--       with any stored embedding as a stand-in for a query) ──────────────────
select record_id, subject, thread_count, rank, similarity, search_mode
from public.search_project_emails('chiller', null, 10,
       (select embedding from public.pms_project_emails where embedding is not null limit 1));
