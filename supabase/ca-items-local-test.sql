-- pms_ca_items — LOCAL behaviour test for migration 20261017120000. Not for
-- production: it inserts and deletes fake projects and truncates the table.
--
-- Runs against a throwaway Postgres 16 with pg_trgm (any local install):
--   psql -v ON_ERROR_STOP=1 -f supabase/ca-items-local-standin.sql   # roles + bare pms_projects
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261017120000_pms_ca_items.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261017130000_search_ca_items.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261017140000_search_ca_items_total.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261017150000_ca_items_embeddings.sql   # needs pgvector installed
--   psql -f supabase/ca-items-local-test.sql                          # ends with ALL TESTS PASSED
-- (run from the repo root: the test re-applies the migration by relative path).
--
-- Covers: the helpers, projection of every modelled field, the no-id and
-- duplicate-id keys, a non-array `rfis`, the "unrelated save leaves CA rows
-- alone" guard, renumber, remove, project delete cascade, full-text stemming,
-- the warn-and-continue path when the projection breaks, reconcile repair,
-- re-applying the migration, backfill counts, the RLS/privilege surface, and
-- the search_ca_items RPC (number / spec / prose / list shapes, fail-closed ids),
-- and the embeddings experiment pieces (embed text, job helpers, hybrid rank).

\set ON_ERROR_STOP on
\set QUIET on
-- ── helpers ───────────────────────────────────────────────────────────────────
do $$ begin
  assert public.pms_strip_html('<p>Hello&nbsp;<b>world</b></p><br>&lt;b&gt; stays &amp; ok</p>') = E'Hello world\n<b> stays & ok',
    'strip_html: ' || public.pms_strip_html('<p>Hello&nbsp;<b>world</b></p><br>&lt;b&gt; stays &amp; ok</p>');
  assert public.pms_strip_html('<style>.x{}</style>plain<script>alert(1)</script>') = 'plain', 'strip_html script/style';
  assert public.pms_strip_html('') is null and public.pms_strip_html('  ') is null, 'strip_html blank';
  assert public.pms_date_or_null('') is null and public.pms_date_or_null('n/a') is null, 'date blank';
  assert public.pms_date_or_null('2026-02-30') is null, 'date invalid';
  assert public.pms_date_or_null('2026-10-17T12:00:00Z') = date '2026-10-17', 'date iso';
  assert public.pms_ca_item_is_open('rfi','Open') and not public.pms_ca_item_is_open('rfi','Closed'), 'is_open rfi';
  assert public.pms_ca_item_is_open('submittal','Under Review') and not public.pms_ca_item_is_open('submittal','Approved'), 'is_open sub';
  assert public.pms_ca_items_array('{"rfis":"oops"}'::jsonb,'rfis') = '[]'::jsonb, 'array guard';
  raise notice 'helpers ok';
end $$;

-- ── 1. insert projects ────────────────────────────────────────────────────────
insert into public.pms_projects (id, project) values
('p1', $j${
  "id":"p1","projectNumber":"24-0117","name":"Tabler",
  "milestones":[{"id":"m1","name":"CD"}],
  "rfis":[
    {"id":"r1","number":"RFI-001","title":"Fire smoke damper at corridor","description":"Please confirm the <b>damper</b> rating","response":"<p>Use a 1.5 hr <i>FSD</i>.</p><p>See M-401.</p>","status":"Closed","discipline":"Mechanical","dateReceived":"2026-09-01","dueDate":"2026-09-08","dateResponded":"2026-09-05","assignedTo":["a@setty.com","b@setty.com"],"links":[{"targetSystem":"pms","targetType":"submittal","targetId":"s1"}],"aiReview":{"at":"2026-09-04T10:00:00Z","by":"x"}},
    {"id":"r2","number":"RFI-002","title":"Chiller piping","description":"","response":"","status":"Open","discipline":"Mechanical","dateReceived":"","dueDate":"","dateResponded":""},
    {"id":"","number":"RFI-003","title":"No id item","status":"Open"},
    "garbage-string",
    {"id":"r4","number":"RFI-004","title":"dup first","status":"Open"},
    {"id":"r4","number":"RFI-004","title":"dup last wins","status":"Open"}
  ],
  "submittals":[
    {"id":"s1","number":"SUB-001","specSection":" 23 09 23 ","description":"VAV terminal units","comments":"<div>Revise &amp; resubmit</div>","stamp":"R&R","status":"Resubmittal Required","dateReturned":"2026-09-10","resubNumber":"1","registerItemId":"reg9","source":"backload"},
    {"id":"s2","number":"SUB-002","specSection":"","description":"Grilles","comments":"","status":"Approved","dateReturned":"","resubNumber":""}
  ]
}$j$),
('p2', $j${"id":"p2","projectNumber":"25-0002","rfis":"not-an-array"}$j$),
('p3', $j${"id":"p3","projectNumber":"25-0003"}$j$);

do $$
declare r record; n int;
begin
  select count(*) into n from public.pms_ca_items; assert n = 6, 'expected 6 rows, got ' || n;
  select * into r from public.pms_ca_items where item_id='r1';
  assert r.project_prefix = '24-0117' and r.project_number = '24-0117', 'prefix';
  assert r.subject = 'Fire smoke damper at corridor', 'subject';
  assert r.response = E'Use a 1.5 hr FSD.\nSee M-401.', 'response: ' || r.response;
  assert r.body_text like E'Fire smoke damper at corridor\nPlease confirm the damper rating\nUse a 1.5 hr FSD.%', 'body: ' || r.body_text;
  assert r.date_closed = date '2026-09-05' and r.is_open = false, 'closed';
  assert r.assigned_to = array['a@setty.com','b@setty.com'], 'assigned';
  assert jsonb_array_length(r.links) = 1 and r.has_ai_review and r.ai_review_at = '2026-09-04T10:00:00Z', 'links/ai';
  select * into r from public.pms_ca_items where item_id='r2';
  assert r.is_open and r.date_received is null and r.date_closed is null and r.response is null and r.body_text = 'Chiller piping', 'r2: ' || coalesce(r.body_text,'<null>');
  select * into r from public.pms_ca_items where item_id='rfi:RFI-003';
  assert r.source = 'no-id' and r.number = 'RFI-003', 'no-id';
  select * into r from public.pms_ca_items where item_id='r4';
  assert r.subject = 'dup last wins', 'dup: ' || r.subject;
  select * into r from public.pms_ca_items where item_id='s1';
  assert r.spec_section = '23 09 23' and r.resub_number = 1 and r.register_item_id='reg9' and r.source='backload'
     and r.is_open and r.stamp='R&R' and r.response = 'Revise & resubmit' and r.date_closed = date '2026-09-10', 's1';
  select * into r from public.pms_ca_items where item_id='s2';
  assert r.spec_section is null and r.resub_number is null and not r.is_open, 's2';
  select count(*) into n from public.pms_ca_items where project_row_id in ('p2','p3'); assert n = 0, 'p2/p3 rows';
  raise notice 'insert projection ok';
end $$;

-- ── 2. unrelated save leaves rows alone; targeted edit touches one row ────────
select pg_sleep(0.05);
update public.pms_projects set project = jsonb_set(project, '{milestones,0,name}', '"DD"'), version = version + 1 where id='p1';
do $$ declare n int; begin
  select count(*) into n from public.pms_ca_items where project_row_id='p1' and projected_at > now() - interval '40 milliseconds';
  assert n = 0, 'milestone save rewrote ' || n || ' CA rows';
  raise notice 'unrelated save ok';
end $$;
select pg_sleep(0.05);
update public.pms_projects set project = jsonb_set(project, '{rfis,1,response}', '"<p>Route <b>dampers</b> above ceiling</p>"'), version = version + 1 where id='p1';
do $$ declare r record; n int; begin
  select count(*) into n from public.pms_ca_items where project_row_id='p1' and projected_at > now() - interval '40 milliseconds';
  assert n = 1, 'targeted edit touched ' || n || ' rows';
  select * into r from public.pms_ca_items where item_id='r2';
  assert r.response = 'Route dampers above ceiling', 'r2 response';
  raise notice 'targeted edit ok';
end $$;

-- ── 3. renumber keeps the key; remove deletes the row; delete project cascades ─
update public.pms_projects set project = jsonb_set(project, '{rfis,1,number}', '"RFI-002A"'), version = version + 1 where id='p1';
update public.pms_projects set project = project #- '{submittals,1}', version = version + 1 where id='p1';
do $$ declare r record; n int; begin
  select * into r from public.pms_ca_items where item_id='r2'; assert r.number = 'RFI-002A', 'renumber';
  select count(*) into n from public.pms_ca_items where item_id='s2'; assert n = 0, 's2 not deleted';
  select count(*) into n from public.pms_ca_items where project_row_id='p1'; assert n = 5, 'after delete count ' || n;
  raise notice 'renumber/remove ok';
end $$;
insert into public.pms_projects (id, project) values ('p9', $j${"id":"p9","projectNumber":"x","rfis":[{"id":"z","number":"RFI-001","title":"t","status":"Open"}]}$j$);
delete from public.pms_projects where id='p9';
do $$ declare n int; begin
  select count(*) into n from public.pms_ca_items where project_row_id='p9'; assert n = 0, 'cascade';
  raise notice 'cascade ok';
end $$;

-- ── 4. full text ──────────────────────────────────────────────────────────────
do $$ declare n int; begin
  select count(*) into n from public.pms_ca_items where search_tsv @@ websearch_to_tsquery('english', 'dampers');
  assert n = 2, 'dampers -> ' || n;   -- r1 (damper) and r2 (dampers)
  select count(*) into n from public.pms_ca_items where search_tsv @@ websearch_to_tsquery('simple', 'RFI-004');
  assert n = 1, 'number -> ' || n;
  select count(*) into n from public.pms_ca_items where search_tsv @@ websearch_to_tsquery('simple', '23 09 23');
  assert n = 1, 'spec -> ' || n;
  select count(*) into n from public.pms_ca_items where number ilike '%002%';
  assert n = 1, 'trgm number -> ' || n;
  raise notice 'full text ok';
end $$;

-- ── 5. failure injection: a broken projection never blocks the save ──────────
alter table public.pms_ca_items add constraint boom check (false) not valid;
update public.pms_projects set project = jsonb_set(project, '{rfis,0,title}', '"Edited while broken"'), version = version + 1 where id='p1';
do $$ declare r record; begin
  select * into r from public.pms_projects where id='p1';
  assert r.project #>> '{rfis,0,title}' = 'Edited while broken', 'save blocked';
  select * into r from public.pms_ca_items where item_id='r1';
  assert r.subject = 'Fire smoke damper at corridor', 'stale row expected while broken';
  raise notice 'broken projection did not block the save';
end $$;
alter table public.pms_ca_items drop constraint boom;
do $$ declare r record; w int; e text; begin
  select written, error into w, e from public.pms_ca_items_reconcile('p1');
  assert e is null, 'reconcile error ' || e;
  assert w = 1, 'reconcile wrote ' || w;
  select * into r from public.pms_ca_items where item_id='r1';
  assert r.subject = 'Edited while broken', 'reconcile did not repair: ' || r.subject;
  raise notice 'reconcile repair ok';
end $$;

-- ── 5b. re-applying the migration is harmless ─────────────────────────────────
create temp table before_count as select count(*) as n from public.pms_ca_items;
\i supabase/migrations/20261017120000_pms_ca_items.sql
do $$ declare n int; begin
  select count(*) into n from public.pms_ca_items;
  assert n = (select b.n from before_count b), 'row count changed on re-apply';
  raise notice 're-apply ok';
end $$;

-- ── 6. backfill equals the blob ───────────────────────────────────────────────
truncate public.pms_ca_items;
select count(*) as reconciled from public.pms_ca_items_reconcile() \gset
do $$ declare a int; b int; begin
  select count(*) into a from public.pms_ca_items;
  select coalesce(sum(jsonb_array_length(public.pms_ca_items_array(project,'rfis')) + jsonb_array_length(public.pms_ca_items_array(project,'submittals'))),0) into b from public.pms_projects;
  -- blob has 6 rfis (1 garbage string, 1 dup) + 1 submittal = 7 elements; rows = 5
  assert a = 5 and b = 7, format('backfill rows=%s blob=%s', a, b);
  raise notice 'backfill ok (% rows, % blob elements incl. 1 non-object + 1 duplicate id)', a, b;
end $$;

-- ── 6b. search_ca_items (the connector's read path) ──────────────────────────
do $$ declare r record; n int; begin
  -- fail closed: no ids, no rows
  select count(*) into n from public.search_ca_items(null); assert n = 0, 'null ids';
  select count(*) into n from public.search_ca_items('{}'::text[]); assert n = 0, 'empty ids';
  -- list: newest received first
  select count(*) into n from public.search_ca_items(array['p1','p2','p3']); assert n = 5, 'list ' || n;
  select * into r from public.search_ca_items(array['p1']) limit 1;
  assert r.item_id = 'r1', 'newest first, got ' || r.item_id;
  assert r.rank = 0 and r.link_count = 1 and r.has_ai_review, 'list row shape';
  -- number: digits agree ignoring zeros, prefix narrows nothing here (p_type does)
  select count(*) into n from public.search_ca_items(array['p1'], p_number => '4'); assert n = 1, 'number 4 -> ' || n;
  select * into r from public.search_ca_items(array['p1'], p_number => 'RFI-004'); assert r.item_id = 'r4' and r.rank = 10, 'RFI-004';
  select count(*) into n from public.search_ca_items(array['p1'], p_number => '2', p_type => 'submittal'); assert n = 0, 'type filter';
  select count(*) into n from public.search_ca_items(array['p1'], p_number => '002A'); assert n = 1, 'suffix number';
  -- spec: separators ignored
  select * into r from public.search_ca_items(array['p1'], p_spec => '230923'); assert r.item_id = 's1' and r.rank = 5, 'spec';
  select count(*) into n from public.search_ca_items(array['p1'], p_spec => '999999'); assert n = 0, 'spec miss';
  -- prose: stemmed, ranked, headline snippet
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'dampers'); assert n = 2, 'dampers -> ' || n;
  select * into r from public.search_ca_items(array['p1'], p_text => 'dampers above ceiling') limit 1;
  assert r.item_id = 'r2' and r.rank > 0 and r.snippet like '%[dampers]%', 'prose rank/snippet: ' || coalesce(r.snippet,'');
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'dampers', p_open_only => true); assert n = 1, 'open only';
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'dampers', p_discipline => 'mechanical'); assert n = 2, 'discipline ci';
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'dampers', p_status => 'Closed'); assert n = 1, 'status';
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'nothing matches this'); assert n = 0, 'prose miss';
  -- a discipline or status word still matches, as the in-memory scan did (Codex P2)
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'Mechanical'); assert n = 2, 'discipline word -> ' || n;
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'closed'); assert n = 1, 'status word -> ' || n;
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'resub'); assert n = 1, 'status substring -> ' || n;
  select * into r from public.search_ca_items(array['p1'], p_text => 'closed') limit 1; assert r.rank = 1, 'field rank';
  -- a zero-only number filters instead of listing everything (Codex P2)
  select count(*) into n from public.search_ca_items(array['p1'], p_number => 'RFI-000'); assert n = 0, 'RFI-000 -> ' || n;
  select count(*) into n from public.search_ca_items(array['p1'], p_number => '0'); assert n = 0, 'zero -> ' || n;
  select count(*) into n from public.search_ca_items(array['p1'], p_number => 'RFI-0001', p_type => 'rfi'); assert n = 1, 'padded number -> ' || n;  -- the connector passes the prefix as p_type
  select count(*) into n from public.search_ca_items(array['p1'], p_number => '1'); assert n = 2, 'bare 1 matches RFI-001 and SUB-001 -> ' || n;
  -- total = matches before the limit, on every row
  select total into n from public.search_ca_items(array['p1'], p_limit => 2) limit 1; assert n = 5, 'total -> ' || n;
  select count(*) into n from public.search_ca_items(array['p1'], p_limit => 2); assert n = 2, 'limited rows -> ' || n;
  select total into n from public.search_ca_items(array['p1'], p_text => 'dampers', p_limit => 1) limit 1; assert n = 2, 'total with query -> ' || n;
  -- limit clamps
  select count(*) into n from public.search_ca_items(array['p1'], p_limit => 0); assert n = 1, 'limit floor';
  raise notice 'search_ca_items ok';
end $$;

-- ── 6c. embeddings: embed text, job helpers, hybrid search ───────────────────
-- Fake unit vectors stand in for the model: e(k) has a 1 at position k.
create or replace function pg_temp.e(k int, v real default 1) returns extensions.vector(384) language sql as $$
  select ('[' || string_agg(case when i = k then v::text else '0' end, ',' order by i) || ']')::extensions.vector(384)
  from generate_series(1, 384) i $$;
-- a vector close to e(1): cosine similarity 0.9 / sqrt(0.9^2 + 0.1^2) = 0.994
create or replace function pg_temp.near1() returns extensions.vector(384) language sql as $$
  select ('[' || string_agg(case when i = 1 then '0.9' when i = 2 then '0.1' else '0' end, ',' order by i) || ']')::extensions.vector(384)
  from generate_series(1, 384) i $$;

do $$ declare t text; n int; r record; begin
  -- embed text: boilerplate stripped, the real notes kept, capped, null when empty
  t := public.pms_ca_items_embed_text('Air Terminal Units',
       E'NOTATIONS: 1. Comments, corrections, approvals, or provisional acceptance made to submittals, shop drawings, or other project correspondence during the review process do not relieve contractor from compliance. 2. Provide 2-inch filters.');
  assert t = E'Air Terminal Units\nNOTATIONS: 2. Provide 2-inch filters.', 'submittal boilerplate: ' || t;
  t := public.pms_ca_items_embed_text('FDC Relocation',
       E'General Notations: This RFI, RFI response, and related correspondence, written, verbal, or other; is not an authorization to proceed. Response: Relocate the FDC to the north wall.');
  assert t = E'FDC Relocation\nResponse: Relocate the FDC to the north wall.', 'rfi boilerplate: ' || t;
  assert length(public.pms_ca_items_embed_text('x', repeat('a', 5000))) = 1500, 'cap';
  assert public.pms_ca_items_embed_text('', '  ') is null, 'empty';
  assert public.pms_ca_items_embed_text(null, 'body only') = 'body only', 'no subject';
  raise notice 'embed text ok';

  -- job helpers: everything needs embedding at first
  select count(*) into n from public.pms_ca_items_to_embed(); assert n = 5, 'to_embed initial ' || n;
  select count(*) into n from public.pms_ca_items_to_embed(2); assert n = 2, 'to_embed limit';
  -- store: r1 -> e(1), r2 -> e(2), s1 -> e(3) (orthogonal, so the fused order is unambiguous); one bad hash is skipped
  select public.pms_ca_items_store_embeddings(jsonb_build_array(
    jsonb_build_object('project_row_id','p1','item_type','rfi','item_id','r1','embed_hash',(select embed_hash from public.pms_ca_items_to_embed(10) where item_id='r1'),'embedding',pg_temp.e(1)::text),
    jsonb_build_object('project_row_id','p1','item_type','rfi','item_id','r2','embed_hash',(select embed_hash from public.pms_ca_items_to_embed(10) where item_id='r2'),'embedding',pg_temp.e(2)::text),
    jsonb_build_object('project_row_id','p1','item_type','submittal','item_id','s1','embed_hash',(select embed_hash from public.pms_ca_items_to_embed(10) where item_id='s1'),'embedding',pg_temp.e(3)::text),
    jsonb_build_object('project_row_id','p1','item_type','rfi','item_id','r4','embed_hash','stale-hash','embedding',pg_temp.e(4)::text)
  )) into n;
  assert n = 3, 'stored ' || n;
  select count(*) into n from public.pms_ca_items_to_embed(); assert n = 2, 'to_embed after store ' || n;  -- r4 (bad hash) and rfi:RFI-003
  -- an edit re-queues just that row (keeps the word "damper" for the search checks below)
  update public.pms_projects set project = jsonb_set(project, '{rfis,0,description}', '"Please confirm the damper rating again"'), version = version + 1 where id='p1';
  select count(*) into n from public.pms_ca_items_to_embed() where item_id = 'r1'; assert n = 1, 're-queue on edit';
  select embedded_hash into t from public.pms_ca_items where item_id='r1';
  assert t is distinct from (select embed_hash from public.pms_ca_items_to_embed(10) where item_id='r1'), 'hash moved';
  raise notice 'embed job helpers ok';

  -- hybrid search: no embedding -> identical to before. r1 (description "damper",
  -- received 2026-09-01) and r2 (response "dampers", no date) match; equal text
  -- rank, so the date tie-break puts r1 first.
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'dampers'); assert n = 2, 'lexical dampers ' || n;
  select * into r from public.search_ca_items(array['p1'], p_text => 'dampers') limit 1;
  assert r.item_id = 'r1', 'lexical top is r1, got ' || r.item_id;
  -- with r2's vector as the query, r2 is in both lists and rises to the top; r1 (orthogonal) is lexical only
  select * into r from public.search_ca_items(array['p1'], p_text => 'dampers', p_embedding => pg_temp.e(2)) limit 1;
  assert r.item_id = 'r2', 'hybrid top is r2, got ' || r.item_id;
  assert r.total = 2, 'hybrid total ' || r.total;
  -- a vector merely close to r1's (similarity 0.994) clears the floor and lifts r1
  select * into r from public.search_ca_items(array['p1'], p_text => 'dampers', p_embedding => pg_temp.near1()) limit 1;
  assert r.item_id = 'r1' and r.rank > 0.03, 'near vector lifts r1, got ' || r.item_id || ' rank ' || r.rank;
  -- a semantic-only hit: s1 (no "damper" text) appears when its vector is the query
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'dampers', p_embedding => pg_temp.e(3)) where item_id = 's1';
  assert n = 1, 'semantic-only hit missing';
  select total into n from public.search_ca_items(array['p1'], p_text => 'dampers', p_embedding => pg_temp.e(3)) limit 1;
  assert n = 3, 'hybrid total with addition ' || n;
  -- the floor keeps dissimilar vectors out: e(4) is orthogonal to everything stored (r4 never stored)
  select count(*) into n from public.search_ca_items(array['p1'], p_text => 'dampers', p_embedding => pg_temp.e(4)); assert n = 2, 'floor';
  -- number and spec shapes ignore the embedding entirely
  select count(*) into n from public.search_ca_items(array['p1'], p_number => 'RFI-004', p_embedding => pg_temp.e(3)); assert n = 1, 'number ignores embedding';
  select count(*) into n from public.search_ca_items(array['p1'], p_spec => '230923', p_embedding => pg_temp.e(1)); assert n = 1, 'spec ignores embedding';
  select count(*) into n from public.search_ca_items(array['p1'], p_embedding => pg_temp.e(1)); assert n = 5, 'list ignores embedding';
  raise notice 'hybrid search ok';
end $$;

-- ── 7. RLS / privileges ───────────────────────────────────────────────────────
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.pms_ca_items; assert n = 5, 'authenticated select';
  begin insert into public.pms_ca_items (project_row_id,item_type,item_id,raw) values ('p1','rfi','hack','{}'); raise exception 'insert allowed';
  exception when insufficient_privilege then null; end;
  begin truncate public.pms_ca_items; raise exception 'truncate allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.pms_ca_items_reconcile(); raise exception 'reconcile allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.search_ca_items(array['p1']); raise exception 'search allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.pms_ca_items_to_embed(); raise exception 'to_embed allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.pms_ca_items_store_embeddings('[]'); raise exception 'store allowed';
  exception when insufficient_privilege then null; end;
  raise notice 'authenticated: read yes, write/truncate/reconcile no';
end $$;
reset role;
set role anon;
do $$ declare n int; begin
  begin select count(*) into n from public.pms_ca_items; raise exception 'anon select allowed';
  exception when insufficient_privilege then null; end;
  raise notice 'anon: no read';
end $$;
reset role;
set role service_role;
do $$ declare n int; begin
  select count(*) into n from public.pms_ca_items_reconcile(); assert n = 3, 'service reconcile ' || n;
  select count(*) into n from public.search_ca_items(array['p1']); assert n = 5, 'service search ' || n;
  raise notice 'service_role: reconcile ok';
end $$;
reset role;
\echo ALL TESTS PASSED
