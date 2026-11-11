-- Accolade-O-Meter: judge an email by what its sender wrote, not by the thread below it.
--
-- Reported with a screenshot: a reply whose whole new text was "thank you very
-- much" was suggested as praise, and was hard to read. Two causes:
--   * the search matched anywhere in body_text, which includes the quoted
--     history. The phrase that matched ("Thanks for the quick turnaround") was
--     the Setty engineer's own earlier email, quoted beneath the reply;
--   * the snippet ran the new message, signatures and quoted history together.
--
-- pms_accolade_new_text(body) returns the part of an email above the first
-- reply marker: an "-----Original Message-----" line, a "From: ... Sent: ..."
-- header block, or an "On ... wrote:" line. Unlike pms_emails_embed_text it
-- does not rely on line breaks, because some filed bodies have none.
--
-- pms_accolade_email_candidates() now:
--   * still uses the index on the whole body to find candidates, then keeps
--     only those where the praise is in the new text,
--   * returns the new text itself as the snippet (up to 1,500 characters, line
--     breaks kept, praise marked) instead of a fragment of the whole thread.
--     body_excerpt still carries the start of the full email for "read more",
--   * no longer treats "thank you so much" / "thanks so much" as praise: with
--     stop words removed they also match "thank you very much", a sign-off.
-- Everything else is as 20261111220000.

create or replace function public.pms_accolade_new_text(p_body text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(coalesce(
    substring(coalesce(p_body, '') from
      '^(.*?)(?:-{2,}\s*Original (?:Message|Appointment)|\mFrom:\s[^\n]{1,200}?\s(?:Sent|Date):\s|\mOn\s[^\n]{4,160}?\swrote:)'),
    coalesce(p_body, '')))
$$;
revoke all on function public.pms_accolade_new_text(text) from public, anon;
grant execute on function public.pms_accolade_new_text(text) to authenticated, service_role;

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
        || phraseto_tsquery('english', 'appreciate your efforts') || phraseto_tsquery('english', 'huge thanks')
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
  indexed as materialized (            -- the index pass: the praise is somewhere in the email
    select e.record_id, e.project_id, e.email_date, e.msg_id,
           public.pms_accolade_new_text(coalesce(nullif(e.body_text, ''), e.preview, '')) as new_text,
           lower(e.from_address) as sender,
           coalesce(nullif(e.conversation_id, ''), e.record_id) as old_key,
           -- subject with reply/forward prefixes removed; same rule as pms_emails_thread_subject()
           coalesce(nullif(lower(btrim(regexp_replace(
             regexp_replace(coalesce(e.subject, ''), '^\s*((re|fw|fwd|aw|wg|sv|tr|antw)\s*:\s*)+', '', 'i'),
             '\s+', ' ', 'g'))), ''), e.record_id) as subj
    from public.pms_project_emails e, q
    where e.email_date >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 365), 1825)))
      and e.search_tsv @@ q.tsq
      -- An accolade is generally an email from someone outside the firm written
      -- TO someone at Setty. Mail from a Setty sender, or with Setty people only
      -- on the cc line, is left out unless the reviewer asks for everything.
      and (coalesce(p_include_internal, false)
           or (lower(e.from_address) not like '%@setty.com'
               and lower(coalesce(e.to_addresses, '')) like '%@setty.com%'))
  ),
  matched as materialized (            -- ...and it is in what the sender wrote, not in the quoted history
    select x.record_id, x.project_id, x.email_date, x.msg_id, x.sender, x.old_key, x.subj
    from indexed x, q
    where to_tsvector('english', left(x.new_text, 6000)) @@ q.tsq
  ),
  keyed as (
    select m.*, 'subject:' || m.project_id || ':' || m.subj as thread_key from matched m
  ),
  -- Everything already decided. A decision is stored against one key, but the
  -- same conversation exists under others: a different conversation id per
  -- mailbox, a second project it was filed under, or (for older decisions) the
  -- conversation-id key used before 20261111200000. So a decision is widened to
  -- every email it could refer to, and from there to every thread and message id.
  decided_keys as materialized (
    select d.email_thread_key as k from public.pms_accolade_email_dismissals d
    union
    select a.email_thread_key from public.pms_accolades a
    where a.removed_at is null and a.email_thread_key is not null
  ),
  all_emails as materialized (         -- every filed email's ids and keys; no bodies
    select e.record_id, e.msg_id,
           coalesce(nullif(e.conversation_id, ''), e.record_id) as old_key,
           'subject:' || e.project_id || ':' || coalesce(nullif(lower(btrim(regexp_replace(
                  regexp_replace(coalesce(e.subject, ''), '^\s*((re|fw|fwd|aw|wg|sv|tr|antw)\s*:\s*)+', '', 'i'),
                  '\s+', ' ', 'g'))), ''), e.record_id) as thread_key
    from public.pms_project_emails e
  ),
  decided_emails as materialized (
    select ae.thread_key
    from all_emails ae
    where ae.old_key in (select k from decided_keys)
       or ae.thread_key in (select k from decided_keys)
       or ae.record_id in (select a.email_record_id from public.pms_accolades a
                           where a.removed_at is null and a.email_record_id is not null)
  ),
  closed as materialized (
    select k as thread_key from decided_keys
    union
    select de.thread_key from decided_emails de
  ),
  closed_msgs as materialized (        -- every message in a closed thread, wherever else it was filed
    select distinct ae.msg_id
    from all_emails ae
    where coalesce(ae.msg_id, '') <> '' and ae.thread_key in (select c.thread_key from closed c)
  ),
  open_threads as materialized (       -- threads with no decided email in them
    select k.thread_key
    from keyed k
    group by k.thread_key
    having not coalesce(bool_or(k.thread_key in (select c.thread_key from closed c)
                                or coalesce(k.msg_id, '') in (select m.msg_id from closed_msgs m)), false)
  ),
  threads as (                         -- the earliest match in a thread: the email that said it
    select distinct on (k.thread_key) k.record_id, k.thread_key, k.project_id, k.email_date, k.sender, k.subj
    from keyed k
    join open_threads o on o.thread_key = k.thread_key
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
         -- the sender's own words, whole, with line breaks kept and the praise marked
         ts_headline('english',
                     left(public.pms_accolade_new_text(coalesce(nullif(e.body_text, ''), e.preview, '')), 1500),
                     q.tsq, 'HighlightAll=true, StartSel=«, StopSel=»'),
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
