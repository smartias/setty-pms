-- Thread collapse fix for search_project_emails (found by the 2026-10-21 email
-- experiment, EXPERIMENT-emails-semantic.md, question 2).
--
-- The hybrid search shows one row per thread, keyed on conversation_id and, when
-- that is null, on the normalised subject. A message filed with no conversation
-- id and a reply filed with one never shared a key, so the same exchange could
-- fill two rows of a top five ("PS 9R Stormwater Tank Location" and its reply).
-- A row without a conversation id now joins an existing conversation of the same
-- project and normalised subject; with none to join it keeps the subject key as
-- before. Nothing else changes: same signature, same columns, same ranking, same
-- keyword mode. Safe to re-run. Applied by hand, like the other email migrations.

create or replace function public.search_project_emails(
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
                    -- a row filed without a conversation id joins a conversation of the same
                    -- project and normalised subject when one exists (the original message of
                    -- an exchange is sometimes filed before Outlook gave it an id)
                    (select min(e2.conversation_id)
                       from public.pms_project_emails e2
                      where nullif(e.conversation_id, '') is null
                        and e2.project_id = e.project_id
                        and nullif(e2.conversation_id, '') is not null
                        and public.pms_emails_thread_subject(e2.subject) = public.pms_emails_thread_subject(e.subject)),
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
