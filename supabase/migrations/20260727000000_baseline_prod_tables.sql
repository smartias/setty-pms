-- Baseline for tables that exist in production (created by hand or by
-- remote-only migrations) and are referenced by the migrations in this folder.
--
-- Why this exists: the Supabase Preview check builds a fresh database by
-- replaying supabase/migrations/ and stopped at 20260728000000_register_asof
-- ("relation pms_rfis does not exist"). Production already has every object
-- below, so this file is a no-op there: create ... if not exists,
-- create index if not exists, drop policy if exists + create policy with the
-- production definitions, and idempotent RLS enables.
--
-- Schema was read from production (khxmgjilwhdguuepbhne). Left out on purpose
-- because a later migration in this folder adds it itself:
--   pms_filing_log.client_op_id and pms_filing_log_client_op_id_uq (20260930130000)
--   pms_filing_log triggers (20260920000000)
--   pms_mcp_telemetry.project_arg and the outcome check (20260917120000)
-- Triggers on pms_projects (history, slim email bodies, stamp team) are omitted:
-- their functions are not defined in this folder and nothing here depends on
-- them. Table grants to anon/authenticated/service_role come from Supabase's
-- default privileges on schema public, so none are repeated.

-- Roles and the admin gate (is_pms_admin() is used by policies in many later files).
create table if not exists public.pms_user_roles (
  email        text not null,
  role         text not null default 'staff',
  display_name text,
  added_by     text,
  updated_at   timestamptz not null default now(),
  team         text,
  constraint pms_user_roles_pkey primary key (email),
  constraint pms_user_roles_email_check check (email ~* '@setty\.com$'),
  constraint pms_user_roles_role_check check (role = any (array['admin','project_manager','engineer','operations','accounting','contracts','marketing','qaqc','staff']))
);
alter table public.pms_user_roles enable row level security;

create or replace function public.is_pms_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1 from pms_user_roles
    where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
      and role = 'admin');
$$;

drop policy if exists user_roles_admin_all on public.pms_user_roles;
create policy user_roles_admin_all on public.pms_user_roles
  for all to authenticated
  using (is_pms_admin()) with check (is_pms_admin());

-- pms_has_cap() wraps pms_has_cap_for(), which a later migration in this
-- folder creates. Same body as production; skip body validation so it can be
-- created before its callee exists.
set local check_function_bodies = off;
create or replace function public.pms_has_cap(p_cap text, p_project text default null)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.pms_has_cap_for(coalesce(auth.jwt()->>'email',''), p_cap, p_project);
$$;

-- The project blob table. updated_by is also added (if not exists) by 20260919150000.
create table if not exists public.pms_projects (
  id         text not null,
  project    jsonb not null,
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  team       text,
  updated_by text,
  constraint pms_projects_pkey primary key (id)
);
create index if not exists pms_projects_updated_at_idx on public.pms_projects (updated_at desc);
create index if not exists pms_projects_archived_idx on public.pms_projects (((project ->> 'archived')));
create index if not exists pms_projects_project_number_idx on public.pms_projects (((project ->> 'projectNumber')));
alter table public.pms_projects enable row level security;

drop policy if exists pms_projects_select on public.pms_projects;
create policy pms_projects_select on public.pms_projects
  for select to authenticated using (true);
drop policy if exists pms_projects_write on public.pms_projects;
create policy pms_projects_write on public.pms_projects
  for all to authenticated
  using (pms_has_cap('projects.edit', project ->> 'projectNumber'))
  with check (pms_has_cap('projects.edit', project ->> 'projectNumber'));

-- Capability catalog (20260920130000 inserts into it).
create table if not exists public.pms_capability_catalog (
  capability  text not null,
  label       text not null,
  description text,
  sort        integer not null default 100,
  constraint pms_capability_catalog_pkey primary key (capability)
);
alter table public.pms_capability_catalog enable row level security;

drop policy if exists cap_catalog_read on public.pms_capability_catalog;
create policy cap_catalog_read on public.pms_capability_catalog
  for select to authenticated using (true);
drop policy if exists cap_catalog_admin on public.pms_capability_catalog;
create policy cap_catalog_admin on public.pms_capability_catalog
  for all to authenticated using (is_pms_admin()) with check (is_pms_admin());

-- Newforma RFI / submittal registers.
create table if not exists public.pms_rfis (
  id                   uuid not null default gen_random_uuid(),
  project_id           text,
  project_number       text not null,
  project_name         text,
  project_manager      text,
  rfi_id               text not null,
  sender_id            text,
  type                 text,
  subject              text,
  discipline           text,
  contract             text,
  originated_by        text,
  reasons              text,
  status               text,
  from_party           text,
  to_party             text,
  received             date,
  last_action          text,
  review_days          integer,
  forwarded_to         text,
  due_back_from        text,
  review_due_back      date,
  closed_date          date,
  current_reviewer     text,
  due_date             date,
  response_date        date,
  total_days           integer,
  remaining_days       integer,
  keywords             text,
  related_items        text,
  last_forwarded       date,
  supporting_documents text,
  internal_notes       text,
  question             text,
  answer               text,
  suggestion           text,
  last_reviewed        date,
  source_file          text,
  loaded_at            timestamptz default now(),
  themes               text[],
  constraint pms_rfis_pkey primary key (id),
  constraint pms_rfis_project_number_rfi_id_key unique (project_number, rfi_id),
  constraint pms_rfis_project_id_fkey foreign key (project_id) references public.pms_projects (id)
);
create index if not exists idx_pms_rfis_project_id on public.pms_rfis (project_id);
create index if not exists idx_pms_rfis_project_number on public.pms_rfis (project_number);
create index if not exists idx_pms_rfis_status on public.pms_rfis (status);
create index if not exists idx_pms_rfis_themes on public.pms_rfis using gin (themes);
alter table public.pms_rfis enable row level security;

drop policy if exists pms_rfis_select_anon on public.pms_rfis;
create policy pms_rfis_select_anon on public.pms_rfis
  for select to authenticated using (true);
drop policy if exists pms_rfis_insert on public.pms_rfis;
create policy pms_rfis_insert on public.pms_rfis
  for insert to authenticated with check (pms_has_cap('projects.edit', project_number));
drop policy if exists pms_rfis_update on public.pms_rfis;
create policy pms_rfis_update on public.pms_rfis
  for update to authenticated
  using (pms_has_cap('projects.edit', project_number))
  with check (pms_has_cap('projects.edit', project_number));

create table if not exists public.pms_submittals (
  id                   uuid not null default gen_random_uuid(),
  project_id           text,
  project_number       text not null,
  project_name         text,
  project_manager      text,
  submittal_id         text not null,
  sender_id            text,
  package_id           text,
  spec_section         text,
  subject              text,
  discipline           text,
  status               text,
  from_party           text,
  received             date,
  last_action          text,
  review_days          integer,
  contract             text,
  forwarded_to         text,
  due_back_from        text,
  review_due_back      date,
  current_reviewer     text,
  due_date             date,
  response_date        date,
  total_days           integer,
  remaining_days       integer,
  keywords             text,
  related_items        text,
  to_party             text,
  last_forwarded       date,
  supporting_documents text,
  originated_by        text,
  lead_time            text,
  need_onsite_by       date,
  expected_date        date,
  closed_date          date,
  internal_notes       text,
  last_reviewed        date,
  source_file          text,
  loaded_at            timestamptz default now(),
  constraint pms_submittals_pkey primary key (id),
  constraint pms_submittals_project_number_submittal_id_key unique (project_number, submittal_id),
  constraint pms_submittals_project_id_fkey foreign key (project_id) references public.pms_projects (id)
);
create index if not exists idx_pms_submittals_project_id on public.pms_submittals (project_id);
create index if not exists idx_pms_submittals_project_number on public.pms_submittals (project_number);
create index if not exists idx_pms_submittals_status on public.pms_submittals (status);
alter table public.pms_submittals enable row level security;

drop policy if exists pms_submittals_select_anon on public.pms_submittals;
create policy pms_submittals_select_anon on public.pms_submittals
  for select to authenticated using (true);
drop policy if exists pms_submittals_insert on public.pms_submittals;
create policy pms_submittals_insert on public.pms_submittals
  for insert to authenticated with check (pms_has_cap('projects.edit', project_number));
drop policy if exists pms_submittals_update on public.pms_submittals;
create policy pms_submittals_update on public.pms_submittals
  for update to authenticated
  using (pms_has_cap('projects.edit', project_number))
  with check (pms_has_cap('projects.edit', project_number));

-- Institutional-intelligence analysis rows (20260728000100 adds blocked-dependency columns if missing).
create table if not exists public.pms_project_analysis (
  id           uuid not null default gen_random_uuid(),
  project_id   text not null,
  category     text not null,
  title        text not null,
  detail       text,
  source_ref   text,
  severity     text default 'medium',
  status       text default 'open',
  origin       text default 'mined',
  model        text,
  created_at   timestamptz default now(),
  waiting_on   text,
  asked_since  date,
  last_chased  date,
  assumption   text,
  expiry_event text,
  expiry_date  date,
  constraint pms_project_analysis_pkey primary key (id),
  constraint pms_project_analysis_category_check check (category = any (array['scope_risk','open_request','owner_directive','blocked_dependency'])),
  constraint pms_project_analysis_severity_check check (severity = any (array['low','medium','high'])),
  constraint pms_project_analysis_status_check check (status = any (array['open','resolved','info']))
);
create index if not exists idx_pms_analysis_project on public.pms_project_analysis (project_id, category);
alter table public.pms_project_analysis enable row level security;
drop policy if exists anon_full_pms_project_analysis on public.pms_project_analysis;
create policy anon_full_pms_project_analysis on public.pms_project_analysis
  for all to authenticated using (true) with check (true);

create table if not exists public.pms_ops_snapshots (
  name       text not null,
  content    text not null,
  created_at timestamptz not null default now(),
  constraint pms_ops_snapshots_pkey primary key (name)
);
alter table public.pms_ops_snapshots enable row level security;

create table if not exists public.pms_mcp_telemetry (
  id             bigint generated always as identity,
  created_at     timestamptz not null default now(),
  tool           text not null,
  project_number text,
  outcome        text not null,
  result_count   integer,
  latency_ms     integer,
  build          text,
  query          text,
  detail         text,
  caller_email   text,
  constraint pms_mcp_telemetry_pkey primary key (id)
);
create index if not exists pms_mcp_telemetry_created_idx on public.pms_mcp_telemetry (created_at desc);
create index if not exists pms_mcp_telemetry_outcome_idx on public.pms_mcp_telemetry (outcome, tool, created_at desc);
create index if not exists pms_mcp_telemetry_project_idx on public.pms_mcp_telemetry (project_number, created_at desc) where project_number is not null;
alter table public.pms_mcp_telemetry enable row level security;
drop policy if exists mcp_telemetry_admin_all on public.pms_mcp_telemetry;
create policy mcp_telemetry_admin_all on public.pms_mcp_telemetry
  for all using (is_pms_admin()) with check (is_pms_admin());

-- Filing-integrity log. client_op_id, its unique index and the triggers come from later migrations.
create table if not exists public.pms_filing_log (
  id             uuid not null default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  project_id     text not null,
  msg_id         text,
  operation      text not null,
  sp_folder_url  text,
  files          jsonb,
  email_subject  text,
  status         text not null,
  error          text,
  user_email     text,
  client_version text,
  retried        integer default 0,
  queue_key      text generated always as ((project_id || '|') || coalesce(msg_id, '')) stored,
  constraint pms_filing_log_pkey primary key (id)
);
create index if not exists idx_filing_log_project on public.pms_filing_log (project_id, created_at desc);
create index if not exists idx_filing_log_msg on public.pms_filing_log (msg_id);
create index if not exists idx_filing_log_created on public.pms_filing_log (created_at desc);
create index if not exists idx_filing_log_status on public.pms_filing_log (status) where status = any (array['failed','partial','queued','retrying']);
create index if not exists idx_filing_log_queue_key on public.pms_filing_log (queue_key);
alter table public.pms_filing_log enable row level security;
drop policy if exists filing_log_insert on public.pms_filing_log;
create policy filing_log_insert on public.pms_filing_log
  for insert to authenticated with check (coalesce(auth.jwt() ->> 'email', '') <> '');
drop policy if exists filing_log_update on public.pms_filing_log;
create policy filing_log_update on public.pms_filing_log
  for update to authenticated using (true) with check (coalesce(auth.jwt() ->> 'email', '') <> '');
drop policy if exists filing_log_anon_select on public.pms_filing_log;
create policy filing_log_anon_select on public.pms_filing_log
  for select to authenticated using (true);

-- Role x capability matrix (20260901000000 and 20260920130000 seed it).
create table if not exists public.pms_role_permissions (
  role       text not null,
  capability text not null,
  allowed    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint pms_role_permissions_pkey primary key (role, capability),
  constraint pms_role_permissions_capability_fkey foreign key (capability) references public.pms_capability_catalog (capability) on delete cascade
);
alter table public.pms_role_permissions enable row level security;
drop policy if exists role_perms_read on public.pms_role_permissions;
create policy role_perms_read on public.pms_role_permissions
  for select to authenticated using (true);
drop policy if exists role_perms_admin on public.pms_role_permissions;
create policy role_perms_admin on public.pms_role_permissions
  for all to authenticated using (is_pms_admin()) with check (is_pms_admin());

-- Institutional-intelligence tables. 20260901000000 snapshots their policies
-- (an empty set would insert a NULL rollback row) and adds the review-trail
-- columns on pms_lessons.
create table if not exists public.pms_lessons (
  lesson_id        uuid not null default gen_random_uuid(),
  project_id       text,
  agency           text,
  so_person        text,
  discipline       text,
  system           text,
  issue_type       text,
  lesson_summary   text not null,
  source_reference text,
  linked_records   jsonb default '[]'::jsonb,
  confidence       text default 'medium',
  approved_by      text,
  status           text default 'draft',
  reusable_prompt  text,
  superseded_by    uuid,
  tags             text[] default '{}'::text[],
  date_added       timestamptz default now(),
  updated_at       timestamptz default now(),
  origin           text default 'manual',
  source_type      text,
  model            text,
  extracted_at     timestamptz,
  author_email     text,
  author_name      text,
  reviewed_at      timestamptz,
  review_note      text,
  constraint pms_lessons_pkey primary key (lesson_id),
  constraint pms_lessons_confidence_check check (confidence = any (array['low','medium','high'])),
  constraint pms_lessons_origin_check check (origin = any (array['manual','mined','connector'])),
  constraint pms_lessons_status_check check (status = any (array['draft','suggested','approved','rejected','archived'])),
  constraint pms_lessons_superseded_by_fkey foreign key (superseded_by) references public.pms_lessons (lesson_id)
);
create index if not exists idx_pms_lessons_agency on public.pms_lessons (agency);
create index if not exists idx_pms_lessons_cluster on public.pms_lessons (discipline, system, issue_type);
create index if not exists pms_lessons_project on public.pms_lessons (project_id);
create index if not exists idx_pms_lessons_origin on public.pms_lessons (origin, status);
create index if not exists idx_pms_lessons_status on public.pms_lessons (status);
create index if not exists pms_lessons_status on public.pms_lessons (status);
create index if not exists idx_pms_lessons_project on public.pms_lessons (project_id);
alter table public.pms_lessons enable row level security;
-- Pre-20260901000000 policy state, only on a freshly created table: that
-- migration swaps this for the pms_has_cap() policies, which production already has.
do $baseline$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pms_lessons') then
    create policy anon_full_pms_lessons on public.pms_lessons for all to anon, authenticated using (true) with check (true);
  end if;
end $baseline$;

create table if not exists public.pms_agency_preferences (
  pref_id                  uuid not null default gen_random_uuid(),
  agency                   text not null,
  preference_type          text,
  discipline               text,
  requirement_or_preference text not null,
  source                   text,
  date_verified            date,
  applies_to               text,
  notes                    text,
  status                   text default 'active',
  date_added               timestamptz default now(),
  updated_at               timestamptz default now(),
  constraint pms_agency_preferences_pkey primary key (pref_id),
  constraint pms_agency_preferences_status_check check (status = any (array['active','superseded','suggested','archived']))
);
create index if not exists idx_pms_agency_pref_agency on public.pms_agency_preferences (agency);
alter table public.pms_agency_preferences enable row level security;
-- Pre-20260901000000 policy state, only on a freshly created table: that
-- migration swaps this for the pms_has_cap() policies, which production already has.
do $baseline$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pms_agency_preferences') then
    create policy anon_full_pms_agency_preferences on public.pms_agency_preferences for all to anon, authenticated using (true) with check (true);
  end if;
end $baseline$;

create table if not exists public.pms_best_practices (
  practice_id          uuid not null default gen_random_uuid(),
  title                text not null,
  discipline           text,
  system               text,
  issue_type           text,
  practice_text        text not null,
  derived_from_lessons uuid[] default '{}'::uuid[],
  trigger              jsonb default '{}'::jsonb,
  confidence           text default 'medium',
  approved_by          text,
  status               text default 'draft',
  date_added           timestamptz default now(),
  updated_at           timestamptz default now(),
  coord_theme          text,
  constraint pms_best_practices_pkey primary key (practice_id),
  constraint pms_best_practices_confidence_check check (confidence = any (array['low','medium','high'])),
  constraint pms_best_practices_status_check check (status = any (array['draft','approved','archived','suggested']))
);
create index if not exists idx_pms_best_practices_cluster on public.pms_best_practices (discipline, system, issue_type);
alter table public.pms_best_practices enable row level security;
-- Pre-20260901000000 policy state, only on a freshly created table: that
-- migration swaps this for the pms_has_cap() policies, which production already has.
do $baseline$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pms_best_practices') then
    create policy anon_full_pms_best_practices on public.pms_best_practices for all to anon, authenticated using (true) with check (true);
  end if;
end $baseline$;

create table if not exists public.pms_ii_brief_feedback (
  feedback_id uuid not null default gen_random_uuid(),
  project_id  text not null,
  section_key text not null,
  vote        smallint not null,
  voter       text,
  created_at  timestamptz not null default now(),
  item_key    text,
  item_text   text,
  constraint pms_ii_brief_feedback_pkey primary key (feedback_id),
  constraint pms_ii_brief_feedback_vote_check check (vote = any (array[-1, 1]))
);
create index if not exists idx_ii_brief_feedback_proj on public.pms_ii_brief_feedback (project_id, section_key);
alter table public.pms_ii_brief_feedback enable row level security;
drop policy if exists "anon can read brief feedback" on public.pms_ii_brief_feedback;
create policy "anon can read brief feedback" on public.pms_ii_brief_feedback
  for select to authenticated using (true);
drop policy if exists "anon can insert brief feedback" on public.pms_ii_brief_feedback;
create policy "anon can insert brief feedback" on public.pms_ii_brief_feedback
  for insert to authenticated with check (true);

create table if not exists public.pms_project_disciplines (
  project_number text not null,
  disciplines    text[] not null,
  note           text,
  constraint pms_project_disciplines_pkey primary key (project_number)
);
alter table public.pms_project_disciplines enable row level security;
drop policy if exists pms_project_disciplines_all on public.pms_project_disciplines;
create policy pms_project_disciplines_all on public.pms_project_disciplines
  for all to authenticated using (true) with check (true);

-- pms_project_index is a materialized view in production, derived from
-- pms_projects through helper functions (pms_agency_token, pms_scope_tags,
-- pms_jurisdiction, ...) that are not defined in this folder. Here it is an
-- empty, identically-typed stand-in so functions created later (e.g.
-- pms_project_brief) validate; "if not exists" leaves production's real view
-- untouched. A fresh database has no projects, so an empty index is accurate.
create materialized view if not exists public.pms_project_index as
select
  null::text as slug, null::text as num, null::text as name, null::text as client,
  null::text as owner, null::text as prime, null::text as status, null::text as bldg_cat,
  null::text as proj_type, null::text as city, null::numeric as sqft, null::text as agency,
  null::text as construction_type, null::boolean as is_campus, null::text[] as scope_tags,
  null::text as scope_summary, null::text[] as authorities, null::boolean as is_nyc,
  null::text as borough, null::text as region, null::text as code_regime,
  null::text as electric_utility, null::text as gas_utility
where false;
create unique index if not exists pms_project_index_slug on public.pms_project_index (slug);
create index if not exists pms_project_index_num on public.pms_project_index (num);
create index if not exists pms_project_index_agency on public.pms_project_index (agency);

create table if not exists public.pms_owner_comments (
  id             bigint generated always as identity,
  project_number text not null,
  agency         text,
  source_file    text,
  reviewer       text,
  discipline     text,
  comment_text   text not null,
  category       text,
  recurring      boolean default false,
  review_date    date,
  created_at     timestamptz default now(),
  constraint pms_owner_comments_pkey primary key (id)
);
create index if not exists idx_pms_owner_comments_proj on public.pms_owner_comments (project_number);
create index if not exists idx_pms_owner_comments_agency on public.pms_owner_comments (agency);
alter table public.pms_owner_comments enable row level security;
drop policy if exists pms_owner_comments_all on public.pms_owner_comments;
create policy pms_owner_comments_all on public.pms_owner_comments
  for all to authenticated using (true) with check (true);

-- Reference tables read by pms_project_brief (20260901120000).
create table if not exists public.pms_agency_profiles (
  agency            text not null,
  owner_name        text not null,
  construction_fund text,
  design_standards  text,
  typical_projects  text,
  mep_considerations text,
  source_urls       text[] default '{}'::text[],
  source            text default 'Curated agency reference',
  updated_at        timestamptz default now(),
  constraint pms_agency_profiles_pkey primary key (agency)
);
alter table public.pms_agency_profiles enable row level security;
drop policy if exists anon_full_pms_agency_profiles on public.pms_agency_profiles;
create policy anon_full_pms_agency_profiles on public.pms_agency_profiles
  for all to authenticated using (true) with check (true);

create table if not exists public.pms_ahj_codes (
  id              uuid not null default gen_random_uuid(),
  ahj             text not null,
  jurisdiction    text,
  codes_standards text,
  mep_impact      text,
  scope           text[] default '{}'::text[],
  source_urls     text[] default '{}'::text[],
  updated_at      timestamptz default now(),
  constraint pms_ahj_codes_pkey primary key (id)
);
alter table public.pms_ahj_codes enable row level security;
drop policy if exists anon_full_pms_ahj_codes on public.pms_ahj_codes;
create policy anon_full_pms_ahj_codes on public.pms_ahj_codes
  for all to authenticated using (true) with check (true);

create table if not exists public.pms_regulations (
  id          uuid not null default gen_random_uuid(),
  category    text not null,
  ref_code    text,
  title       text not null,
  applies_to  text,
  mep_impact  text,
  scope       text[] default '{}'::text[],
  source_urls text[] default '{}'::text[],
  updated_at  timestamptz default now(),
  constraint pms_regulations_pkey primary key (id),
  constraint pms_regulations_category_check check (category = any (array['local_law','sustainability','energy_code','resiliency']))
);
alter table public.pms_regulations enable row level security;
drop policy if exists anon_full_pms_regulations on public.pms_regulations;
create policy anon_full_pms_regulations on public.pms_regulations
  for all to authenticated using (true) with check (true);

create table if not exists public.pms_clients (
  id         text not null,
  client     jsonb not null,
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  constraint pms_clients_pkey primary key (id)
);
create index if not exists pms_clients_updated_at_idx on public.pms_clients (updated_at desc);
alter table public.pms_clients enable row level security;
drop policy if exists pms_clients_select on public.pms_clients;
create policy pms_clients_select on public.pms_clients
  for select to authenticated using (true);
drop policy if exists pms_clients_write on public.pms_clients;
create policy pms_clients_write on public.pms_clients
  for all to authenticated
  using (pms_has_cap('projects.edit', null))
  with check (pms_has_cap('projects.edit', null));

create table if not exists public.pms_person_aliases (
  alias_lower text not null,
  canonical   text not null,
  email       text,
  active      boolean not null default true,
  constraint pms_person_aliases_pkey primary key (alias_lower)
);
alter table public.pms_person_aliases enable row level security;
drop policy if exists person_aliases_read on public.pms_person_aliases;
create policy person_aliases_read on public.pms_person_aliases
  for select to anon, authenticated using (true);

create or replace function public.pms_person_norm(raw text)
returns text
language sql
stable
set search_path to 'public'
as $$
  with s1 as (select btrim(regexp_replace(raw, '\s*\(.*$', '')) as s),
  s1b as (select btrim(regexp_replace(s, '\s+Remarks\s*:?.*$', '', 'i')) as s from s1),
  s2 as (select case when s ~ '@' then replace(split_part(s,'@',1),'.',' ') else s end as s from s1b),
  s3 as (select case when s !~ '\s' and s ~ '^[A-Za-z]+\.[A-Za-z]+$' then replace(s,'.',' ') else s end as s from s2),
  s4 as (select regexp_replace(s, '\s+', ' ', 'g') as s from s3),
  s5 as (select case when s = lower(s) or s = upper(s) or s ~ '^[a-z]' then initcap(s) else s end as s from s4)
  select case
    when raw is null then null
    else coalesce((select a.canonical from pms_person_aliases a
                    where a.alias_lower = lower((select s from s5))),
                  (select s from s5))
  end;
$$;

-- pms_contractor_stats is a materialized view in production (aggregated from
-- pms_submittals / pms_rfis). Empty, identically-typed stand-in, as with
-- pms_project_index above; "if not exists" leaves production's view alone.
create materialized view if not exists public.pms_contractor_stats as
select
  null::text as party, null::integer as submittals, null::integer as projects,
  null::integer as avg_review_days, null::integer as rr_events, null::integer as rr_pct
where false;
create unique index if not exists pms_contractor_stats_party on public.pms_contractor_stats (party);
