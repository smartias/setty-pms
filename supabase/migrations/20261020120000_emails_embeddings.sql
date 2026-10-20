-- pms_project_emails embeddings: step 1 of PROPOSAL-emails-embeddings.md (the
-- bounded semantic-search experiment for the filed email log). This migration
-- adds the storage, the cleaning rule, the two helpers the connector's embed
-- job calls, and a hybrid, thread-collapsing version of search_project_emails.
-- Nothing reads or writes the new columns until the connector PR ships, and
-- search_project_emails returns the same rows in the same order whenever no
-- query embedding is passed (every caller today), so applying this changes
-- nothing a user can see.
--
-- Scope: every row in pms_project_emails, for every project in the PMS,
-- whatever its status. CA projects are not special here.
--
-- Model: the Supabase edge runtime's built-in gte-small (384 dimensions,
-- normalized output), so cosine distance (<=>) is the measure and no vendor
-- is involved. The vector is derived from text the same users can already
-- read, so it gets no column-level privilege of its own.
--
-- No vector index on purpose: an exact scan over ~21,000 rows of 384
-- dimensions should answer in tens of milliseconds. Measure after the
-- backfill (supabase/emails-verify.sql) and add
-- `using hnsw (embedding extensions.vector_cosine_ops)` only past ~300 ms.
--
-- THE KEYWORD SEARCH IS NOT REWRITTEN. The live search_project_emails was
-- created in the SQL editor and its text is not in this repository (step 0 of
-- the proposal captures it). This migration renames that live function to
-- pms_emails_search_lexical, untouched, and the new search_project_emails
-- delegates every keyword ranking to it. The capture migration may be applied
-- before or after this one: before, it creates pms_emails_search_lexical
-- itself and the rename here is skipped (the old search_project_emails is
-- then dropped below); after, it re-creates the renamed function with the
-- same text, a no-op. The only things assumed about it:
-- it takes (q text, proj text, lim integer), returns one row per email with a
-- `record_id` and a numeric `rank`, and returns them best first. The capture
-- migration (20261020110000, written from pg_get_functiondef) states the
-- real text; if it disagrees with those three assumptions, fix THIS file
-- before applying either.

create extension if not exists vector with schema extensions;

alter table public.pms_project_emails
  add column if not exists embedding     extensions.vector(384),
  add column if not exists embedded_at   timestamptz,
  add column if not exists embedded_hash text;     -- md5 of the text that was embedded

-- The backfill queue: rows still to embed, newest first, so recent mail is
-- searchable by meaning first. Rows leave the index as they are embedded.
create index if not exists pms_project_emails_embed_queue_idx
  on public.pms_project_emails (email_date desc nulls last)
  where embedding is null;

-- ── Thread key ───────────────────────────────────────────────────────────────
-- Outlook's conversation id groups a thread; when it is missing the subject
-- minus its RE:/FW: prefixes stands in. Used by the search to collapse one
-- thread to one row.
create or replace function public.pms_emails_thread_subject(p_subject text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(lower(btrim(regexp_replace(
           regexp_replace(coalesce(p_subject, ''), '^\s*((re|fw|fwd|aw|wg|sv|tr|antw)\s*:\s*)+', '', 'i'),
           '\s+', ' ', 'g'))), '')
$$;

-- ── What gets embedded ───────────────────────────────────────────────────────
-- The subject (prefixes stripped) and the NEW text of the message: Outlook
-- puts the newest text first and the quoted history below it, so the body is
-- cut at the first reply marker ("-----Original Message-----", an "On … wrote:"
-- line, or a From:/Sent:/To: header block) PROVIDED the text above the marker
-- is a message of its own (40 or more non-blank characters). A forward with
-- a one-line note keeps the forwarded content, because that content is the
-- point of filing it. Known portal and legal footers, URLs, quote prefixes and
-- rule lines are removed, whitespace is collapsed, and the result is cut at
-- 1,500 characters because gte-small reads about 512 tokens.
--
-- Defined ONCE here, in SQL, so the connector never decides what text means.
-- Unlike the CA helper, the queue does NOT re-hash every row on every call
-- (21,000 bodies a minute is too much work): a tuning change to this function
-- is a migration that also runs the one-off re-queue at the bottom of this
-- file, and the store helper still refuses a row whose text moved under it.
create or replace function public.pms_emails_embed_text(p_subject text, p_body text)
returns text
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_body text := replace(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E'\r', E'\n');
  v_head text;
  v_cut  integer;
  v_pos  integer;
  v_marker text;
  v_out  text;
begin
  -- 1. earliest reply marker; keep the text above it when that text is a message
  v_cut := null;
  foreach v_marker in array array[
    E'\n[ \\t>]*-{2,}\\s*Original (Message|Appointment)\\s*-{2,}',
    E'\n[ \\t>]*On [^\\n]{4,160}wrote:[ \\t]*\\n',
    E'\n[ \\t>]*From:[^\\n]*\\n([ \\t>]*(To|Cc|Sent|Date|Subject):[^\\n]*(\\n|$))+'
  ] loop
    v_head := substring(v_body from '^(.*?)' || v_marker);   -- non-greedy first quantifier: shortest head
    if v_head is not null then
      v_pos := length(v_head);
      if v_cut is null or v_pos < v_cut then v_cut := v_pos; end if;
    end if;
  end loop;
  if v_cut is not null and length(regexp_replace(left(v_body, v_cut), '\s', '', 'g')) >= 40 then
    v_body := left(v_body, v_cut);
  end if;

  -- 2. footers: from the marker to the end
  v_body := regexp_replace(v_body,
    '(Notification generated by Newforma|To unsubscribe|This email was (sent|generated) (to you )?(automatically )?by Procore|' ||
    'This (e-?mail|message)( and any attachments)? (is|are|contains?) (intended|confidential)|CONFIDENTIALITY NOTICE|' ||
    'PRIVILEGED AND CONFIDENTIAL|DISCLAIMER:|Sent from my (iPhone|iPad|Galaxy|mobile)).*$', '', 'i');

  -- 3. noise: urls, quote prefixes, rule lines, "[cid:...]" image stubs
  v_body := regexp_replace(v_body, 'https?://\S+|www\.\S+', ' ', 'gi');
  v_body := regexp_replace(v_body, '\[cid:[^\]]*\]', ' ', 'gi');
  v_body := regexp_replace(v_body, E'(^|\\n)[ \\t]*>+', E'\\1', 'g');
  v_body := regexp_replace(v_body, E'(^|\\n)[ \\t]*[-_=*~]{3,}[ \\t]*(?=\\n|$)', E'\\1', 'g');

  -- 4. whitespace
  v_body := regexp_replace(v_body, E'[ \\t]+', ' ', 'g');
  v_body := regexp_replace(v_body, E'[ \\t]*\\n[ \\t]*', E'\n', 'g');
  v_body := regexp_replace(v_body, E'\\n{3,}', E'\n\n', 'g');

  v_out := concat_ws(E'\n',
    nullif(regexp_replace(regexp_replace(regexp_replace(coalesce(p_subject, ''),
             '^\s*((re|fw|fwd|aw|wg|sv|tr|antw)\s*:\s*)+', '', 'i'), '\s+', ' ', 'g'), '^ | $', '', 'g'), ''),
    nullif(regexp_replace(v_body, '^\s+|\s+$', '', 'g'), ''));
  return nullif(left(v_out, 1500), '');
end
$$;

-- ── Helpers for the embed job ────────────────────────────────────────────────
-- Rows with no embedding, newest first, with the text to embed and its hash.
-- The partial index above makes this an index walk that stops at p_limit.
create or replace function public.pms_emails_to_embed(p_limit integer default 20)
returns table (record_id text, embed_text text, embed_hash text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.record_id, t.embed_text, md5(t.embed_text) as embed_hash
  from public.pms_project_emails e
  cross join lateral (select public.pms_emails_embed_text(e.subject, e.body_text) as embed_text) t
  where e.embedding is null
    and t.embed_text is not null
  order by e.email_date desc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 1000))
$$;

-- One write for a whole batch: [{record_id, embed_hash, embedding:[...]}].
-- Returns the number of rows updated. A row whose text no longer hashes to
-- what was embedded is skipped and picked up next run.
create or replace function public.pms_emails_store_embeddings(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_n integer := 0;
begin
  with incoming as (
    select r->>'record_id' as record_id, r->>'embed_hash' as embed_hash,
           (r->>'embedding')::extensions.vector(384) as embedding
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where jsonb_typeof(r) = 'object' and r ? 'embedding'
  )
  update public.pms_project_emails e
  set embedding = i.embedding, embedded_hash = i.embed_hash, embedded_at = now()
  from incoming i
  where e.record_id = i.record_id
    and md5(coalesce(public.pms_emails_embed_text(e.subject, e.body_text), '')) = i.embed_hash;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.pms_emails_to_embed(integer) from public, anon, authenticated;
revoke all on function public.pms_emails_store_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public.pms_emails_to_embed(integer) to service_role;
grant execute on function public.pms_emails_store_embeddings(jsonb) to service_role;

-- ── search_project_emails: keep the live keyword function, wrap it ───────────
-- First application: the live function (the only one of that name) becomes
-- pms_emails_search_lexical. Later applications find it already there.
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc
   where proname = 'pms_emails_search_lexical' and pronamespace = 'public'::regnamespace;
  if v_n = 0 then
    select count(*) into v_n from pg_proc
     where proname = 'search_project_emails' and pronamespace = 'public'::regnamespace;
    if v_n = 1 then
      alter function public.search_project_emails rename to pms_emails_search_lexical;
    elsif v_n > 1 then
      raise exception 'search_project_emails has % overloads; rename the keyword one to pms_emails_search_lexical by hand, then re-apply', v_n;
    else
      raise exception 'search_project_emails does not exist here; apply the capture migration (20261020110000) first';
    end if;
  end if;
end $$;

-- Service-role only from here on, whatever its argument list.
do $$
declare v_fn regprocedure;
begin
  for v_fn in select p.oid::regprocedure from pg_proc p
               where p.proname = 'pms_emails_search_lexical' and p.pronamespace = 'public'::regnamespace
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end $$;

-- The new function. Two trailing parameters; with p_embedding null (every
-- caller today) it returns exactly what pms_emails_search_lexical returns, in
-- its order, one row per email, search_mode 'keyword'. With an embedding, the
-- lexical list (three times the limit) and a cosine nearest-neighbour list
-- (three times the limit, similarity >= p_min_similarity) are fused by
-- reciprocal rank (k = 50, equal weights), then collapsed to ONE ROW PER
-- THREAD: the newest matched message of the thread carries the thread's best
-- score and thread_count says how many matched messages it stands for. A row
-- in one list only still appears, so nothing the keyword search finds is lost.
-- Whatever is still called search_project_emails goes (the previous version of
-- this function on a re-apply, or the live keyword function when the capture
-- migration had already put pms_emails_search_lexical in place so the rename
-- above was skipped). PostgREST must see exactly one function of that name.
do $$
declare v_fn regprocedure;
begin
  for v_fn in select p.oid::regprocedure from pg_proc p
               where p.proname = 'search_project_emails' and p.pronamespace = 'public'::regnamespace
  loop
    execute format('drop function %s', v_fn);
  end loop;
end $$;

create function public.search_project_emails(
  q                text,
  proj             text    default null,
  lim              integer default 25,
  p_embedding      extensions.vector(384) default null,
  p_min_similarity real    default 0.75
)
returns table (
  record_id text, project_id text, subject text, from_name text, from_address text,
  to_addresses text, direction text, email_date timestamptz, preview text,
  has_attachments boolean, rank real, similarity real, thread_count integer, search_mode text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with opts as (
    select greatest(1, least(coalesce(search_project_emails.lim, 25), 100)) as n_lim,
           (search_project_emails.p_embedding is not null
              and nullif(btrim(search_project_emails.q), '') is not null)    as is_hybrid
  ),
  lex as (
    select l.record_id, l.rank::real as lex_rank, l.ordinality as lex_ix
    from opts o,
         public.pms_emails_search_lexical(search_project_emails.q, search_project_emails.proj,
                                          case when o.is_hybrid then o.n_lim * 3 else o.n_lim end)
           with ordinality as l
  ),
  sem as (
    select e.record_id,
           (1 - (e.embedding <=> search_project_emails.p_embedding))::real as similarity,
           row_number() over (order by e.embedding <=> search_project_emails.p_embedding) as sem_ix
    from public.pms_project_emails e, opts o
    where o.is_hybrid
      and e.embedding is not null
      and (search_project_emails.proj is null or e.project_id = search_project_emails.proj)
      and (1 - (e.embedding <=> search_project_emails.p_embedding)) >= coalesce(search_project_emails.p_min_similarity, 0.75)
    order by e.embedding <=> search_project_emails.p_embedding
    limit (select n_lim * 3 from opts)
  ),
  fused as (
    select coalesce(l.record_id, s.record_id) as record_id,
           l.lex_rank, l.lex_ix, s.sem_ix, s.similarity,
           (coalesce(1.0 / (50 + l.lex_ix), 0) + coalesce(1.0 / (50 + s.sem_ix), 0))::real as rrf
    from lex l
    full outer join sem s on s.record_id = l.record_id
  ),
  scored as (
    select f.record_id, f.lex_ix, f.similarity,
           case when o.is_hybrid then f.rrf else f.lex_rank end as score,
           coalesce(nullif(e.conversation_id, ''),
                    'subject:' || coalesce(public.pms_emails_thread_subject(e.subject), e.record_id)) as thread_key,
           e.project_id, e.subject, e.from_name, e.from_address, e.to_addresses, e.direction,
           e.email_date, e.preview, e.has_attachments, o.is_hybrid
    from fused f
    join public.pms_project_emails e on e.record_id = f.record_id
    cross join opts o
  ),
  threads as (
    select thread_key, max(score) as thread_score, count(*)::integer as thread_count
    from scored group by thread_key
  ),
  picked as (
    select distinct on (s.thread_key) s.*
    from scored s
    where s.is_hybrid
    order by s.thread_key, s.email_date desc nulls last, s.record_id
  ),
  out as (
    -- keyword: the lexical function's rows in the lexical function's order
    select s.record_id, s.project_id, s.subject, s.from_name, s.from_address, s.to_addresses,
           s.direction, s.email_date, s.preview, s.has_attachments,
           s.score::real as rank, s.similarity, 1 as thread_count, 'keyword'::text as search_mode,
           s.lex_ix as ord_lex, null::real as ord_score, null::timestamptz as ord_date
    from scored s
    where not s.is_hybrid
    union all
    -- hybrid: one row per thread, best thread score first
    select p.record_id, p.project_id, p.subject, p.from_name, p.from_address, p.to_addresses,
           p.direction, p.email_date, p.preview, p.has_attachments,
           t.thread_score::real as rank, p.similarity, t.thread_count, 'hybrid'::text as search_mode,
           null::bigint, t.thread_score::real, p.email_date
    from picked p
    join threads t on t.thread_key = p.thread_key
  )
  select o.record_id, o.project_id, o.subject, o.from_name, o.from_address, o.to_addresses,
         o.direction, o.email_date, o.preview, o.has_attachments,
         o.rank, o.similarity, o.thread_count, o.search_mode
  from out o
  order by o.ord_lex nulls last, o.ord_score desc nulls last, o.ord_date desc nulls last, o.record_id
  limit (select n_lim from opts)
$$;

revoke all on function public.search_project_emails(text, text, integer, extensions.vector, real)
  from public, anon, authenticated;
grant execute on function public.search_project_emails(text, text, integer, extensions.vector, real)
  to service_role;

-- ── Re-queue after a cleaning change ─────────────────────────────────────────
-- Not run here (there is nothing embedded yet). When pms_emails_embed_text
-- changes, the migration that changes it ends with this one-off, which the
-- queue then drains at the usual pace:
--
--   update public.pms_project_emails
--   set embedding = null
--   where embedding is not null
--     and embedded_hash is distinct from md5(public.pms_emails_embed_text(subject, body_text));
