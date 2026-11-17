-- Accolade-O-Meter: make the filed-email praise search instant by remembering
-- which emails contain praise, instead of re-searching the whole mailbox on
-- every page load.
--
-- Why: pms_accolade_email_candidates() took 16-18 seconds in production (29.6k
-- filed emails) whatever the date window, and the page got a 57014 timeout.
-- Measured on the live table: the ~80-phrase OR query cannot be answered from
-- the GIN index alone (phrase matches need a recheck), so the index returned
-- ~12,300 candidate emails and Postgres re-read each one's full search text
-- (~65,000 buffer reads) to keep the 679 that pass the sender filters and the
-- 110 that really praise the sender's own words. The decided-thread logic was
-- not the problem (0.4s).
--
-- This migration:
--   1. pms_accolade_praise_query(): the praise phrases, in one place. The old
--      function carried the same list inline.
--   2. pms_accolade_email_hits: one row per filed email whose own new text (the
--      part above the quoted history, per pms_accolade_new_text) contains
--      praise, with the keys the candidates function needs (project, sender,
--      thread subject, external-sender flag).
--   3. A trigger on pms_project_emails keeps it current as mail is filed or
--      edited. It never blocks filing: any error inside it is swallowed.
--   4. pms_accolade_rebuild_email_hits(): rebuilds the table from scratch.
--      Run it after changing the phrase list in pms_accolade_praise_query().
--   5. pms_accolade_email_candidates() reads the table. Same signature, same
--      columns, same decided-thread, de-dup and visibility rules as
--      20261111240000; only the "find the praise" step changed.
--
-- Security: the candidates function still runs with the caller's rights, so
-- pms_project_emails RLS and pms_has_cap('projects.view', ...) apply exactly as
-- before. The hits table carries a select policy that only shows a row when the
-- caller can see the email behind it. The trigger function is SECURITY DEFINER
-- (whoever files the email must be able to record the hit) with a pinned
-- search_path, and is not executable by API roles.
--
-- Nothing is posted by this: suggestions still need a person to accept them.

set check_function_bodies = off;

-- 1. The praise phrases. Each was checked against the english configuration;
--    ones that collapse to a common or trade word after stemming were left out
--    (grateful -> grate, responsiveness -> respons, hats off -> hat, home run is
--    a wiring term, exceptional -> except).
create or replace function public.pms_accolade_praise_query()
returns tsquery
language plpgsql
stable
set search_path = public
as $$
declare
  phrases text[] := array[
    'great job','great work','good job','good work','nice job','nice work','well done',
    'excellent job','excellent work','fantastic job','fantastic work','awesome job',
    'awesome work','amazing job','amazing work','wonderful job','wonderful work',
    'outstanding job','outstanding work','terrific job','terrific work','impressive work',
    'superb','stellar','top notch','nicely done','beautifully done','great effort',
    'great team','great presentation','great report','great drawings','looks great',
    'kudos','bravo','congrats','congratulations','commend','applaud','well deserved',
    'accolade','compliment','praise','in recognition','impressed','really appreciate',
    'truly appreciate','greatly appreciate','sincerely appreciate','deeply appreciate',
    'appreciate your hard work','appreciate the effort','appreciate your efforts',
    'huge thanks','big thanks','special thanks','thank you for your hard work',
    'thanks for your hard work','gratitude','pleasure working','pleasure to work',
    'enjoyed working','easy to work with','extra mile','beyond expectations',
    'exceeded expectations','exceeded our expectations','quick turnaround',
    'fast turnaround','attention to detail','team player','lifesaver','life saver',
    'rock star','rockstar','saved the day','proud of','went above and beyond',
    'going above and beyond','gone above and beyond'];
  p text;
  q tsquery;
begin
  foreach p in array phrases loop
    q := case when q is null then phraseto_tsquery('english', p)
              else q || phraseto_tsquery('english', p) end;
  end loop;
  return q;
end
$$;

-- 2. The hits table.
create table if not exists public.pms_accolade_email_hits (
  record_id   text primary key references public.pms_project_emails (record_id) on delete cascade,
  project_id  text,
  email_date  timestamptz,
  msg_id      text,
  sender      text,                 -- lower(from_address)
  old_key     text,                 -- conversation id (or record id), the pre-20261111200000 thread key
  subj        text,                 -- subject without reply/forward prefixes; same rule as the candidates function
  is_external boolean not null,     -- from outside the firm and addressed to someone at Setty
  scanned_at  timestamptz not null default now()
);
create index if not exists pms_accolade_email_hits_date_idx
  on public.pms_accolade_email_hits (email_date desc);

alter table public.pms_accolade_email_hits enable row level security;
drop policy if exists pms_accolade_email_hits_read on public.pms_accolade_email_hits;
create policy pms_accolade_email_hits_read on public.pms_accolade_email_hits
  for select to authenticated
  using (exists (select 1 from public.pms_project_emails e
                 where e.record_id = pms_accolade_email_hits.record_id));
revoke all on public.pms_accolade_email_hits from public, anon;
grant select on public.pms_accolade_email_hits to authenticated;
grant all on public.pms_accolade_email_hits to service_role;

-- 3. Keep it current. Fires only when a column that decides the answer changes,
--    so embedding / saved_to_sharepoint updates cost nothing.
create or replace function public.pms_accolade_email_hit_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nt text;
begin
  begin
    delete from public.pms_accolade_email_hits where record_id = new.record_id;
    nt := public.pms_accolade_new_text(coalesce(nullif(new.body_text, ''), new.preview, ''));
    if nt <> '' and to_tsvector('english', left(nt, 6000)) @@ public.pms_accolade_praise_query() then
      insert into public.pms_accolade_email_hits
        (record_id, project_id, email_date, msg_id, sender, old_key, subj, is_external)
      values (
        new.record_id, new.project_id, new.email_date, new.msg_id,
        lower(new.from_address),
        coalesce(nullif(new.conversation_id, ''), new.record_id),
        coalesce(nullif(lower(btrim(regexp_replace(
          regexp_replace(coalesce(new.subject, ''), '^\s*((re|fw|fwd|aw|wg|sv|tr|antw)\s*:\s*)+', '', 'i'),
          '\s+', ' ', 'g'))), ''), new.record_id),
        lower(coalesce(new.from_address, '')) not like '%@setty.com'
          and lower(coalesce(new.to_addresses, '')) like '%@setty.com%'
      );
    end if;
  exception when others then
    null;   -- never let praise bookkeeping stop an email from being filed
  end;
  return new;
end
$$;
revoke all on function public.pms_accolade_email_hit_sync() from public, anon, authenticated;

drop trigger if exists trg_pms_accolade_email_hit_sync on public.pms_project_emails;
create trigger trg_pms_accolade_email_hit_sync
  after insert or update of body_text, preview, subject, from_address, to_addresses,
                            project_id, conversation_id, msg_id, email_date
  on public.pms_project_emails
  for each row execute function public.pms_accolade_email_hit_sync();

-- 4. Full rebuild (used below for the first fill; rerun after editing the phrases).
create or replace function public.pms_accolade_rebuild_email_hits()
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '10min'
as $$
declare
  n integer;
begin
  delete from public.pms_accolade_email_hits;
  insert into public.pms_accolade_email_hits
    (record_id, project_id, email_date, msg_id, sender, old_key, subj, is_external)
  select s.record_id, s.project_id, s.email_date, s.msg_id, s.sender, s.old_key, s.subj,
         s.sender not like '%@setty.com' and s.to_lc like '%@setty.com%'
  from (
    select e.record_id, e.project_id, e.email_date, e.msg_id,
           lower(coalesce(e.from_address, '')) as sender,
           lower(coalesce(e.to_addresses, '')) as to_lc,
           coalesce(nullif(e.conversation_id, ''), e.record_id) as old_key,
           coalesce(nullif(lower(btrim(regexp_replace(
             regexp_replace(coalesce(e.subject, ''), '^\s*((re|fw|fwd|aw|wg|sv|tr|antw)\s*:\s*)+', '', 'i'),
             '\s+', ' ', 'g'))), ''), e.record_id) as subj,
           public.pms_accolade_new_text(coalesce(nullif(e.body_text, ''), e.preview, '')) as nt
    from public.pms_project_emails e
    where e.search_tsv @@ public.pms_accolade_praise_query()   -- index pass, then the exact check below
  ) s
  where s.nt <> '' and to_tsvector('english', left(s.nt, 6000)) @@ public.pms_accolade_praise_query();
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function public.pms_accolade_rebuild_email_hits() from public, anon, authenticated;
grant execute on function public.pms_accolade_rebuild_email_hits() to service_role;

-- 5. The candidates function, now reading the hits table.
create or replace function public.pms_accolade_email_candidates(
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
    select public.pms_accolade_praise_query() as tsq
  ),
  matched as materialized (            -- emails already known to praise, inside the window
    select h.record_id, h.project_id, h.email_date, h.msg_id, h.sender, h.old_key, h.subj
    from public.pms_accolade_email_hits h
    where h.email_date >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 365), 1825)))
      -- An accolade is generally an email from someone outside the firm written
      -- TO someone at Setty. Mail from a Setty sender, or with Setty people only
      -- on the cc line, is left out unless the reviewer asks for everything.
      and (coalesce(p_include_internal, false) or h.is_external)
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

-- First fill. Takes roughly as long as one old search (~20s) and runs once.
select public.pms_accolade_rebuild_email_hits();
