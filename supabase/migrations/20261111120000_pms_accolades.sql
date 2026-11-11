-- Accolades: positive feedback from clients and colleagues, shown on
-- Accolades.html (the Accolade-O-Meter) with a daily guessing game and a
-- quarterly points race. Counting rules live in accolades.js.
--
--   pms_accolades                  one row per piece of praise
--   pms_accolade_cheers            one cheer per person per accolade
--   pms_accolade_plays             one daily-game guess per person per day
--   pms_accolade_email_dismissals  filed-email threads marked "not an accolade"
--   pms_accolade_settings          the monthly goal and reward (single row)
--   pms_accolade_email_candidates  filed emails that read like praise
--
-- Visibility: the wall is firm-wide. Every signed-in user reads everything
-- here; anon reads nothing. People write only rows stamped with their own
-- JWT email. Nothing is hard-deleted: an accolade is taken down by stamping
-- removed_at (its author or a PMS admin), so the record survives.
--
-- Email suggestions never copy an email onto the wall by themselves. The
-- candidates function only lists filed emails the CALLER may already read
-- (invoker rights, so pms_project_emails RLS applies) on projects the caller
-- may view (pms_has_cap 'projects.view', which is what hides confidential
-- projects), and a person decides what, if anything, to post.

create table if not exists public.pms_accolades (
  id                bigint generated always as identity primary key,
  kind              text not null default 'client',
  quote             text not null,
  recipients        text[] not null,              -- display names, in the order entered
  recipient_emails  text[] not null default '{}', -- same order; '' where the name is not on the staff list
  from_name         text,
  from_company      text,
  project_number    text,
  project_name      text,
  received_on       date not null default current_date,
  source            text not null default 'manual',
  email_record_id   text,                         -- pms_project_emails.record_id when sourced from a filed email
  email_thread_key  text,                         -- that email's conversation id (or record id): one accolade per thread
  created_by        text not null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  removed_at        timestamptz,
  removed_by        text,

  constraint pms_accolades_kind_chk check (kind in ('client','internal')),
  constraint pms_accolades_source_chk check (source in ('manual','email')),
  constraint pms_accolades_quote_chk check (char_length(btrim(quote)) between 3 and 2000),
  constraint pms_accolades_recipients_chk check (cardinality(recipients) between 1 and 25),
  constraint pms_accolades_emails_chk check (cardinality(recipient_emails) <= 25),
  constraint pms_accolades_removed_chk check ((removed_at is null) = (removed_by is null))
);

create index if not exists pms_accolades_received_idx
  on public.pms_accolades (received_on desc) where removed_at is null;
create unique index if not exists pms_accolades_thread_uidx
  on public.pms_accolades (email_thread_key)
  where email_thread_key is not null and removed_at is null;

create table if not exists public.pms_accolade_cheers (
  accolade_id bigint not null references public.pms_accolades (id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  constraint pms_accolade_cheers_pkey primary key (accolade_id, email)
);

create table if not exists public.pms_accolade_plays (
  email       text not null,
  play_date   date not null,
  accolade_id bigint not null references public.pms_accolades (id) on delete cascade,
  correct     boolean not null,
  created_at  timestamptz not null default now(),
  constraint pms_accolade_plays_pkey primary key (email, play_date)
);

create table if not exists public.pms_accolade_email_dismissals (
  email_thread_key text not null,
  dismissed_by     text not null,
  dismissed_at     timestamptz not null default now(),
  constraint pms_accolade_email_dismissals_pkey primary key (email_thread_key)
);

create table if not exists public.pms_accolade_settings (
  id           integer not null default 1,
  monthly_goal integer not null default 20,
  reward       text,
  updated_by   text,
  updated_at   timestamptz not null default now(),
  constraint pms_accolade_settings_pkey primary key (id),
  constraint pms_accolade_settings_single_chk check (id = 1),
  constraint pms_accolade_settings_goal_chk check (monthly_goal between 1 and 500)
);
insert into public.pms_accolade_settings (id) values (1) on conflict (id) do nothing;

-- Caller identity is the JWT email, the same claim is_pms_admin() reads.
create or replace function public.pms_accolades_caller_email()
returns text
language sql
stable
set search_path = public
as $$
  select lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'email', ''))
$$;

alter table public.pms_accolades enable row level security;
alter table public.pms_accolade_cheers enable row level security;
alter table public.pms_accolade_plays enable row level security;
alter table public.pms_accolade_email_dismissals enable row level security;
alter table public.pms_accolade_settings enable row level security;

drop policy if exists pms_accolades_select on public.pms_accolades;
create policy pms_accolades_select on public.pms_accolades
  for select to authenticated using (true);

drop policy if exists pms_accolades_insert on public.pms_accolades;
create policy pms_accolades_insert on public.pms_accolades
  for insert to authenticated
  with check (pms_accolades_caller_email() <> ''
              and lower(created_by) = pms_accolades_caller_email()
              and removed_at is null);

-- Taking one down (or an admin correcting one). Authors and admins only.
drop policy if exists pms_accolades_update on public.pms_accolades;
create policy pms_accolades_update on public.pms_accolades
  for update to authenticated
  using (lower(created_by) = pms_accolades_caller_email() or is_pms_admin())
  with check (lower(created_by) = pms_accolades_caller_email() or is_pms_admin());

drop policy if exists pms_accolade_cheers_select on public.pms_accolade_cheers;
create policy pms_accolade_cheers_select on public.pms_accolade_cheers
  for select to authenticated using (true);
drop policy if exists pms_accolade_cheers_insert on public.pms_accolade_cheers;
create policy pms_accolade_cheers_insert on public.pms_accolade_cheers
  for insert to authenticated
  with check (pms_accolades_caller_email() <> '' and lower(email) = pms_accolades_caller_email());
drop policy if exists pms_accolade_cheers_delete on public.pms_accolade_cheers;
create policy pms_accolade_cheers_delete on public.pms_accolade_cheers
  for delete to authenticated
  using (lower(email) = pms_accolades_caller_email());

-- One guess per person per day: the primary key refuses a second, and there is
-- no update or delete policy. play_date is the player's local day, so allow a
-- day either side of the server's date for time zones.
drop policy if exists pms_accolade_plays_select on public.pms_accolade_plays;
create policy pms_accolade_plays_select on public.pms_accolade_plays
  for select to authenticated using (true);
drop policy if exists pms_accolade_plays_insert on public.pms_accolade_plays;
create policy pms_accolade_plays_insert on public.pms_accolade_plays
  for insert to authenticated
  with check (pms_accolades_caller_email() <> ''
              and lower(email) = pms_accolades_caller_email()
              and play_date between current_date - 1 and current_date + 1);

drop policy if exists pms_accolade_email_dismissals_select on public.pms_accolade_email_dismissals;
create policy pms_accolade_email_dismissals_select on public.pms_accolade_email_dismissals
  for select to authenticated using (true);
drop policy if exists pms_accolade_email_dismissals_insert on public.pms_accolade_email_dismissals;
create policy pms_accolade_email_dismissals_insert on public.pms_accolade_email_dismissals
  for insert to authenticated
  with check (pms_accolades_caller_email() <> '' and lower(dismissed_by) = pms_accolades_caller_email());

drop policy if exists pms_accolade_settings_select on public.pms_accolade_settings;
create policy pms_accolade_settings_select on public.pms_accolade_settings
  for select to authenticated using (true);
drop policy if exists pms_accolade_settings_update on public.pms_accolade_settings;
create policy pms_accolade_settings_update on public.pms_accolade_settings
  for update to authenticated
  using (is_pms_admin()) with check (is_pms_admin());

-- Supabase default privileges grant anon and authenticated everything on new
-- public tables. RLS already denies what has no policy, but TRUNCATE ignores
-- RLS, so state the intended surface explicitly.
revoke all on public.pms_accolades, public.pms_accolade_cheers, public.pms_accolade_plays,
              public.pms_accolade_email_dismissals, public.pms_accolade_settings from anon;
revoke delete, truncate, references, trigger on public.pms_accolades from authenticated;
revoke update, truncate, references, trigger on public.pms_accolade_cheers from authenticated;
revoke update, delete, truncate, references, trigger on public.pms_accolade_plays from authenticated;
revoke update, delete, truncate, references, trigger on public.pms_accolade_email_dismissals from authenticated;
revoke insert, delete, truncate, references, trigger on public.pms_accolade_settings from authenticated;

-- Filed emails that read like praise, newest first, one per thread, skipping
-- threads already on the wall or dismissed. The snippet marks matched words
-- as «word»; the page renders it as text.
--
-- check_function_bodies is off for this statement for the same reason as
-- 20261102150000: a fresh replay may not have every table a language-sql body
-- reads, and production resolves them when the function runs.
set check_function_bodies = off;
create or replace function public.pms_accolade_email_candidates(p_days integer default 90, p_limit integer default 12)
returns table (
  record_id text, thread_key text, project_number text, project_name text,
  subject text, from_name text, from_address text, email_date timestamptz, snippet text
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
           coalesce(nullif(e.body_text, ''), e.preview, '') as body
    from public.pms_project_emails e, q
    where e.search_tsv @@ q.tsq
      and e.email_date >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)))
    -- earliest match in the thread: the email that said it, not a reply quoting it
    order by coalesce(nullif(e.conversation_id, ''), e.record_id), e.email_date asc
  )
  select h.record_id, h.thread_key,
         p.project ->> 'projectNumber', p.project ->> 'name',
         h.subject, h.from_name, h.from_address, h.email_date,
         ts_headline('english', left(h.body, 20000), q.tsq,
                     'MaxFragments=1, MaxWords=50, MinWords=18, StartSel=«, StopSel=»')
  from hits h
  join public.pms_projects p on p.id = h.project_id
  cross join q
  where public.pms_has_cap('projects.view', p.project ->> 'projectNumber')
    and not exists (select 1 from public.pms_accolades a
                    where a.email_thread_key = h.thread_key and a.removed_at is null)
    and not exists (select 1 from public.pms_accolade_email_dismissals d
                    where d.email_thread_key = h.thread_key)
  order by h.email_date desc
  limit greatest(1, least(coalesce(p_limit, 12), 50))
$$;
reset check_function_bodies;

revoke all on function public.pms_accolade_email_candidates(integer, integer) from public, anon;
grant execute on function public.pms_accolade_email_candidates(integer, integer) to authenticated, service_role;
revoke all on function public.pms_accolades_caller_email() from public, anon;
grant execute on function public.pms_accolades_caller_email() to authenticated, service_role;
