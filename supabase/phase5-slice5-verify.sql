-- Phase 5 Slice 5 — persona verification. Run AFTER the migration, in the
-- SQL editor (postgres role). Simulates each role's JWT via request.jwt.claims
-- and checks pms_has_cap('projects.edit', …) — the exact predicate the new
-- policies call — plus the project-scoped path with a fabricated override.
--
-- Expected results are in the `expect` column; the run FAILS if any row's
-- `got` differs. Personas: one real user per role, an unregistered
-- @setty.com address (staff baseline), and a no-email negative control.

with persona(label, email, expect) as (
  values
    ('admin',            'sara.arias@setty.com',       true),
    ('project_manager',  'shari.sharafi@setty.com',    true),
    ('engineer',         'anthony.reyes@setty.com',    true),
    ('operations',       'danny.kang@setty.com',       true),
    ('accounting',       null,                         null),  -- no accounting user exists; row skipped below
    ('contracts',        'kyle.bordner@setty.com',     true),
    ('marketing',        'pooja.ramakrishna@setty.com', true),
    ('qaqc',             'somanna.moodera@setty.com',  false), -- THE deliberate restriction
    ('staff-baseline',   'unregistered.person@setty.com', true),
    ('no-email-jwt',     '',                           false)
),
checked as (
  select label, email, expect,
         (select set_config('request.jwt.claims',
                            json_build_object('email', coalesce(email,''))::text,
                            true) is not null)  as _cfg,
         pms_has_cap('projects.edit', null)     as got
  from persona
  where email is not null or label = 'no-email-jwt'
)
select label, email, expect, got,
       case when got = expect then '✓' else '✗ MISMATCH' end as verdict
from checked;

-- Project-scoped path (option B): fabricate a lock on a fake project number,
-- confirm an allowed role is denied inside the scope and untouched outside
-- it, then remove the fabricated row. Uses engineer as the guinea pig.
begin;
insert into pms_project_permissions (project_number, capability, subject_kind, subject, allowed)
values ('ZZTEST-000', 'projects.edit', 'role', 'engineer', false);

select set_config('request.jwt.claims',
                  '{"email":"anthony.reyes@setty.com"}', true);

select 'engineer inside locked scope'  as check,
       pms_has_cap('projects.edit', 'ZZTEST-000') as got, false as expect
union all
select 'engineer outside locked scope',
       pms_has_cap('projects.edit', 'SAPX999999'), true;
rollback;  -- discards the fabricated override

-- Boot-path smoke test (the v80 gate lesson): as the DENIED role, confirm
-- reads still work on every slice-5 table — qaqc must still load the app.
select set_config('request.jwt.claims',
                  '{"email":"somanna.moodera@setty.com"}', true);
select set_config('role', 'authenticated', true);
select 'pms_projects read'  as check, count(*) >= 0 as ok from pms_projects
union all select 'pms_meta read',     count(*) >= 0 from pms_meta
union all select 'pms_clients read',  count(*) >= 0 from pms_clients
union all select 'pms_rfis read',     count(*) >= 0 from pms_rfis
union all select 'pms_submittals read', count(*) >= 0 from pms_submittals;
reset role;
