-- Filed emails: calendar replies and records with no subject are not searched
-- by meaning.
--
-- search_emails returns the emails nearest a question by vector beside the
-- keyword matches. Seven live searches on 2026-11-24 showed what fills the
-- list when little is close: calendar replies. "city rejected permit request
-- over wrong job number" returned the right thread first (0.852) and then
-- three "Declined: ..." meeting replies at 0.841 to 0.844. A calendar reply
-- has no body worth the name, so its vector is its subject line and sits near
-- anything that mentions the same project or the same verb. A fourth probe
-- returned a record with the subject "{}", no sender and no date.
--
-- Those rows are now left without a vector:
--   * calendar replies: subject begins Accepted: / Declined: / Tentative: /
--     Tentatively Accepted: / Canceled: / Cancelled:   (301 rows)
--   * no subject, or the literal "{}"                  (2 rows)
-- They stay in the log and are still found by their words. Only the
-- meaning-based half of search_project_emails skips them, because it reads
-- rows `where embedding is not null`.
--
--   pms_emails_skip_meaning(subject)  the rule, in one place
--   pms_emails_to_embed(limit)        the embed queue no longer offers them
--   one-off update                    clears the vectors they already carry
--
-- Rollback: re-apply pms_emails_to_embed from 20261029150000 and drop
-- pms_emails_skip_meaning; the embed job gives the rows their vectors back.

create or replace function public.pms_emails_skip_meaning(p_subject text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select btrim(coalesce(p_subject, '')) in ('', '{}')
      or coalesce(p_subject, '') ~* '^\s*(accepted|declined|tentative|tentatively accepted|canceled|cancelled)\s*:'
$$;

revoke all on function public.pms_emails_skip_meaning(text) from public, anon, authenticated;
grant execute on function public.pms_emails_skip_meaning(text) to service_role;

-- The queue, as in 20261029150000, with the rule added to both branches.
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
    cross join lateral (select public.pms_emails_embed_text(e.subject, e.body_text, e.from_name, e.from_address, e.attachment_names) as embed_text) t
    where e.embedding is null
      and t.embed_text is not null
      and not public.pms_emails_skip_meaning(e.subject)
    order by e.email_date desc nulls last
    limit (select n from lim)
  ),
  stale as (
    select e.record_id, e.email_date, t.embed_text
    from public.pms_project_emails e
    cross join lateral (select public.pms_emails_embed_text(e.subject, e.body_text, e.from_name, e.from_address, e.attachment_names) as embed_text) t
    where e.embedded_at is null and e.embedding is not null
      and t.embed_text is not null
      and not public.pms_emails_skip_meaning(e.subject)
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

-- One-off: clear the vectors these rows already carry.
update public.pms_project_emails e
   set embedding = null, embedded_hash = null, embedded_at = null
 where e.embedding is not null
   and public.pms_emails_skip_meaning(e.subject);
