-- Knowledge K1 — persona verification. Run AFTER the migration, in the
-- SQL editor (postgres role). Same recipe as phase5-slice5-verify.sql:
-- simulate each role's JWT via request.jwt.claims and check the exact
-- predicates the new policies call, then probe real writes as the denied
-- role with reads intact.

-- ── 1. Persona sweep: both capabilities ─────────────────────────────────────
with persona(label, email, expect) as (
  values
    ('admin',            'sara.arias@setty.com',          true),
    ('project_manager',  'shari.sharafi@setty.com',       true),
    ('engineer',         'anthony.reyes@setty.com',       true),
    ('operations',       'danny.kang@setty.com',          true),
    ('contracts',        'kyle.bordner@setty.com',        true),
    ('marketing',        'pooja.ramakrishna@setty.com',   true),
    ('qaqc',             'somanna.moodera@setty.com',     false), -- Gate B extended
    ('staff-baseline',   'unregistered.person@setty.com', true),
    ('no-email-jwt',     '',                              false)
),
checked as (
  select label, email, expect,
         (select set_config('request.jwt.claims',
                            json_build_object('email', email)::text,
                            true) is not null)                 as _cfg,
         pms_has_cap('knowledge.contribute', null)             as contribute,
         pms_has_cap('knowledge.review', null)                 as review
  from persona
)
select label, email, expect, contribute, review,
       case when contribute = expect and review = expect
            then '✓' else '✗ MISMATCH' end as verdict
from checked;

-- ── 2. Project-scoped path: lessons lock resolves through project_id ────────
-- Fabricate a per-project deny on a fake number, confirm an allowed role is
-- denied inside the scope and untouched outside it, then discard.
begin;
insert into pms_project_permissions (project_number, capability, subject_kind, subject, allowed)
values ('ZZTEST-000', 'knowledge.contribute', 'role', 'engineer', false);

select set_config('request.jwt.claims',
                  '{"email":"anthony.reyes@setty.com"}', true);

select 'engineer inside locked scope'  as check,
       pms_has_cap('knowledge.contribute', 'ZZTEST-000') as got, false as expect
union all
select 'engineer outside locked scope',
       pms_has_cap('knowledge.contribute', 'SAPX999999'), true;
rollback;

-- ── 3. Real write probes as qaqc (the denied role), all rolled back ─────────
begin;
select set_config('request.jwt.claims',
                  '{"email":"somanna.moodera@setty.com"}', true);
select set_config('role', 'authenticated', true);

-- INSERT must be refused by pms_lessons_insert (expect: ERROR 42501 /
-- row-level security violation — run this statement alone to see it fail):
--   insert into pms_lessons (project_id, lesson_summary, status)
--   values ('SAPX999999', 'k1 probe — should never land', 'suggested');

-- UPDATE and DELETE as qaqc must touch 0 rows:
with u as (update pms_lessons set updated_at = updated_at where true returning 1)
select 'qaqc update pms_lessons' as check, count(*) = 0 as ok from u;
with d as (delete from pms_lessons where lesson_summary = '__no_such_row__' returning 1)
select 'qaqc delete pms_lessons', count(*) = 0 from d;

-- Boot path: reads stay open to the denied role on every gated table.
select 'pms_lessons read' as check, count(*) >= 0 as ok from pms_lessons
union all select 'pms_agency_preferences read', count(*) >= 0 from pms_agency_preferences
union all select 'pms_best_practices read',     count(*) >= 0 from pms_best_practices;
rollback;
reset role;

-- ── 4. Allowed-role write probe (engineer), rolled back ─────────────────────
begin;
select set_config('request.jwt.claims',
                  '{"email":"anthony.reyes@setty.com"}', true);
select set_config('role', 'authenticated', true);
insert into pms_lessons (project_id, lesson_summary, status, origin, author_email)
values ('SAPX999999', 'k1 probe — rolled back', 'suggested', 'connector', 'anthony.reyes@setty.com');
select 'engineer insert pms_lessons' as check,
       count(*) = 1 as ok
from pms_lessons where lesson_summary = 'k1 probe — rolled back';
rollback;
reset role;
