-- pms_ca_items — verification. Run AFTER migration 20261017120000 in the SQL
-- editor (postgres role). Same recipe as k1-knowledge-verify.sql: check the
-- exact properties the migration promises, against the real data.

-- ── 1. The projection matches the blob ───────────────────────────────────────
-- Expect: rows = distinct (type, id) pairs across every project; one line per
-- project where they differ (none in a healthy state). A duplicate id inside
-- one array collapses to one row by design, so compare DISTINCT keys.
with blob as (
  select p.id as project_row_id, k.item_type,
         coalesce(nullif(i.item ->> 'id', ''), k.item_type || ':' || coalesce(i.item ->> 'number', '?')) as item_id
  from public.pms_projects p
  cross join (values ('rfi', 'rfis'), ('submittal', 'submittals')) as k(item_type, arr_key)
  cross join lateral jsonb_array_elements(public.pms_ca_items_array(p.project, k.arr_key)) as i(item)
  where jsonb_typeof(i.item) = 'object'
),
b as (select project_row_id, item_type, count(distinct item_id) as n from blob group by 1, 2),
t as (select project_row_id, item_type, count(*) as n from public.pms_ca_items group by 1, 2)
select coalesce(b.project_row_id, t.project_row_id) as project_row_id,
       coalesce(b.item_type, t.item_type) as item_type,
       b.n as in_blob, t.n as in_table
from b full outer join t using (project_row_id, item_type)
where b.n is distinct from t.n
order by 1, 2;

-- ── 2. Totals ─────────────────────────────────────────────────────────────────
select item_type, count(*) as rows, count(*) filter (where is_open) as open_rows,
       count(*) filter (where source = 'no-id') as without_id,
       count(*) filter (where has_ai_review) as with_ai_review,
       min(project_updated_at) as oldest_projection
from public.pms_ca_items group by 1 order by 1;

-- ── 3. Items without an id (keyed '<type>:<number>') ─────────────────────────
-- Open question from the design note. Anything here should get an id in the
-- blob before other tables link to these rows; the key changes when it does.
select project_number, item_type, number, subject, status
from public.pms_ca_items where source = 'no-id' order by 1, 2, 3;

-- ── 4. Duplicate ids inside one array (last occurrence won) ──────────────────
select p.project ->> 'projectNumber' as project_number, k.item_type, i.item ->> 'id' as item_id, count(*) as copies
from public.pms_projects p
cross join (values ('rfi', 'rfis'), ('submittal', 'submittals')) as k(item_type, arr_key)
cross join lateral jsonb_array_elements(public.pms_ca_items_array(p.project, k.arr_key)) as i(item)
where nullif(i.item ->> 'id', '') is not null
group by 1, 2, 3 having count(*) > 1 order by 1, 2, 3;

-- ── 5. Arrays that are not arrays (silently projected as empty) ──────────────
select id, project ->> 'projectNumber' as project_number,
       jsonb_typeof(project -> 'rfis') as rfis_type, jsonb_typeof(project -> 'submittals') as submittals_type
from public.pms_projects
where (project ? 'rfis' and jsonb_typeof(project -> 'rfis') <> 'array')
   or (project ? 'submittals' and jsonb_typeof(project -> 'submittals') <> 'array');

-- ── 6. Full text sanity ───────────────────────────────────────────────────────
-- Stemming: a query for "dampers" should also hit items that say "damper".
select project_number, item_type, number, subject,
       ts_rank_cd(search_tsv, websearch_to_tsquery('english', 'dampers')) as rank
from public.pms_ca_items
where search_tsv @@ websearch_to_tsquery('english', 'dampers')
order by rank desc limit 10;

-- ── 7. Privileges ─────────────────────────────────────────────────────────────
-- Expect: authenticated can SELECT only; anon nothing; reconcile is service_role only.
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'pms_ca_items'
group by grantee order by grantee;
select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can_execute
from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
where p.pronamespace = 'public'::regnamespace and p.proname = 'pms_ca_items_reconcile'
order by 2;

-- ── 8. Reconcile a single project after a logged WARNING ─────────────────────
-- select * from public.pms_ca_items_reconcile('<pms_projects.id>');
