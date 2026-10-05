-- Baseline for pms_submittal_events and pms_person_work, which exist in
-- production (created by hand / remote-only migrations) but not in this folder.
--
-- Why this exists: a fresh replay of supabase/migrations/ (the Supabase Preview
-- check, a local reset) stopped at 20261005120000_normalize_disciplines_and_
-- person_work_dates.sql with: relation "public.pms_person_work" does not exist.
-- That migration rewrites the view in place: it reads pg_get_viewdef() and
-- string-replaces two expressions, so it needs the view to exist, in its form
-- BEFORE that migration. This file creates exactly that form.
--
-- Production already has both objects (and the second one is already in its
-- post-20261005120000 form), so this file is a no-op there: every statement is
-- create ... if not exists, create index if not exists, drop policy if exists
-- + create policy, or an idempotent RLS enable.
--
-- The view body is production's current definition with the two changes that
-- 20261005120000 makes put back:
--   work_date  "left"(COALESCE((r.response_date)::text, r.last_action, ''), 10)
--              (no date-shape guard)
--   discipline NULLIF(u.discipline, '')   (no hvac/miscellaneous/other mapping)
-- Both strings are the ones that migration searches for and replaces.
--
-- Schema was read from production (khxmgjilwhdguuepbhne). Everything the view
-- reads is created earlier in the chain: pms_rfis, pms_submittals, pms_lessons,
-- pms_project_index and pms_person_norm() come from
-- 20260727000000_baseline_prod_tables.sql.

create table if not exists public.pms_submittal_events (
  id             uuid not null default gen_random_uuid(),
  project_number text not null,
  submittal_id   text not null,
  seq            integer,
  action_id      text,
  type           text,
  action         text,
  event_date     date,
  from_party     text,
  to_party       text,
  due_date       date,
  remarks        text,
  via            text,
  loaded_at      timestamptz default now(),
  constraint pms_submittal_events_pkey primary key (id),
  constraint pms_submittal_events_project_number_submittal_id_fkey
    foreign key (project_number, submittal_id)
    references public.pms_submittals (project_number, submittal_id) on delete cascade
);

create index if not exists idx_pms_submittal_events_parent
  on public.pms_submittal_events (project_number, submittal_id);

alter table public.pms_submittal_events enable row level security;

drop policy if exists pms_submittal_events_insert on public.pms_submittal_events;
create policy pms_submittal_events_insert on public.pms_submittal_events
  for insert to authenticated
  with check (pms_has_cap('projects.edit', project_number));
drop policy if exists pms_submittal_events_select_anon on public.pms_submittal_events;
create policy pms_submittal_events_select_anon on public.pms_submittal_events
  for select to authenticated using (true);
drop policy if exists pms_submittal_events_update on public.pms_submittal_events;
create policy pms_submittal_events_update on public.pms_submittal_events
  for update to authenticated
  using (pms_has_cap('projects.edit', project_number))
  with check (pms_has_cap('projects.edit', project_number));

create materialized view if not exists public.pms_person_work as
with rfi_work as (
  select pms_person_norm((regexp_match(r.answer, 'Response \([^)]+\) from:\s*([^(\r\n]+?)\s*(?:\(|Remarks:)'))[1]) as person,
         'rfi'::text as kind,
         r.discipline,
         r.project_number,
         coalesce(nullif(r.themes, '{}'::text[]), array[null::text]) as systems,
         "left"(coalesce(r.subject, ''::text), 120) as subject,
         "left"(coalesce(r.response_date::text, r.last_action, ''::text), 10) as work_date,
         'RFI '::text || coalesce(r.rfi_id, ''::text) as ref
  from pms_rfis r
  where r.answer ~ 'Response \([^)]+\) from:'::text
), sub_work as (
  select pms_person_norm((regexp_match(e.remarks, 'Response \([^)]+\) from:\s*([^(\r\n]+?)\s*(?:\(|Remarks:)'))[1]) as person,
         'submittal'::text as kind,
         s.discipline,
         e.project_number,
         array[nullif(s.spec_section, ''::text)] as systems,
         "left"(coalesce(s.subject, ''::text), 120) as subject,
         "left"(coalesce(e.event_date::text, ''::text), 10) as work_date,
         'Submittal '::text || coalesce(e.submittal_id, ''::text) as ref
  from pms_submittal_events e
  join pms_submittals s on s.submittal_id = e.submittal_id and s.project_number = e.project_number
  where e.remarks ~ 'Response \([^)]+\) from:'::text
), lesson_work as (
  select l.so_person as person,
         'lesson'::text as kind,
         l.discipline,
         l.project_id as project_number,
         array[nullif(l.system, ''::text)] as systems,
         "left"(l.lesson_summary, 120) as subject,
         "left"(coalesce(l.date_added::text, ''::text), 10) as work_date,
         'Lesson'::text as ref
  from pms_lessons l
  where l.status = 'approved'::text and l.so_person is not null
), u as (
  select person, kind, discipline, project_number, systems, subject, work_date, ref from rfi_work
  union all
  select person, kind, discipline, project_number, systems, subject, work_date, ref from sub_work
  union all
  select person, kind, discipline, project_number, systems, subject, work_date, ref from lesson_work
)
select row_number() over () as id,
       u.person,
       u.kind,
       nullif(u.discipline, ''::text) as discipline,
       u.project_number,
       sys.system,
       u.subject,
       u.work_date,
       u.ref,
       pi.agency,
       pi.name as project_name
from u
cross join lateral unnest(u.systems) sys(system)
left join lateral (
  select pms_project_index.agency, pms_project_index.name
  from pms_project_index
  where pms_project_index.num = u.project_number
  limit 1
) pi on true
where u.person is not null and length(u.person) >= 2 and length(u.person) <= 60;

create unique index if not exists pms_person_work_id on public.pms_person_work (id);
create index if not exists pms_person_work_person on public.pms_person_work (person);
