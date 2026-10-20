-- pms_project_emails embeddings — LOCAL behaviour test for migration
-- 20261020120000. Not for production: it truncates the table.
--
-- Runs against a throwaway Postgres 16 with pgvector (any local install):
--   psql -v ON_ERROR_STOP=1 -f supabase/emails-local-standin.sql                        # roles, bare table, stand-in keyword search
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261020120000_emails_embeddings.sql
--   psql -f supabase/emails-local-test.sql                                              # ends with ALL TESTS PASSED
-- (run from the repo root: the test re-applies the migration by relative path).
-- To exercise the first-application rename (the live function present, no
-- pms_emails_search_lexical yet), rename the stand-in before the migration:
--   psql -c 'alter function public.pms_emails_search_lexical(text,text,integer) rename to search_project_emails'
--
-- Covers: the thread key, the cleaning rule (reply cut, forward kept, footers,
-- urls, quote prefixes, cap, blank), the queue and store helpers (newest
-- first, limit clamp, hash guard, drained rows leave the queue), keyword mode
-- unchanged (same rows, same order, search_mode 'keyword'), hybrid mode (a
-- three-reply thread collapses to one row with thread_count 3 and the newest
-- message, a keyword-only hit survives, the similarity floor, the project
-- filter, the subject-based thread key), re-applying the migration, and the
-- privilege surface.

\set ON_ERROR_STOP on
\set QUIET on

-- a 384-dim vector with two chosen components (cosine similarity is all that matters)
create or replace function pg_temp.tv(a float, b float) returns extensions.vector
language sql immutable as $$
  select (('[' || a || ',' || b || ',' || repeat('0,', 381) || '0]'))::extensions.vector(384)
$$;

-- ── helpers ───────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  assert public.pms_emails_thread_subject('RE: FW:  Re: Chiller  disconnect ') = 'chiller disconnect', 'thread subject prefixes';
  assert public.pms_emails_thread_subject('  ') is null and public.pms_emails_thread_subject(null) is null, 'thread subject blank';
  assert public.pms_emails_thread_subject('Fwd: RFI #28 - 363250') = 'rfi #28 - 363250', 'thread subject fwd';

  -- a reply: new text above, quoted history below the Outlook header block
  t := public.pms_emails_embed_text('RE: Chiller disconnect',
    E'Bob,\r\n\r\nThe disconnect has to be within sight of the unit, so the wall location works. Please confirm the conduit size with the EC.\r\n\r\nThanks,\r\nAnne\r\n\r\n________________________________\r\nFrom: Bob Builder <bob@gc.com>\r\nSent: Monday, October 19, 2026 9:12 AM\r\nTo: Anne Engineer <anne@setty.com>\r\nSubject: Chiller disconnect\r\n\r\nCan we move the disconnect to the wall behind the chiller?\r\n');
  assert t = E'Chiller disconnect\nBob,\n\nThe disconnect has to be within sight of the unit, so the wall location works. Please confirm the conduit size with the EC.\n\nThanks,\nAnne',
    'reply cut: ' || t;

  -- the same with -----Original Message-----
  t := public.pms_emails_embed_text('RE: Chiller disconnect',
    E'Agreed, wall location is fine with me as long as it stays within sight.\n\n-----Original Message-----\nFrom: Bob\nSent: Monday\n\nCan we move it?');
  assert t = E'Chiller disconnect\nAgreed, wall location is fine with me as long as it stays within sight.', 'original message cut: ' || t;

  -- "On ... wrote:"
  t := public.pms_emails_embed_text('Re: Grease trap',
    E'The pit is too small for the unit we scheduled; see the attached cut sheet for the next size down.\n\nOn Mon, Oct 19, 2026 at 3:12 PM Bob <bob@gc.com> wrote:\n> Is the pit big enough?\n> Bob');
  assert t = E'Grease trap\nThe pit is too small for the unit we scheduled; see the attached cut sheet for the next size down.', 'on wrote cut: ' || t;

  -- a forward with a one-line note keeps the forwarded content (quote prefixes and rule lines go)
  t := public.pms_emails_embed_text('FW: RFI #28 - 363250',
    E'FYI see below\n\nFrom: DS Motrich <rfi@dsmotrich.com>\nSent: Friday\nTo: Setty\nSubject: RFI #28 - 363250\n\n> Please advise whether the roof fan sits on a curb or a concrete pad.\n');
  assert t = E'RFI #28 - 363250\nFYI see below\n\nFrom: DS Motrich <rfi@dsmotrich.com>\nSent: Friday\nTo: Setty\nSubject: RFI #28 - 363250\n\nPlease advise whether the roof fan sits on a curb or a concrete pad.', 'forward kept: ' || t;

  -- footers, urls, cid stubs
  t := public.pms_emails_embed_text('Submittal 232113-011-0 returned',
    E'The pressure test passed with conditions, see https://app.procore.com/123/submittals/9 for the markup. [cid:image001.png@01DC]\n\nThis email was sent to you by Procore. To unsubscribe click here.');
  assert t = E'Submittal 232113-011-0 returned\nThe pressure test passed with conditions, see for the markup.', 'footer/url: ' || t;
  t := public.pms_emails_embed_text('Notice', E'Short note.\n\nNotification generated by Newforma Project Center.\nCONFIDENTIALITY NOTICE: this message is private.');
  assert t = E'Notice\nShort note.', 'newforma footer: ' || t;

  -- cap and blanks
  assert length(public.pms_emails_embed_text('S', repeat('word ', 1000))) = 1500, 'cap 1500';
  assert public.pms_emails_embed_text('', '   ') is null and public.pms_emails_embed_text(null, null) is null, 'blank is null';
  assert public.pms_emails_embed_text('Only a subject', null) = 'Only a subject', 'subject only';
  raise notice 'helpers ok';
end $$;

-- ── 1. rows ───────────────────────────────────────────────────────────────────
truncate public.pms_project_emails;
insert into public.pms_project_emails (record_id, project_id, conversation_id, subject, from_name, from_address, direction, email_date, body_text, preview, has_attachments) values
-- a three-reply thread on p1 about the chiller disconnect
('e1', 'p1', 'conv-1', 'Chiller disconnect',     'Bob',  'bob@gc.com',    'incoming', '2026-10-01 09:00+00', 'Can we move the disconnect to the wall behind the chiller?', 'Can we move', false),
('e2', 'p1', 'conv-1', 'RE: Chiller disconnect', 'Anne', 'anne@setty.com','outgoing', '2026-10-01 11:00+00', E'Within sight of the unit is the rule, so the wall works.\n\nFrom: Bob\nSent: x\nTo: Anne\nSubject: Chiller disconnect\n\nCan we move the disconnect?', 'Within sight', false),
('e3', 'p1', 'conv-1', 'RE: Chiller disconnect', 'Bob',  'bob@gc.com',    'incoming', '2026-10-02 08:00+00', E'Thanks, we will run the conduit along the wall then and close this out.\n\nFrom: Anne\nSent: x\nTo: Bob\nSubject: RE: Chiller disconnect\n\nWithin sight of the unit is the rule.', 'Thanks', false),
-- an unrelated keyword hit on p1 (mentions "wall" too)
('e4', 'p1', 'conv-2', 'Fire wall penetration',  'Cat',  'cat@arch.com',  'incoming', '2026-09-20 10:00+00', 'The duct through the rated wall needs a damper; please confirm the rating.', 'The duct', true),
-- two rows with no conversation id and a subject-only thread
('e5', 'p1', null,     'Grease trap sizing',     'Dan',  'dan@gc.com',    'incoming', '2026-09-10 10:00+00', 'The pit is too small for the scheduled unit.', 'The pit', false),
('e6', 'p1', null,     'RE: Grease trap sizing', 'Anne', 'anne@setty.com','outgoing', '2026-09-11 10:00+00', 'Use the next size down, cut sheet attached.', 'Use the next', true),
-- another project
('e7', 'p2', 'conv-9', 'Chiller disconnect location', 'Eve', 'eve@gc.com', 'incoming', '2026-10-05 10:00+00', 'Where does the chiller disconnect go on this one?', 'Where', false),
-- nothing to embed
('e8', 'p2', null, '', 'Nobody', 'n@x.com', 'incoming', '2026-10-06 10:00+00', '   ', '', false);

-- ── 2. queue and store ───────────────────────────────────────────────────────
do $$
declare r record; n int; ids text[];
begin
  select array_agg(record_id order by record_id) into ids from public.pms_emails_to_embed(100);
  assert ids = array['e1','e2','e3','e4','e5','e6','e7'], 'queue skips the blank row: ' || ids::text;
  select array_agg(record_id) into ids from public.pms_emails_to_embed(2);
  assert ids = array['e7','e3'], 'queue newest first, limited: ' || ids::text;
  select array_agg(record_id) into ids from public.pms_emails_to_embed(0);
  assert array_length(ids, 1) = 1, 'limit clamps to 1';
  select embed_text into strict r from public.pms_emails_to_embed(100) where record_id = 'e2';
  assert r.embed_text = E'Chiller disconnect\nWithin sight of the unit is the rule, so the wall works.', 'queue carries cleaned text: ' || r.embed_text;

  -- store: a good row, a row with a stale hash, a row with no embedding key, garbage
  n := public.pms_emails_store_embeddings(jsonb_build_array(
    jsonb_build_object('record_id', 'e1', 'embed_hash', md5(public.pms_emails_embed_text('Chiller disconnect', 'Can we move the disconnect to the wall behind the chiller?')), 'embedding', pg_temp.tv(1, 0)::text),
    jsonb_build_object('record_id', 'e4', 'embed_hash', 'stale', 'embedding', pg_temp.tv(1, 0)::text),
    jsonb_build_object('record_id', 'e5', 'embed_hash', 'x'),
    'garbage'));
  assert n = 1, 'store writes only the row whose hash still matches: ' || n;
  select embedded_hash, embedded_at into r from public.pms_project_emails where record_id = 'e1';
  assert r.embedded_hash is not null and r.embedded_at is not null, 'store stamps hash and time';
  select array_agg(record_id order by record_id) into ids from public.pms_emails_to_embed(100);
  assert ids = array['e2','e3','e4','e5','e6','e7'], 'stored row leaves the queue: ' || ids::text;
  assert public.pms_emails_store_embeddings(null) = 0 and public.pms_emails_store_embeddings('[]') = 0, 'store empty';
  raise notice 'queue/store ok';
end $$;

-- embed the rest by hand: the chiller thread near (1,0), the others elsewhere
update public.pms_project_emails set embedding = pg_temp.tv(0.95, 0.3), embedded_hash = 'h', embedded_at = now() where record_id = 'e2';
update public.pms_project_emails set embedding = pg_temp.tv(0.9, 0.4),  embedded_hash = 'h', embedded_at = now() where record_id = 'e3';
update public.pms_project_emails set embedding = pg_temp.tv(0, 1),      embedded_hash = 'h', embedded_at = now() where record_id = 'e4';
update public.pms_project_emails set embedding = pg_temp.tv(-1, 0),     embedded_hash = 'h', embedded_at = now() where record_id = 'e5';
update public.pms_project_emails set embedding = pg_temp.tv(-0.9, 0.1), embedded_hash = 'h', embedded_at = now() where record_id = 'e6';
update public.pms_project_emails set embedding = pg_temp.tv(0.98, 0.1), embedded_hash = 'h', embedded_at = now() where record_id = 'e7';

-- ── 3. keyword mode is the lexical function, unchanged ───────────────────────
do $$
declare a text[]; b text[]; r record;
begin
  select array_agg(record_id order by rank desc, email_date desc nulls last) into a from public.pms_emails_search_lexical('wall', 'p1', 10);
  select array_agg(record_id order by ord) into b
    from (select record_id, row_number() over () as ord from public.search_project_emails('wall', 'p1', 10)) x;
  assert a = b, 'keyword rows and order: lexical ' || a::text || ' wrapper ' || b::text;
  assert array_length(a, 1) = 4, 'wall hits e1 e2 e3 e4: ' || a::text;
  for r in select * from public.search_project_emails('wall', 'p1', 10) loop
    assert r.search_mode = 'keyword' and r.thread_count = 1 and r.similarity is null, 'keyword row shape';
    assert r.rank > 0 and r.subject is not null and r.direction is not null, 'keyword row columns';
  end loop;
  -- limit honoured, project filter honoured, no project
  select count(*) into r from public.search_project_emails('wall', 'p1', 2);   assert r.count = 2, 'keyword limit';
  select count(*) into r from public.search_project_emails('chiller', null, 10); assert r.count = 4, 'keyword firm-wide: ' || r.count;
  select count(*) into r from public.search_project_emails('chiller', 'p2', 10); assert r.count = 1, 'keyword p2';
  -- an embedding without a query is still keyword mode (nothing to fuse)
  select count(*) into r from public.search_project_emails('', 'p1', 10, pg_temp.tv(1, 0));
  assert r.count = 0, 'blank query with embedding: lexical decides';
  raise notice 'keyword mode ok';
end $$;

-- ── 4. hybrid mode ───────────────────────────────────────────────────────────
do $$
declare r record; n int; ids text[];
begin
  -- "where does the disconnect go" style query: keyword hits e2 e3 e4 (wall); vector near the chiller thread
  select array_agg(record_id order by rank desc) into ids from public.search_project_emails('wall', 'p1', 10, pg_temp.tv(1, 0));
  assert ids = array['e3', 'e4'], 'hybrid collapses the thread and keeps the keyword-only hit: ' || ids::text;
  select * into strict r from public.search_project_emails('wall', 'p1', 10, pg_temp.tv(1, 0)) where record_id = 'e3';
  assert r.search_mode = 'hybrid' and r.thread_count = 3, 'thread row: ' || r.thread_count;
  assert r.similarity > 0.9, 'thread row carries the newest message''s similarity: ' || r.similarity;
  select * into strict r from public.search_project_emails('wall', 'p1', 10, pg_temp.tv(1, 0)) where record_id = 'e4';
  assert r.thread_count = 1 and r.similarity is null, 'keyword-only row has no similarity';

  -- the thread outranks the single hit: three list positions fused versus one
  select array_agg(record_id order by rank desc) into ids from public.search_project_emails('wall', 'p1', 10, pg_temp.tv(1, 0));
  assert ids[1] = 'e3', 'thread first';

  -- semantic-only: a query with no keyword hit still finds the thread by vector
  select array_agg(record_id) into ids from public.search_project_emails('zzzz nothing', 'p1', 10, pg_temp.tv(1, 0));
  assert ids = array['e3'], 'semantic-only finds the thread: ' || coalesce(ids::text, 'null');

  -- similarity floor
  select count(*) into r from public.search_project_emails('zzzz nothing', 'p1', 10, pg_temp.tv(1, 0), 0.999);
  assert r.count = 1, 'floor 0.999 keeps only e1-exact thread members (e1): ' || r.count;
  select count(*) into r from public.search_project_emails('zzzz nothing', 'p1', 10, pg_temp.tv(0, -1), 0.75);
  assert r.count = 0, 'nothing above the floor';

  -- project filter applies to the vector side too; firm-wide finds p2
  select array_agg(record_id order by record_id) into ids from public.search_project_emails('zzzz nothing', null, 10, pg_temp.tv(1, 0));
  assert ids = array['e3', 'e7'], 'firm-wide semantic: ' || ids::text;

  -- subject-based thread key when conversation_id is null
  select array_agg(record_id) into ids from public.search_project_emails('grease', 'p1', 10, pg_temp.tv(-1, 0));
  assert ids = array['e6'], 'subject thread collapses to the newest: ' || ids::text;
  select thread_count into strict n from public.search_project_emails('grease', 'p1', 10, pg_temp.tv(-1, 0));
  assert n = 2, 'subject thread count 2: ' || n;

  -- no duplicate thread in any result
  select count(*) - count(distinct coalesce(nullif(e.conversation_id, ''), public.pms_emails_thread_subject(e.subject))) into n
    from public.search_project_emails('wall', null, 10, pg_temp.tv(1, 0)) s
    join public.pms_project_emails e on e.record_id = s.record_id;
  assert n = 0, 'one row per thread';

  -- limit
  select count(*) into r from public.search_project_emails('wall', null, 1, pg_temp.tv(1, 0));
  assert r.count = 1, 'hybrid limit';
  raise notice 'hybrid mode ok';
end $$;

-- ── 5. re-apply the migration (idempotent: columns, index, rename guard, function) ──
\i supabase/migrations/20261020120000_emails_embeddings.sql
do $$
declare r record;
begin
  select count(*) into r from public.search_project_emails('wall', 'p1', 10, pg_temp.tv(1, 0));
  assert r.count = 2, 're-apply keeps data and behaviour';
  select count(*) into r from pg_proc where proname in ('search_project_emails', 'pms_emails_search_lexical') and pronamespace = 'public'::regnamespace;
  assert r.count = 2, 'exactly one of each function';
  raise notice 're-apply ok';
end $$;

-- ── 6. privilege surface ─────────────────────────────────────────────────────
do $$
begin
  assert not has_function_privilege('anon', 'public.pms_emails_to_embed(integer)', 'execute'), 'anon to_embed';
  assert not has_function_privilege('authenticated', 'public.pms_emails_store_embeddings(jsonb)', 'execute'), 'auth store';
  assert not has_function_privilege('authenticated', 'public.search_project_emails(text, text, integer, extensions.vector, real)', 'execute'), 'auth search';
  assert not has_function_privilege('authenticated', 'public.pms_emails_search_lexical(text, text, integer)', 'execute'), 'auth lexical';
  assert has_function_privilege('service_role', 'public.search_project_emails(text, text, integer, extensions.vector, real)', 'execute'), 'service search';
  assert has_function_privilege('service_role', 'public.pms_emails_to_embed(integer)', 'execute'), 'service to_embed';
  raise notice 'privileges ok';
end $$;

\echo ALL TESTS PASSED
