-- Meaning-based search for the knowledge layer: lessons, best practices,
-- engineering standards and agency preferences.
--
-- These four are searched by words (pms-mcp knowledgeQuery.ts). Words do not
-- help when the asker and the entry use different ones: "luminaire" appears in
-- none of them, though there are entries about lighting. Filed emails and
-- RFIs/submittals already carry a gte-small vector per row and return the
-- nearest rows by meaning beside the keyword matches; this gives the knowledge
-- layer the same, at about 540 rows.
--
-- The vectors live in ONE side table keyed by (kind, row_key), not in a column
-- on each of the four tables: the PMS pages and the connector read those
-- tables with select=*, and a 384-number column would ride along on every
-- read.
--
--   pms_knowledge_embed_source()      the served rows and the text embedded
--   pms_knowledge_to_embed(limit)     rows with no vector, or whose text changed
--   pms_knowledge_store_embeddings()  writes a batch; drops vectors of rows no
--                                     longer served
--   pms_knowledge_semantic(...)       nearest served rows to a query vector
--
-- "Served" is the same rule the tools apply: lessons and practices
-- 'approved', standards 'active', agency preferences not 'archived'. A lesson
-- tied to a project the caller cannot see is filtered by the connector, which
-- looks every returned key up in the rows it has already filtered.
--
-- The connector embeds the queue from its existing once-a-minute embed job
-- (pms-mcp /admin/emails-embed, when the email queue is empty) and the query
-- at search time. Kill switch: function secret KNOWLEDGE_SEMANTIC=0.
--
-- Rollback: drop the four functions, then the table. Nothing else reads them.

create table if not exists public.pms_knowledge_embeddings (
  kind        text not null check (kind in ('lesson', 'practice', 'standard', 'agency_pref')),
  row_key     uuid not null,
  embed_hash  text not null,
  embedding   extensions.vector(384) not null,
  embedded_at timestamptz not null default now(),
  primary key (kind, row_key)
);

-- Service role only (the connector). No policies: nothing else may read it.
alter table public.pms_knowledge_embeddings enable row level security;

comment on table public.pms_knowledge_embeddings is
  'gte-small vectors for the served knowledge rows (lessons, best practices, engineering standards, agency preferences), written by pms-mcp. embed_hash is md5 of the text embedded.';

-- The text embedded for each served row: the labels a person would search by
-- on one line, then the entry itself. Capped at 2,000 characters; the model
-- reads about 512 tokens.
create or replace function public.pms_knowledge_embed_source()
returns table (kind text, row_key uuid, embed_text text)
language sql
stable
security definer
set search_path = public
as $$
  select s.kind, s.row_key, left(s.embed_text, 2000)
  from (
    select 'lesson'::text as kind, l.lesson_id as row_key,
           btrim(concat_ws(E'\n', nullif(concat_ws(' | ', l.agency, l.discipline, l.system, l.issue_type), ''), l.lesson_summary)) as embed_text
    from public.pms_lessons l where l.status = 'approved'
    union all
    select 'practice', p.practice_id,
           btrim(concat_ws(E'\n', p.title, nullif(concat_ws(' | ', p.discipline, p.system, p.coord_theme, p.issue_type), ''), p.practice_text))
    from public.pms_best_practices p where p.status = 'approved'
    union all
    select 'standard', st.standard_id,
           btrim(concat_ws(E'\n', nullif(concat_ws(' | ', st.discipline, st.system), ''), st.standard_text, st.basis))
    from public.pms_engineering_standards st where st.status = 'active'
    union all
    select 'agency_pref', a.pref_id,
           btrim(concat_ws(E'\n', nullif(concat_ws(' | ', a.agency, a.preference_type, a.discipline, a.applies_to), ''), a.requirement_or_preference, a.notes))
    from public.pms_agency_preferences a where a.status is distinct from 'archived'
  ) s
  where s.embed_text <> ''
$$;

create or replace function public.pms_knowledge_to_embed(p_limit integer default 50)
returns table (kind text, row_key uuid, embed_text text, embed_hash text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select s.kind, s.row_key, s.embed_text, md5(s.embed_text) as embed_hash
  from public.pms_knowledge_embed_source() s
  left join public.pms_knowledge_embeddings e on e.kind = s.kind and e.row_key = s.row_key
  where e.row_key is null or e.embed_hash is distinct from md5(s.embed_text)
  order by s.kind, s.row_key
  limit greatest(1, least(coalesce(p_limit, 50), 500))
$$;

-- One write for a batch: [{kind, row_key, embed_hash, embedding:[...]}].
-- Returns the number of rows written. A row whose text changed between the
-- read and the write (hash no longer matches) is skipped and comes back on
-- the next pass. Vectors of rows that are no longer served are removed here.
create or replace function public.pms_knowledge_store_embeddings(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_n integer := 0;
begin
  with incoming as (
    select r->>'kind' as kind, (r->>'row_key')::uuid as row_key,
           r->>'embed_hash' as embed_hash, (r->>'embedding')::extensions.vector(384) as embedding
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where jsonb_typeof(r) = 'object' and r ? 'embedding'
  )
  insert into public.pms_knowledge_embeddings as e (kind, row_key, embed_hash, embedding, embedded_at)
  select i.kind, i.row_key, i.embed_hash, i.embedding, now()
  from incoming i
  join public.pms_knowledge_embed_source() s on s.kind = i.kind and s.row_key = i.row_key
  where md5(s.embed_text) = i.embed_hash
  on conflict (kind, row_key) do update
    set embed_hash = excluded.embed_hash, embedding = excluded.embedding, embedded_at = excluded.embedded_at;
  get diagnostics v_n = row_count;

  delete from public.pms_knowledge_embeddings e
  where not exists (
    select 1 from public.pms_knowledge_embed_source() s where s.kind = e.kind and s.row_key = e.row_key
  );
  return v_n;
end
$$;

-- The served rows nearest a query vector, nearest first. The join to the
-- source is what keeps an archived or unapproved row from being returned
-- between the moment it stops being served and the next store call.
create or replace function public.pms_knowledge_semantic(
  p_embedding      extensions.vector(384),
  p_kinds          text[],
  p_limit          integer default 8,
  p_min_similarity real    default 0.8
)
returns table (kind text, row_key uuid, similarity real)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.kind, e.row_key, (1 - (e.embedding <=> p_embedding))::real as similarity
  from public.pms_knowledge_embeddings e
  join public.pms_knowledge_embed_source() s on s.kind = e.kind and s.row_key = e.row_key
  where e.kind = any(p_kinds)
    and (1 - (e.embedding <=> p_embedding)) >= coalesce(p_min_similarity, 0.8)
  order by e.embedding <=> p_embedding
  limit greatest(1, least(coalesce(p_limit, 8), 50))
$$;

revoke all on function public.pms_knowledge_embed_source() from public, anon, authenticated;
revoke all on function public.pms_knowledge_to_embed(integer) from public, anon, authenticated;
revoke all on function public.pms_knowledge_store_embeddings(jsonb) from public, anon, authenticated;
revoke all on function public.pms_knowledge_semantic(extensions.vector, text[], integer, real) from public, anon, authenticated;
grant execute on function public.pms_knowledge_embed_source() to service_role;
grant execute on function public.pms_knowledge_to_embed(integer) to service_role;
grant execute on function public.pms_knowledge_store_embeddings(jsonb) to service_role;
grant execute on function public.pms_knowledge_semantic(extensions.vector, text[], integer, real) to service_role;
