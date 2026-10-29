-- Email embeddings: strip the mail-client banners Outlook and Exchange put
-- ABOVE a message, from both the embed text and the search snippet.
--
-- Why: after 20261029140000 the first production snippet for Andrew
-- Davidson's chiller reply began "Some people who received this message
-- don't often get email from andrew.davidson@southern-air.com. Learn why
-- this is important", because that notice sits above the reply marker and
-- so is part of the "new text" of the message. The same words were in the
-- text its vector was made from, which pulls every flagged external email
-- a little towards each other and away from what they say.
--
-- What changes:
--   pms_emails_strip_banners(text)  new, shared helper: removes the Outlook
--       unfamiliar-sender notice ("Some people who received this message
--       don't often get email from …", "You don't often get email from …",
--       "Learn why this is important") and whole lines that are an
--       external-sender warning ("External Email: …", "[EXTERNAL] …",
--       "** WARNING: This email originated from outside …", "CAUTION: …
--       outside the organization"). Nothing else; a WARNING: line that does
--       not say outside/external stays, it may be engineering content.
--   pms_emails_embed_text            calls it (step 3b).
--   search_project_emails            the quoted-history snippet fallback
--       calls it instead of its own shorter list (same rows, same order,
--       same columns as 20261029140000).
--
-- Re-embedding WITHOUT a gap in search: a cleaning change makes the stored
-- vector of every affected row stale. The re-queue in 20261020120000's
-- comment nulls the embedding, which would hide those rows from
-- meaning-based search until the one-minute job reached them (at ~5 rows a
-- minute, hours). Instead:
--   * a row whose text changed keeps its vector and gets embedded_at = null
--     (a second partial index, pms_project_emails_embed_stale_idx, lists
--     those rows);
--   * pms_emails_to_embed lists never-embedded rows first and stale rows
--     after them, newest first in each, still as two index walks;
--   * pms_emails_store_embeddings is unchanged: it overwrites the vector
--     and stamps embedded_at, and its hash guard still applies.
-- The one-off at the bottom marks the stale rows (and blanks the vector of
-- a row whose cleaned text is now empty, which must not match anything).
-- Running it again is a no-op for rows already re-embedded. It re-cleans
-- only bodies that contain banner words (about 20 s locally for 7,000 such
-- rows among 22,000); if the SQL editor cuts it off, run the same statement
-- with an `and email_date >= '…' and email_date < '…'` slice added to its
-- inner where clause, a year at a time.
--
-- Apply after 20261029140000; safe to run twice. No connector change: the
-- embed job reads pms_emails_to_embed as before. The verify script's
-- coverage query now also counts `stale`.

-- ── The banner helper ────────────────────────────────────────────────────────
-- Takes newline-normalised text (\n only). Flags: g all matches, i case
-- insensitive, n newline-sensitive (^ and $ match at line ends, [^…] and
-- . never cross a line). Removed lines leave a blank line; both callers
-- collapse whitespace afterwards.
create or replace function public.pms_emails_strip_banners(p_text text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p_text, ''),
               -- Outlook's unfamiliar-sender notice, with or without its "Learn why" tail
               '(Some people who received this message|You) don[''’]?t often get e-?mail from [^ \t\n]+[ \t]*\.?([ \t\n]*Learn why this is important[^\n]*)?',
               '', 'gi'),
             -- its tail on a line of its own
             '^[ \t]*Learn why this is important[^\n]*$', '', 'gin'),
           -- external-sender warnings: a line that names them as such
           '^[ \t]*\*{0,3}[ \t]*(' ||
             '\[?(external( e-?mail| sender| message)?)\]?[ \t]*([:!\-–][^\n]*)?' ||
             '|(warning|caution|attention)[ \t]*[:!\-–][^\n]*(outside|external)[^\n]*' ||
             '|[^\n]{0,60}(originat\w*|came|comes|is|was sent) from outside( of)? ((the|your|our|this) )?(organi[sz]ation|company|firm|network|agency|university|district|county|city|school|setty)[^\n]*' ||
           ')$', '', 'gin')
$$;

-- ── Embed text: the same function as 20261020120000 plus step 3b ─────────────
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
  -- 3b. mail-client banners above the message (unfamiliar-sender notices,
  --     "external email" warnings): see pms_emails_strip_banners
  v_body := public.pms_emails_strip_banners(v_body);
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

-- ── Stale rows keep their vector ─────────────────────────────────────────────
create index if not exists pms_project_emails_embed_stale_idx
  on public.pms_project_emails (email_date desc nulls last)
  where embedded_at is null and embedding is not null;

-- Never-embedded rows first, then stale ones; newest first in each. Each
-- branch is one partial-index walk that stops at p_limit, so the job still
-- does not re-hash the table. A row whose cleaned text is empty is listed
-- by neither.
create or replace function public.pms_emails_to_embed(p_limit integer default 20)
returns table (record_id text, embed_text text, embed_hash text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 20), 1000)) as n),
  fresh as (
    select e.record_id, e.email_date, t.embed_text
    from public.pms_project_emails e
    cross join lateral (select public.pms_emails_embed_text(e.subject, e.body_text) as embed_text) t
    where e.embedding is null
      and t.embed_text is not null
    order by e.email_date desc nulls last
    limit (select n from lim)
  ),
  stale as (
    select e.record_id, e.email_date, t.embed_text
    from public.pms_project_emails e
    cross join lateral (select public.pms_emails_embed_text(e.subject, e.body_text) as embed_text) t
    where e.embedded_at is null and e.embedding is not null
      and t.embed_text is not null
    order by e.email_date desc nulls last
    limit (select n from lim)
  )
  select q.record_id, q.embed_text, md5(q.embed_text) as embed_hash
  from (
    select 0 as pri, * from fresh
    union all
    select 1 as pri, * from stale
  ) q
  order by q.pri, q.email_date desc nulls last
  limit (select n from lim)
$$;

revoke all on function public.pms_emails_to_embed(integer) from public, anon, authenticated;
grant execute on function public.pms_emails_to_embed(integer) to service_role;

-- ── The search function: the snippet fallback uses the shared helper ─────────
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
  -- header lines, "On … wrote:" lines, rule lines, mail-client banners
  -- (pms_emails_strip_banners, shared with the embed text), urls and quote
  -- prefixes removed. A row found by meaning alone, or whose
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
           regexp_replace(regexp_replace(regexp_replace(public.pms_emails_strip_banners(regexp_replace(
             replace(replace(coalesce(s.snippet_body, ''), E'\r\n', E'\n'), E'\r', E'\n'),
             E'(^|\\n)[ \\t>]*((From|Sent|To|Cc|Date|Subject):[^\\n]*|-{2,}\\s*Original (Message|Appointment)\\s*-{2,}|On [^\\n]{4,160}wrote:[ \\t]*|[-_=*~]{3,}[ \\t]*)(?=\\n|$)', E'\\1', 'g')),
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

-- ── One-off: mark the rows whose embed text changed ──────────────────────────
-- Keeps the vector (the row stays searchable by meaning, on its old text)
-- and clears embedded_at so the job re-embeds it. A row whose cleaned text
-- is now empty loses its vector: it was made of banner text only.
update public.pms_project_emails e
set embedding     = case when t.embed_text is null then null else e.embedding end,
    embedded_hash = case when t.embed_text is null then null else e.embedded_hash end,
    embedded_at   = null
from (select record_id, public.pms_emails_embed_text(subject, body_text) as embed_text
      from public.pms_project_emails
      where embedding is not null
        -- only a body with banner words can have changed; skips the regex work on the rest
        and body_text ~* '(often get e-?mail from|learn why this is important|external|from outside)') t
where t.record_id = e.record_id
  and e.embedded_hash is distinct from md5(coalesce(t.embed_text, ''));
