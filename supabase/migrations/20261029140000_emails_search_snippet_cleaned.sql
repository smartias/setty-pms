-- search_project_emails: the keyword snippet is cut from the CLEANED text.
--
-- Why: 20261029130000 ran ts_headline over the raw body, and in a long reply
-- chain the matched word was often inside a quoted "Subject: RE: … Chiller …"
-- header line, so three of the five rows of the first production search
-- showed header junk instead of the author's words. Now the highlighter
-- first tries the subject plus the cleaned new text of the message (the
-- text its vector was made from, so a match on the subject alone shows the
-- author's own words after it); when the words are only in the quoted
-- history it falls back to the whole body with header lines, reply markers,
-- external-sender banners, rule lines, urls and quote prefixes removed, so
-- the quoted match still shows without the headers around it; and when the
-- exchange matched on another message than the one shown it gives the start
-- of the cleaned text, as a meaning-only row does. Whitespace is flattened
-- in every case.
--
-- Argument list, return type, ranking and the other columns are unchanged
-- (the function is still dropped and re-created so this applies in any
-- order after 20261020120000). No connector change: it reads `snippet`
-- as before. Safe to run twice.

-- ── The function, dropped by name (its return type changes) ──────────────────
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
  has_attachments boolean, rank real, similarity real, thread_count integer, search_mode text,
  snippet text, keyword_hit boolean, best_record_id text
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
           e.body_text,
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
  -- The best-matching message of each exchange (highest fused score, then
  -- similarity, then newest) and whether any message of it matched the words.
  -- It is what the snippet is cut from: the newest message of a thread is
  -- often a one-line reply, the best-matching one is the message that answers.
  best as (
    select distinct on (s.subject_key)
           s.subject_key, s.record_id as best_record_id, s.body_text as best_body,
           bool_or(s.lex_ix is not null) over (partition by s.subject_key) as any_keyword_hit
    from scored s
    where s.is_hybrid
    order by s.subject_key, s.score desc, s.similarity desc nulls last, s.email_date desc nulls last, s.record_id
  ),
  merged as (
    select distinct on (pt.subject_key)
           pt.record_id, pt.project_id, pt.subject, pt.from_name, pt.from_address, pt.to_addresses,
           pt.direction, pt.email_date, pt.preview, pt.has_attachments,
           max(pt.thread_score) over (partition by pt.subject_key)                 as group_score,
           max(pt.similarity)   over (partition by pt.subject_key)                 as group_similarity,
           (sum(pt.thread_count) over (partition by pt.subject_key))::integer      as group_count,
           b.best_record_id, b.best_body, b.any_keyword_hit
    from (
      select p.*, t.thread_score, t.thread_count
      from picked p
      join threads t on t.thread_key = p.thread_key
    ) pt
    join best b on b.subject_key = pt.subject_key
    order by pt.subject_key, pt.email_date desc nulls last, pt.record_id
  ),
  out as (
    -- keyword: the lexical function's rows in the lexical function's order
    select s.record_id, s.project_id, s.subject, s.from_name, s.from_address, s.to_addresses,
           s.direction, s.email_date, s.preview, s.has_attachments,
           s.score::real as rank, s.similarity, 1 as thread_count, 'keyword'::text as search_mode,
           s.body_text as snippet_body, true as keyword_hit, s.record_id as best_record_id,
           s.lex_ix as ord_lex, null::real as ord_score, null::timestamptz as ord_date
    from scored s
    where not s.is_hybrid
    union all
    -- hybrid: one row per exchange, best score first
    select m.record_id, m.project_id, m.subject, m.from_name, m.from_address, m.to_addresses,
           m.direction, m.email_date, m.preview, m.has_attachments,
           m.group_score::real as rank, m.group_similarity, m.group_count, 'hybrid'::text as search_mode,
           m.best_body as snippet_body, m.any_keyword_hit as keyword_hit, m.best_record_id,
           null::bigint, m.group_score::real, m.email_date
    from merged m
  ),
  shown as (
    select o.*
    from out o
    order by o.ord_lex nulls last, o.ord_score desc nulls last, o.ord_date desc nulls last, o.record_id
    limit (select n_lim from opts)
  )
  -- The snippet is cut here, after the limit, so ts_headline runs on the rows
  -- returned and not on every candidate. A row that matched the words gets
  -- the words in context, marked [like this], cut from the subject plus the
  -- CLEANED new text of the message (what its vector was made from) when the
  -- words are in it; when the words are only in the quoted history below the
  -- reply marker, from the whole body with its From:/Sent:/To:/Subject:
  -- header lines, "On … wrote:" lines, external-sender banners, rule lines,
  -- urls and quote prefixes removed. A row found by meaning alone, or whose
  -- exchange matched on another message, gets the start of the cleaned new
  -- text (no subject: that is its own column).
  select s.record_id, s.project_id, s.subject, s.from_name, s.from_address, s.to_addresses,
         s.direction, s.email_date, s.preview, s.has_attachments,
         s.rank, s.similarity, s.thread_count, s.search_mode,
         regexp_replace(
           case
             when c.tsq is not null and to_tsvector('english', c.clean_kw) @@ c.tsq then
               ts_headline('english', c.clean_kw, c.tsq,
                           'StartSel=[, StopSel=], MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "')
             when c.tsq is not null and to_tsvector('english', c.whole) @@ c.tsq then
               ts_headline('english', c.whole, c.tsq,
                           'StartSel=[, StopSel=], MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "')
             else left(c.clean, 240)
           end, '\s+', ' ', 'g') as snippet,
         s.keyword_hit, s.best_record_id
  from shown s
  cross join lateral (
    select regexp_replace(coalesce(public.pms_emails_embed_text(null, s.snippet_body), ''), '\s+', ' ', 'g') as clean,
           regexp_replace(coalesce(public.pms_emails_embed_text(s.subject, s.snippet_body), ''), '\s+', ' ', 'g') as clean_kw,
           regexp_replace(regexp_replace(regexp_replace(regexp_replace(
             replace(replace(coalesce(s.snippet_body, ''), E'\r\n', E'\n'), E'\r', E'\n'),
             E'(^|\\n)[ \\t>]*((From|Sent|To|Cc|Date|Subject):[^\\n]*|-{2,}\\s*Original (Message|Appointment)\\s*-{2,}|On [^\\n]{4,160}wrote:[ \\t]*|' ||
             E'\\*{0,3}[ \\t]*(WARNING|CAUTION|EXTERNAL( EMAIL| SENDER)?|External( Email| Sender)?)\\s*[:!-][^\\n]*|[-_=*~]{3,}[ \\t]*)(?=\\n|$)', E'\\1', 'g'),
             'https?://\S+|www\.\S+|\[cid:[^\]]*\]', ' ', 'gi'),
             E'(^|\\n)[ \\t]*>+', E'\\1', 'g'),
             '\s+', ' ', 'g') as whole,
           case when s.keyword_hit and nullif(btrim(search_project_emails.q), '') is not null
                then websearch_to_tsquery('english', search_project_emails.q) end as tsq
  ) c
  order by s.ord_lex nulls last, s.ord_score desc nulls last, s.ord_date desc nulls last, s.record_id
$$;

revoke all on function public.search_project_emails(text, text, integer, extensions.vector, real)
  from public, anon, authenticated;
grant execute on function public.search_project_emails(text, text, integer, extensions.vector, real)
  to service_role;
