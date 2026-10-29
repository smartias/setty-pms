-- search_project_emails: collapse one exchange to one row even when it was
-- filed from more than one mailbox or without a conversation id.
--
-- Why: the ten-question experiment of 2026-10-29 (EXPERIMENT-emails-semantic.md)
-- showed the same subject twice in two hybrid top fives. The production query
-- on the four messages involved showed both causes:
--   * two Kissena "Inspection Approved" messages had DIFFERENT conversation ids
--     that decode to a per-mailbox GUID followed by an IDENTICAL 16-byte tail:
--     one conversation, filed from two mailboxes;
--   * a Bunker Hill "Energy Model" message had a NULL conversation_id, so it
--     fell back to its subject while its sibling used the id, and the two keys
--     never met.
-- What it does: the same function as 20261020120000 with a second collapse
-- pass on (project, subject with RE:/FW: removed), and a project in the
-- subject fallback of the first pass (before, two projects' rows without a
-- conversation id and with one subject could be grouped together). Keyword
-- mode and the signature are unchanged. A cost to know: two genuinely different threads in
-- one project that share a subject (a generic "Meeting", say) now show as one
-- row with a combined count; the newest message is still the one shown.
--
-- Apply it after 20261020120000, whose objects it needs
-- (pms_emails_search_lexical, pms_emails_thread_subject). It replaces only
-- this one function and is safe to run twice.

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
                    'subject:' || e.project_id || ':' || coalesce(public.pms_emails_thread_subject(e.subject), e.record_id)) as thread_key,
           e.project_id || ':' || coalesce(public.pms_emails_thread_subject(e.subject), e.record_id) as subject_key,
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
  -- Pass 2: one exchange filed from two mailboxes carries two conversation ids
  -- (the id starts with a per-mailbox prefix), and a row filed without an id
  -- falls back to its subject, so pass 1 can leave the same exchange in two
  -- groups. Merge groups that share a project and a subject (RE:/FW: ignored):
  -- the newest message represents the merged group, counts add up, and the
  -- best score and similarity of the group are kept. Pass 1 stays, so a thread
  -- whose subject was edited still merges inside one mailbox.
  merged as (
    select distinct on (pt.subject_key)
           pt.record_id, pt.project_id, pt.subject, pt.from_name, pt.from_address, pt.to_addresses,
           pt.direction, pt.email_date, pt.preview, pt.has_attachments,
           max(pt.thread_score) over (partition by pt.subject_key)                 as group_score,
           max(pt.similarity)   over (partition by pt.subject_key)                 as group_similarity,
           (sum(pt.thread_count) over (partition by pt.subject_key))::integer      as group_count
    from (
      select p.*, t.thread_score, t.thread_count
      from picked p
      join threads t on t.thread_key = p.thread_key
    ) pt
    order by pt.subject_key, pt.email_date desc nulls last, pt.record_id
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
    -- hybrid: one row per exchange, best score first
    select m.record_id, m.project_id, m.subject, m.from_name, m.from_address, m.to_addresses,
           m.direction, m.email_date, m.preview, m.has_attachments,
           m.group_score::real as rank, m.group_similarity, m.group_count, 'hybrid'::text as search_mode,
           null::bigint, m.group_score::real, m.email_date
    from merged m
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
