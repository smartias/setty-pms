-- Accolade-O-Meter: make email suggestions easier to judge, and stop repeating them.
--
-- Admin feedback after the review queue went live:
--   * suggestions should generally come from outside the firm, not from Setty
--     people writing to each other,
--   * the short snippet was not enough to decide whether something belongs on
--     the wall, or to work out who at Setty it was about,
--   * the same praise showed up several times.
--
-- Why it repeated: suggestions were grouped by conversation_id. As
-- 20261029120000 found for the email search, one conversation filed from two
-- mailboxes carries two different conversation ids, and some rows have none.
-- Replies that quote the praise back were also matching in their own right.
--
-- pms_accolade_email_candidates() now:
--   * takes p_include_internal (default false): emails from @setty.com senders
--     are left out unless asked for, which also drops Setty replies quoting
--     the praise,
--   * groups by project and subject with RE:/FW: removed, the same rule the
--     PMS email search uses, and shows the earliest matching email of each,
--   * shows the same email once when it was filed under two projects,
--   * returns a longer highlighted snippet (about 130 words around the praise)
--     and body_excerpt, the first 4,000 characters, for a "read more" view,
--   * looks for a much wider vocabulary of praise (about 80 phrases, up from
--     30), since the first list found too little,
--   * always includes mail addressed to awards@setty.com, whoever sent it.
--
-- Earlier decisions still hold: a thread counts as handled if it was approved
-- or dismissed under the old conversation-id key, the new subject key, or (for
-- approvals) the same message filed elsewhere.
--
-- Otherwise as 20261111180000: invoker rights, projects.view filter, the 25
-- second allowance. The signature changes, so the two-argument version is
-- dropped; the page falls back to it if this file has not been applied.

drop function if exists public.pms_accolade_email_candidates(integer, integer);
drop function if exists public.pms_accolade_email_candidates(integer, integer, boolean);

set check_function_bodies = off;
create function public.pms_accolade_email_candidates(
  p_days integer default 365, p_limit integer default 12, p_include_internal boolean default false)
returns table (
  record_id text, thread_key text, project_number text, project_name text,
  subject text, from_name text, from_address text, email_date timestamptz, snippet text,
  to_addresses text, cc_addresses text, body_excerpt text
)
language sql
stable
set search_path = public
set statement_timeout = '25s'
as $$
  with q as (
    -- Praise wording. Each phrase was checked against the english text-search
    -- configuration; ones that collapse to a common or trade word once stop words
    -- and stemming are applied were left out (grateful -> grate, responsiveness ->
    -- respons, hats off -> hat, home run is a wiring term, exceptional -> except).
    select phraseto_tsquery('english', 'great job') || phraseto_tsquery('english', 'great work')
        || phraseto_tsquery('english', 'good job') || phraseto_tsquery('english', 'good work')
        || phraseto_tsquery('english', 'nice job') || phraseto_tsquery('english', 'nice work')
        || phraseto_tsquery('english', 'well done') || phraseto_tsquery('english', 'excellent job')
        || phraseto_tsquery('english', 'excellent work') || phraseto_tsquery('english', 'fantastic job')
        || phraseto_tsquery('english', 'fantastic work') || phraseto_tsquery('english', 'awesome job')
        || phraseto_tsquery('english', 'awesome work') || phraseto_tsquery('english', 'amazing job')
        || phraseto_tsquery('english', 'amazing work') || phraseto_tsquery('english', 'wonderful job')
        || phraseto_tsquery('english', 'wonderful work') || phraseto_tsquery('english', 'outstanding job')
        || phraseto_tsquery('english', 'outstanding work') || phraseto_tsquery('english', 'terrific job')
        || phraseto_tsquery('english', 'terrific work') || phraseto_tsquery('english', 'impressive work')
        || phraseto_tsquery('english', 'superb') || phraseto_tsquery('english', 'stellar')
        || phraseto_tsquery('english', 'top notch') || phraseto_tsquery('english', 'nicely done')
        || phraseto_tsquery('english', 'beautifully done') || phraseto_tsquery('english', 'great effort')
        || phraseto_tsquery('english', 'great team') || phraseto_tsquery('english', 'great presentation')
        || phraseto_tsquery('english', 'great report') || phraseto_tsquery('english', 'great drawings')
        || phraseto_tsquery('english', 'looks great') || phraseto_tsquery('english', 'kudos')
        || phraseto_tsquery('english', 'bravo') || phraseto_tsquery('english', 'congrats')
        || phraseto_tsquery('english', 'congratulations') || phraseto_tsquery('english', 'commend')
        || phraseto_tsquery('english', 'applaud') || phraseto_tsquery('english', 'well deserved')
        || phraseto_tsquery('english', 'accolade') || phraseto_tsquery('english', 'compliment')
        || phraseto_tsquery('english', 'praise') || phraseto_tsquery('english', 'in recognition')
        || phraseto_tsquery('english', 'impressed') || phraseto_tsquery('english', 'really appreciate')
        || phraseto_tsquery('english', 'truly appreciate') || phraseto_tsquery('english', 'greatly appreciate')
        || phraseto_tsquery('english', 'sincerely appreciate') || phraseto_tsquery('english', 'deeply appreciate')
        || phraseto_tsquery('english', 'appreciate your hard work') || phraseto_tsquery('english', 'appreciate the effort')
        || phraseto_tsquery('english', 'appreciate your efforts') || phraseto_tsquery('english', 'thank you so much')
        || phraseto_tsquery('english', 'thanks so much') || phraseto_tsquery('english', 'huge thanks')
        || phraseto_tsquery('english', 'big thanks') || phraseto_tsquery('english', 'special thanks')
        || phraseto_tsquery('english', 'thank you for your hard work') || phraseto_tsquery('english', 'thanks for your hard work')
        || phraseto_tsquery('english', 'gratitude') || phraseto_tsquery('english', 'pleasure working')
        || phraseto_tsquery('english', 'pleasure to work') || phraseto_tsquery('english', 'enjoyed working')
        || phraseto_tsquery('english', 'easy to work with') || phraseto_tsquery('english', 'extra mile')
        || phraseto_tsquery('english', 'beyond expectations') || phraseto_tsquery('english', 'exceeded expectations')
        || phraseto_tsquery('english', 'exceeded our expectations') || phraseto_tsquery('english', 'quick turnaround')
        || phraseto_tsquery('english', 'fast turnaround') || phraseto_tsquery('english', 'attention to detail')
        || phraseto_tsquery('english', 'team player') || phraseto_tsquery('english', 'lifesaver')
        || phraseto_tsquery('english', 'life saver') || phraseto_tsquery('english', 'rock star')
        || phraseto_tsquery('english', 'rockstar') || phraseto_tsquery('english', 'saved the day')
        || phraseto_tsquery('english', 'proud of') || phraseto_tsquery('english', 'went above and beyond')
        || phraseto_tsquery('english', 'going above and beyond') || phraseto_tsquery('english', 'gone above and beyond') as tsq
  ),
  matched as materialized (            -- ids and keys only: no bodies carried along
    select e.record_id, e.project_id, e.email_date, e.msg_id,
           lower(e.from_address) as sender,
           coalesce(nullif(e.conversation_id, ''), e.record_id) as old_key,
           -- subject with reply/forward prefixes removed; same rule as pms_emails_thread_subject()
           coalesce(nullif(lower(btrim(regexp_replace(
             regexp_replace(coalesce(e.subject, ''), '^\s*((re|fw|fwd|aw|wg|sv|tr|antw)\s*:\s*)+', '', 'i'),
             '\s+', ' ', 'g'))), ''), e.record_id) as subj
    from public.pms_project_emails e, q
    where e.email_date >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 365), 1825)))
      and e.search_tsv @@ q.tsq
      -- praise worth posting usually comes from outside the firm; anything sent
      -- to the awards@ mailbox was forwarded there as praise, whoever sent it
      and (coalesce(p_include_internal, false)
           or lower(e.from_address) not like '%@setty.com'
           or lower(coalesce(e.to_addresses, '') || ' ' || coalesce(e.cc_addresses, '')) like '%awards@setty.com%')
  ),
  keyed as (
    select m.*, 'subject:' || m.project_id || ':' || m.subj as thread_key from matched m
  ),
  closed as materialized (             -- threads someone has already decided on
    select distinct k.thread_key
    from keyed k
    where exists (select 1 from public.pms_accolade_email_dismissals d
                  where d.email_thread_key in (k.thread_key, k.old_key))
       or exists (select 1 from public.pms_accolades a
                  where a.removed_at is null and a.email_thread_key in (k.thread_key, k.old_key))
       or exists (select 1 from public.pms_accolades a
                  join public.pms_project_emails ae on ae.record_id = a.email_record_id
                  where a.removed_at is null and coalesce(k.msg_id, '') <> '' and ae.msg_id = k.msg_id)
  ),
  threads as (                         -- the earliest match in a thread: the email that said it
    select distinct on (k.thread_key) k.record_id, k.thread_key, k.project_id, k.email_date, k.sender, k.subj
    from keyed k
    where not exists (select 1 from closed c where c.thread_key = k.thread_key)
    order by k.thread_key, k.email_date asc
  ),
  uniq as materialized (               -- one email filed under two projects is one suggestion
    select distinct on (t.sender, t.subj, date_trunc('minute', t.email_date))
           t.record_id, t.thread_key, t.project_id, t.email_date
    from threads t
    order by t.sender, t.subj, date_trunc('minute', t.email_date), t.record_id
  ),
  vis as materialized (                -- one permission check per project, not per email
    select p.id, p.project ->> 'projectNumber' as num, p.project ->> 'name' as name
    from public.pms_projects p
    where p.id in (select distinct u.project_id from uniq u)
      and public.pms_has_cap('projects.view', p.project ->> 'projectNumber')
  ),
  picked as materialized (
    select u.record_id, u.thread_key, v.num, v.name, u.email_date
    from uniq u
    join vis v on v.id = u.project_id
    order by u.email_date desc
    limit greatest(1, least(coalesce(p_limit, 12), 100))
  )
  select k.record_id, k.thread_key, k.num, k.name,
         e.subject, e.from_name, e.from_address, e.email_date,
         ts_headline('english', left(coalesce(nullif(e.body_text, ''), e.preview, ''), 20000), q.tsq,
                     'MaxFragments=1, MaxWords=130, MinWords=70, StartSel=«, StopSel=»'),
         e.to_addresses, e.cc_addresses,
         left(coalesce(nullif(e.body_text, ''), e.preview, ''), 4000)
  from picked k
  join public.pms_project_emails e on e.record_id = k.record_id
  cross join q
  order by k.email_date desc
$$;
reset check_function_bodies;

revoke all on function public.pms_accolade_email_candidates(integer, integer, boolean) from public, anon;
grant execute on function public.pms_accolade_email_candidates(integer, integer, boolean) to authenticated, service_role;
