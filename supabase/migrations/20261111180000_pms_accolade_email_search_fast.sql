-- Accolade-O-Meter: make the filed-email praise search finish on a real mailbox.
--
-- Symptom: the "Spotted in filed email" panel stayed empty in production while
-- praise emails demonstrably exist. The first two versions of
-- pms_accolade_email_candidates() ran instantly on a handful of test rows but
-- did far too much work per matching email on the real table:
--   * they carried every matching email's whole body through the query,
--   * they called pms_has_cap() once per matching email rather than once per
--     project,
--   * several search phrases reduced to very common words once stop words were
--     dropped ('above and beyond' -> beyond, 'very impressed' -> impress,
--     'thank you so much' -> thank ... much), so most of the mailbox matched.
-- PostgREST then cancels the call at the role's statement timeout and the page
-- gets an error instead of rows. (Inferred from the behaviour, not read from
-- the production logs.)
--
-- This version:
--   * narrows by date first, with an index on email_date to make that cheap,
--   * keeps only the ids while matching, threading and permission-checking,
--   * checks project visibility once per project,
--   * builds the highlighted snippet only for the handful of rows returned,
--   * drops the phrases that collapsed to common words,
--   * allows itself 25 seconds (PostgREST applies a function's
--     statement_timeout setting to the request).
--
-- Same contract as 20261111160000: invoker rights, so pms_project_emails RLS
-- applies; pms_has_cap('projects.view', ...) hides confidential projects; one
-- row per thread; nothing is posted without a person. Safe to run whether or
-- not 20261111160000 was applied: the function is dropped and recreated.

create index if not exists pms_project_emails_date_idx
  on public.pms_project_emails (email_date desc);

drop function if exists public.pms_accolade_email_candidates(integer, integer);

set check_function_bodies = off;
create function public.pms_accolade_email_candidates(p_days integer default 365, p_limit integer default 12)
returns table (
  record_id text, thread_key text, project_number text, project_name text,
  subject text, from_name text, from_address text, email_date timestamptz, snippet text,
  to_addresses text, cc_addresses text
)
language sql
stable
set search_path = public
set statement_timeout = '25s'
as $$
  with q as (
    select phraseto_tsquery('english', 'great job')        || phraseto_tsquery('english', 'great work')
        || phraseto_tsquery('english', 'well done')        || phraseto_tsquery('english', 'nice work')
        || phraseto_tsquery('english', 'nice job')         || phraseto_tsquery('english', 'excellent work')
        || phraseto_tsquery('english', 'excellent job')    || phraseto_tsquery('english', 'fantastic job')
        || phraseto_tsquery('english', 'fantastic work')   || phraseto_tsquery('english', 'awesome job')
        || phraseto_tsquery('english', 'awesome work')     || phraseto_tsquery('english', 'amazing job')
        || phraseto_tsquery('english', 'amazing work')     || phraseto_tsquery('english', 'outstanding work')
        || phraseto_tsquery('english', 'outstanding job')  || phraseto_tsquery('english', 'kudos')
        || phraseto_tsquery('english', 'really impressed') || phraseto_tsquery('english', 'truly impressed')
        || phraseto_tsquery('english', 'truly appreciate') || phraseto_tsquery('english', 'really appreciate')
        || phraseto_tsquery('english', 'greatly appreciate') || phraseto_tsquery('english', 'huge thanks')
        || phraseto_tsquery('english', 'extra mile')       || phraseto_tsquery('english', 'pleasure working')
        || phraseto_tsquery('english', 'hats off')         || phraseto_tsquery('english', 'commend')
        || phraseto_tsquery('english', 'bravo')            || phraseto_tsquery('english', 'congrats')
        || phraseto_tsquery('english', 'congratulations team') as tsq
  ),
  matched as materialized (            -- ids only: no bodies carried along
    select e.record_id, coalesce(nullif(e.conversation_id, ''), e.record_id) as thread_key,
           e.project_id, e.email_date
    from public.pms_project_emails e, q
    where e.email_date >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 365), 1825)))
      and e.search_tsv @@ q.tsq
  ),
  threads as (                         -- the earliest match in a thread: the email that said it
    select distinct on (m.thread_key) m.record_id, m.thread_key, m.project_id, m.email_date
    from matched m
    order by m.thread_key, m.email_date asc
  ),
  open_threads as materialized (
    select t.record_id, t.thread_key, t.project_id, t.email_date
    from threads t
    where not exists (select 1 from public.pms_accolades a
                      where a.email_thread_key = t.thread_key and a.removed_at is null)
      and not exists (select 1 from public.pms_accolade_email_dismissals d
                      where d.email_thread_key = t.thread_key)
  ),
  vis as materialized (                -- one permission check per project, not per email
    select p.id, p.project ->> 'projectNumber' as num, p.project ->> 'name' as name
    from public.pms_projects p
    where p.id in (select distinct o.project_id from open_threads o)
      and public.pms_has_cap('projects.view', p.project ->> 'projectNumber')
  ),
  picked as materialized (
    select o.record_id, o.thread_key, v.num, v.name, o.email_date
    from open_threads o
    join vis v on v.id = o.project_id
    order by o.email_date desc
    limit greatest(1, least(coalesce(p_limit, 12), 100))
  )
  select k.record_id, k.thread_key, k.num, k.name,
         e.subject, e.from_name, e.from_address, e.email_date,
         ts_headline('english', left(coalesce(nullif(e.body_text, ''), e.preview, ''), 20000), q.tsq,
                     'MaxFragments=1, MaxWords=50, MinWords=18, StartSel=«, StopSel=»'),
         e.to_addresses, e.cc_addresses
  from picked k
  join public.pms_project_emails e on e.record_id = k.record_id
  cross join q
  order by k.email_date desc
$$;
reset check_function_bodies;

revoke all on function public.pms_accolade_email_candidates(integer, integer) from public, anon;
grant execute on function public.pms_accolade_email_candidates(integer, integer) to authenticated, service_role;
