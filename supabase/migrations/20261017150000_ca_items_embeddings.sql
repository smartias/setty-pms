-- pms_ca_items embeddings: step 1 of PROPOSAL-ca-items-embeddings.md (the
-- bounded semantic-search experiment). This migration adds the storage, the
-- two helpers the connector's embed job calls, and the hybrid mode of
-- search_ca_items. Nothing reads or writes the new columns until the connector
-- PR ships, and search_ca_items behaves exactly as before whenever no query
-- embedding is passed, so applying this changes nothing a user can see.
--
-- Model: the Supabase edge runtime's built-in gte-small (384 dimensions,
-- normalized output), so cosine distance (<=>) is the measure and no vendor
-- is involved. If the model ever changes, null the column and the sync
-- re-embeds everything (pms_ca_items_to_embed finds the rows).
--
-- No vector index on purpose: a sequential scan over ~2,900 rows of 384
-- dimensions is milliseconds. Add `using hnsw (embedding extensions.vector_cosine_ops)`
-- past ~50,000 rows.

create extension if not exists vector with schema extensions;

alter table public.pms_ca_items
  add column if not exists embedding     extensions.vector(384),
  add column if not exists embedded_at   timestamptz,
  add column if not exists embedded_hash text;     -- md5 of the text that was embedded

-- ── What gets embedded ───────────────────────────────────────────────────────
-- subject + the body, minus the two boilerplate blocks that open most CA
-- records (the submittal NOTATIONS item 1 and the RFI "General Notations"
-- paragraph), cut at 1,500 characters because gte-small reads ~512 tokens.
-- Defined ONCE here, in SQL, so the connector never decides what text means:
-- a tuning change is a migration that bumps the text, and the hash then
-- re-embeds only what changed.
create or replace function public.pms_ca_items_embed_text(p_subject text, p_body text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(left(btrim(concat_ws(E'\n',
    nullif(btrim(coalesce(p_subject, '')), ''),
    nullif(btrim(
      regexp_replace(
        regexp_replace(coalesce(p_body, ''),
          -- submittal boilerplate: "NOTATIONS: 1. Comments, corrections, approvals, or provisional acceptance ... " up to item 2
          -- (a Postgres ARE takes the greediness of its FIRST quantifier, so `.*?` would be
          -- greedy here; a lookahead-guarded loop stops at the boundary either way)
          'NOTATIONS:\s*1\.\s*Comments, corrections, approvals, or provisional acceptance((?!\s2\.\s).)*', 'NOTATIONS:', 'i'),
        -- RFI boilerplate: "General Notations: This RFI, RFI response, and related correspondence ... " up to "Response:"
        'General Notations:\s*This RFI, RFI response, and related correspondence((?!Response:).)*', '', 'i')
    ), '')
  )), 1500), '')
$$;

-- ── Helpers for the embed job ────────────────────────────────────────────────
-- Rows whose embedding is missing or was made from different text: the hash is
-- the truth, so a reconcile rewrite or a status edit that left the text alone
-- costs nothing, and an edit is picked up even inside the same transaction
-- (where now() would make embedded_at and projected_at equal). embedded_at is
-- for reporting only.
create or replace function public.pms_ca_items_to_embed(p_limit integer default 200)
returns table (project_row_id text, item_type text, item_id text, embed_text text, embed_hash text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select c.project_row_id, c.item_type, c.item_id, t.embed_text, md5(t.embed_text) as embed_hash
  from public.pms_ca_items c
  cross join lateral (select public.pms_ca_items_embed_text(c.subject, c.body_text) as embed_text) t
  where t.embed_text is not null
    and (c.embedding is null or c.embedded_hash is distinct from md5(t.embed_text))
  order by c.projected_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- One write for a whole batch: [{project_row_id, item_type, item_id, embed_hash, embedding:[...]}].
-- Returns the number of rows updated. A row whose text changed between the
-- read and the write (hash no longer matches) is skipped and picked up next run.
create or replace function public.pms_ca_items_store_embeddings(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_n integer := 0;
begin
  with incoming as (
    select r->>'project_row_id' as project_row_id, r->>'item_type' as item_type, r->>'item_id' as item_id,
           r->>'embed_hash' as embed_hash, (r->>'embedding')::extensions.vector(384) as embedding
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where jsonb_typeof(r) = 'object' and r ? 'embedding'
  )
  update public.pms_ca_items c
  set embedding = i.embedding, embedded_hash = i.embed_hash, embedded_at = now()
  from incoming i
  where c.project_row_id = i.project_row_id and c.item_type = i.item_type and c.item_id = i.item_id
    and md5(coalesce(public.pms_ca_items_embed_text(c.subject, c.body_text), '')) = i.embed_hash;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.pms_ca_items_to_embed(integer) from public, anon, authenticated;
revoke all on function public.pms_ca_items_store_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public.pms_ca_items_to_embed(integer) to service_role;
grant execute on function public.pms_ca_items_store_embeddings(jsonb) to service_role;

-- ── search_ca_items: optional hybrid mode ────────────────────────────────────
-- Two new trailing parameters. With p_embedding null (every caller today) the
-- function is the 20261017140000 version, result for result. With an
-- embedding, and only in text mode, the lexical ranking and a cosine
-- nearest-neighbour list are fused by reciprocal rank (k = 50, equal weights):
-- a row high in both lists comes first, a row in one list only still appears.
-- The number and spec shapes and the plain listing never use the embedding.
-- `total` in hybrid mode = every lexical match + the semantic-only additions.
-- A different argument list is a different function to Postgres, so the old
-- one is dropped (PostgREST would otherwise see an ambiguous overload).

drop function if exists public.search_ca_items(text[], text, text, text, text, text, text, boolean, integer);

create function public.search_ca_items(
  p_row_ids        text[],
  p_text           text    default null,
  p_number         text    default null,
  p_spec           text    default null,
  p_type           text    default null,
  p_status         text    default null,
  p_discipline     text    default null,
  p_open_only      boolean default false,
  p_limit          integer default 30,
  p_embedding      extensions.vector(384) default null,
  p_min_similarity real    default 0.75
)
returns table (
  project_row_id text, project_number text, item_type text, item_id text, number text,
  subject text, discipline text, spec_section text, status text, is_open boolean,
  date_received date, due_date date, date_closed date, link_count integer,
  has_ai_review boolean, rank real, snippet text, total bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select
      case when nullif(btrim(p_text), '') is not null then websearch_to_tsquery('english', p_text) end as tsq,
      nullif(regexp_replace(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '^0+(?=\d)', ''), '') as num_digits,
      nullif(btrim(p_number), '')                                                                   as num_token,
      nullif(btrim(p_text), '')                                                                     as text_token,
      nullif(regexp_replace(coalesce(p_spec, ''), '\D', '', 'g'), '')                               as spec_digits,
      greatest(1, least(coalesce(p_limit, 30), 100))                                                as lim,
      -- hybrid only in text mode, with an embedding, and never for a number or spec query
      (p_embedding is not null and nullif(btrim(p_text), '') is not null
         and nullif(btrim(p_number), '') is null and nullif(btrim(p_spec), '') is null)             as hybrid
  ),
  base as (
    select c.*, q.tsq, q.num_token, q.spec_digits, q.text_token, q.lim, q.hybrid,
      coalesce(q.num_token is not null
               and (regexp_replace(regexp_replace(coalesce(c.number, ''), '\D', '', 'g'), '^0+(?=\d)', '') = q.num_digits
                    or (q.num_token !~ '^\d+$' and c.number ilike '%' || q.num_token || '%')), false) as number_hit,
      coalesce(q.spec_digits is not null
               and regexp_replace(coalesce(c.spec_section, ''), '\D', '', 'g') = q.spec_digits, false) as spec_hit,
      coalesce(q.tsq is not null and c.search_tsv @@ q.tsq, false)                                   as text_hit,
      coalesce(q.text_token is not null
               and (c.discipline ilike '%' || q.text_token || '%' or c.status ilike '%' || q.text_token || '%'), false) as field_hit
    from public.pms_ca_items c
    cross join q
    where c.project_row_id = any (coalesce(p_row_ids, '{}'::text[]))
      and (p_type is null or c.item_type = p_type)
      and (p_status is null or c.status = p_status)
      and (p_discipline is null or lower(coalesce(c.discipline, '')) = lower(p_discipline))
      and (not coalesce(p_open_only, false) or c.is_open)
  ),
  lexical as (
    select b.project_row_id, b.item_type, b.item_id,
      ( (case when b.number_hit then 10 else 0 end)
      + (case when b.spec_hit then 5 else 0 end)
      + (case when b.field_hit then 1 else 0 end)
      + (case when b.text_hit then ts_rank_cd(b.search_tsv, b.tsq) else 0 end) )::real as lex_rank
    from base b
    where (b.num_token is null and b.spec_digits is null and b.text_token is null)
       or b.number_hit or b.spec_hit or b.text_hit or b.field_hit
  ),
  lexical_ranked as (
    select l.*, row_number() over (order by l.lex_rank desc) as lex_ix
    from lexical l
  ),
  semantic as (
    select b.project_row_id, b.item_type, b.item_id,
      (1 - (b.embedding <=> p_embedding))::real as similarity,
      row_number() over (order by b.embedding <=> p_embedding) as sem_ix
    from base b
    where b.hybrid and b.embedding is not null
      and (1 - (b.embedding <=> p_embedding)) >= coalesce(p_min_similarity, 0.75)
    order by b.embedding <=> p_embedding
    limit greatest(1, least(coalesce(p_limit, 30), 100)) * 2
  ),
  fused as (
    select coalesce(l.project_row_id, s.project_row_id) as project_row_id,
           coalesce(l.item_type, s.item_type)           as item_type,
           coalesce(l.item_id, s.item_id)               as item_id,
           l.lex_rank, l.lex_ix, s.sem_ix, s.similarity
    from lexical_ranked l
    full outer join semantic s
      on l.project_row_id = s.project_row_id and l.item_type = s.item_type and l.item_id = s.item_id
  )
  select
    b.project_row_id, b.project_number, b.item_type, b.item_id, b.number, b.subject, b.discipline,
    b.spec_section, b.status, b.is_open, b.date_received, b.due_date, b.date_closed,
    jsonb_array_length(b.links)::integer as link_count, b.has_ai_review,
    case when b.hybrid
         then (coalesce(1.0 / (50 + f.lex_ix), 0) + coalesce(1.0 / (50 + f.sem_ix), 0))::real
         else f.lex_rank end as rank,
    case when b.text_hit
         then ts_headline('english', coalesce(b.body_text, ''), b.tsq,
                          'StartSel=[, StopSel=], MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "')
         else left(coalesce(b.response, b.description, b.subject, ''), 200) end as snippet,
    count(*) over () as total
  from fused f
  join base b on b.project_row_id = f.project_row_id and b.item_type = f.item_type and b.item_id = f.item_id
  order by rank desc, b.date_received desc nulls last, b.number desc
  limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;

revoke all on function public.search_ca_items(text[], text, text, text, text, text, text, boolean, integer, extensions.vector, real)
  from public, anon, authenticated;
grant execute on function public.search_ca_items(text[], text, text, text, text, text, text, boolean, integer, extensions.vector, real)
  to service_role;
