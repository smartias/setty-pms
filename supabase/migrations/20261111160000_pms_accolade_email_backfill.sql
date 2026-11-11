-- Accolade-O-Meter: dig further back through filed email.
--
-- pms_accolade_email_candidates() gains the email's to and cc lines, so the
-- page can pre-fill who earned the praise from who it was addressed to, and
-- its limits are raised so the wall can be backfilled: up to 5 years back
-- (was 1) and up to 100 threads per call (was 50).
--
-- Still invoker rights (pms_project_emails RLS applies), still filtered by
-- pms_has_cap('projects.view', ...), still nothing posted without a person.
-- The return type changes, so the function is dropped and recreated; the page
-- tolerates the old shape, so order of deploy does not matter.

drop function if exists public.pms_accolade_email_candidates(integer, integer);

set check_function_bodies = off;
create function public.pms_accolade_email_candidates(p_days integer default 90, p_limit integer default 12)
returns table (
  record_id text, thread_key text, project_number text, project_name text,
  subject text, from_name text, from_address text, email_date timestamptz, snippet text,
  to_addresses text, cc_addresses text
)
language sql
stable
set search_path = public
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
        || phraseto_tsquery('english', 'very impressed')   || phraseto_tsquery('english', 'really impressed')
        || phraseto_tsquery('english', 'truly appreciate') || phraseto_tsquery('english', 'really appreciate')
        || phraseto_tsquery('english', 'greatly appreciate') || phraseto_tsquery('english', 'much appreciated')
        || phraseto_tsquery('english', 'thank you so much') || phraseto_tsquery('english', 'thanks so much')
        || phraseto_tsquery('english', 'huge thanks')      || phraseto_tsquery('english', 'big thanks')
        || phraseto_tsquery('english', 'above and beyond') || phraseto_tsquery('english', 'extra mile')
        || phraseto_tsquery('english', 'pleasure working') || phraseto_tsquery('english', 'hats off')
        || phraseto_tsquery('english', 'commend')          || phraseto_tsquery('english', 'bravo') as tsq
  ),
  hits as (
    select distinct on (coalesce(nullif(e.conversation_id, ''), e.record_id))
           e.record_id, coalesce(nullif(e.conversation_id, ''), e.record_id) as thread_key,
           e.project_id, e.subject, e.from_name, e.from_address, e.email_date,
           e.to_addresses, e.cc_addresses,
           coalesce(nullif(e.body_text, ''), e.preview, '') as body
    from public.pms_project_emails e, q
    where e.search_tsv @@ q.tsq
      and e.email_date >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 1825)))
    -- earliest match in the thread: the email that said it, not a reply quoting it
    order by coalesce(nullif(e.conversation_id, ''), e.record_id), e.email_date asc
  )
  select h.record_id, h.thread_key,
         p.project ->> 'projectNumber', p.project ->> 'name',
         h.subject, h.from_name, h.from_address, h.email_date,
         ts_headline('english', left(h.body, 20000), q.tsq,
                     'MaxFragments=1, MaxWords=50, MinWords=18, StartSel=«, StopSel=»'),
         h.to_addresses, h.cc_addresses
  from hits h
  join public.pms_projects p on p.id = h.project_id
  cross join q
  where public.pms_has_cap('projects.view', p.project ->> 'projectNumber')
    and not exists (select 1 from public.pms_accolades a
                    where a.email_thread_key = h.thread_key and a.removed_at is null)
    and not exists (select 1 from public.pms_accolade_email_dismissals d
                    where d.email_thread_key = h.thread_key)
  order by h.email_date desc
  limit greatest(1, least(coalesce(p_limit, 12), 100))
$$;
reset check_function_bodies;

revoke all on function public.pms_accolade_email_candidates(integer, integer) from public, anon;
grant execute on function public.pms_accolade_email_candidates(integer, integer) to authenticated, service_role;
