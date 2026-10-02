-- Baseline for pms_engineering_standards, which exists in production (created
-- by hand) but is not created by any migration in this folder.
--
-- Why this exists: a fresh replay of supabase/migrations/ (the Supabase Preview
-- check, a local reset) stopped at 20261002115900_engineering_standards_allow_
-- suggested_status.sql with: relation "public.pms_engineering_standards" does
-- not exist. Production already has this table, so this file is a no-op there:
-- create ... if not exists, create index if not exists, drop policy if exists +
-- create policy, and an idempotent RLS enable.
--
-- Schema was read from production (khxmgjilwhdguuepbhne). The status check
-- already allows 'suggested', matching production today; the next migration
-- re-applies the same constraint idempotently. Ordered before it on purpose.
create table if not exists public.pms_engineering_standards (
  standard_id      uuid not null default gen_random_uuid(),
  discipline       text,
  system           text,
  standard_text    text not null,
  basis            text default 'firm',
  source_reference text,
  date_verified    date,
  status           text default 'active',
  date_added       timestamptz default now(),
  updated_at       timestamptz default now(),
  constraint pms_engineering_standards_pkey primary key (standard_id),
  constraint pms_engineering_standards_basis_check
    check (basis = any (array['code'::text, 'spec'::text, 'firm'::text])),
  constraint pms_engineering_standards_status_check
    check (status = any (array['active'::text, 'superseded'::text, 'suggested'::text]))
);

create index if not exists idx_pms_eng_std_cluster
  on public.pms_engineering_standards (discipline, system);

alter table public.pms_engineering_standards enable row level security;
drop policy if exists anon_full_pms_engineering_standards on public.pms_engineering_standards;
create policy anon_full_pms_engineering_standards on public.pms_engineering_standards
  for all to authenticated using (true) with check (true);
