-- search_ca_items: say how close each row is, and whether its words matched.
--
-- search_rfis_submittals matches a prose question by meaning beside the
-- keywords, with a cut-off of 0.75 that was never measured. On 2026-11-24
-- three questions that have nothing to do with construction (banana bread, a
-- football score, adopting a puppy) each came back with 10 RFIs and
-- submittals and nothing to tell the reader they were not real matches. The
-- email search had the same fault at 0.75 and was raised to 0.82 after its
-- similarities were measured; here they could not be, because the function
-- never returned them.
--
-- Two columns are added at the end of the result:
--   similarity   cosine similarity to the question, null when the row was not
--                among the nearest by meaning (or the call was not hybrid)
--   keyword_hit  true when the row matched the words, number, spec section,
--                discipline or status; in a plain listing every row is true
-- Nothing else changes: the same rows in the same order. The connector reads
-- columns by name, so the copy running before this deploy is unaffected.
--
-- A different result type means the function is dropped and created again;
-- its grants are repeated below.
--
-- Rollback: re-apply search_ca_items from 20261017150000.

drop function if exists public.search_ca_items(text[], text, text, text, text, text, text, boolean, integer, extensions.vector, real);

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
  has_ai_review boolean, rank real, snippet text, total bigint,
  similarity real, keyword_hit boolean
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
    count(*) over () as total,
    f.similarity,
    (f.lex_ix is not null) as keyword_hit
  from fused f
  join base b on b.project_row_id = f.project_row_id and b.item_type = f.item_type and b.item_id = f.item_id
  order by rank desc, b.date_received desc nulls last, b.number desc
  limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;

revoke all on function public.search_ca_items(text[], text, text, text, text, text, text, boolean, integer, extensions.vector, real)
  from public, anon, authenticated;
grant execute on function public.search_ca_items(text[], text, text, text, text, text, text, boolean, integer, extensions.vector, real)
  to service_role;

notify pgrst, 'reload schema';
