-- pms_project_emails embeddings — LOCAL behaviour test for migrations
-- 20261020100000 (baseline) and 20261020120000 (embeddings). Not for
-- production: it truncates the table.
--
-- Runs against a throwaway Postgres 16 with pgvector (any local install):
--   psql -v ON_ERROR_STOP=1 -f supabase/emails-local-standin.sql                               # roles, extensions schema
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261020100000_baseline_pms_project_emails.sql  # table + stand-in keyword search
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261020110000_search_project_emails_capture.sql # the live keyword search, captured
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261020120000_emails_embeddings.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261029120000_emails_thread_collapse_by_subject.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261029130000_emails_search_snippet.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261029140000_emails_search_snippet_cleaned.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261029150000_emails_embed_text_banners.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261030100000_emails_embed_text_sender_attachments.sql
--   psql -f supabase/emails-local-test.sql                                                     # ends with ALL TESTS PASSED
-- (run from the repo root: the test re-applies the migration by relative path).
-- Drop the capture line to exercise the first-application rename instead
-- (the baseline leaves its stand-in under the live name); both orders pass.
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

  -- mail-client banners above the message go (20261029150000); a WARNING that
  -- is not about the sender stays, it may be engineering content
  t := public.pms_emails_strip_banners(E'Some people who received this message don’t often get email from andrew@southern-air.com. Learn why this is important<x>\nGerry,\nHere you go.');
  assert t = E'\nGerry,\nHere you go.', 'unfamiliar sender notice: ' || t;
  t := public.pms_emails_strip_banners(E'You don''t often get email from bob@gc.com.\nLearn why this is important\nHi');
  assert t = E'\nHi', 'you don''t often: ' || t;
  t := public.pms_emails_strip_banners(E'External Email: This message originated outside the organization. Use caution.\n** WARNING: This email has originated from outside of the organization. Do not click links.\n[EXTERNAL]\nCAUTION - external sender\nThe pump is from outside the building line.\nWARNING: the chiller trips at 40F.');
  assert t = E'\n\n\n\nThe pump is from outside the building line.\nWARNING: the chiller trips at 40F.', 'external banners: ' || t;
  t := public.pms_emails_embed_text('RE: Health Dept Chiller Lead Times',
    E'Some people who received this message don''t often get email from andrew@southern-air.com. Learn why this is important\r\n\r\nGerry,\r\n\r\nHere you go - we added for the pump controls.\r\n\r\nThanks,\r\nAndrew\r\n\r\nFrom: Martin, Gerry\r\nSent: Monday\r\nTo: Andrew\r\nSubject: Health Dept Chiller Lead Times\r\n\r\nExternal Email: This message originated outside the organization.\r\n\r\nCan you check?');
  assert t = E'Health Dept Chiller Lead Times\nGerry,\n\nHere you go - we added for the pump controls.\n\nThanks,\nAndrew', 'embed text without the notice: ' || t;
  assert public.pms_emails_embed_text('', E'External Email: This message originated outside the organization.\n') is null, 'banner-only body is blank';

  -- the 5-argument text: sender and attachment names between subject and body (20261030100000)
  t := public.pms_emails_embed_text('RE: Health Dept Chiller Lead Times', 'Here you go.', 'Andrew Davidson', 'andrew.davidson@southern-air.com',
         '["image001.jpg", "Quote-141054-3 Health Department Chiller revised with Pump Control.pdf", "image002.png"]');
  assert t = E'Health Dept Chiller Lead Times\nFrom Andrew Davidson (southern-air)\nAttachments: Quote-141054-3 Health Department Chiller revised with Pump Control\nHere you go.', 'full text: ' || t;
  t := public.pms_emails_embed_text('S', 'b', 'Bob', 'bob@gmail.com', null);
  assert t = E'S\nFrom Bob\nb', 'generic mailbox: no organisation: ' || t;
  t := public.pms_emails_embed_text('S', 'b', null, '', null);
  assert t = E'S\nb', 'no sender: no From line: ' || t;
  t := public.pms_emails_embed_text('S', 'b', 'A', 'a@firm.co.uk', '["CH-1_submittal.pdf", "CH-1_submittal.pdf", "x.y", "Spec_Section_23_64_16.docx"]');
  assert t = E'S\nFrom A (firm)\nAttachments: CH-1 submittal, Spec Section 23 64 16\nb', 'names cleaned, de-duplicated, short ones skipped: ' || t;
  t := public.pms_emails_embed_text('S', 'b', 'A', 'a@x.com', '"not an array"');
  assert t = E'S\nFrom A (x)\nb', 'attachments not an array: ' || t;
  t := public.pms_emails_embed_text('Only', null, 'A', 'a@x.com', null);
  assert t = E'Only\nFrom A (x)', 'subject and sender only: ' || t;
  t := public.pms_emails_embed_text('S', 'b', 'A', 'a@x.com', (select jsonb_agg('file_' || g || '_' || repeat('n', 20) || '.pdf') from generate_series(1, 20) g));
  assert length(split_part(t, E'\n', 3)) = 300 and split_part(t, E'\n', 4) = 'b', 'attachments line cut at 300, body kept: ' || length(split_part(t, E'\n', 3));
  t := public.pms_emails_embed_text('S', repeat('word ', 1000), 'A', 'a@x.com', '["long_name.pdf"]');
  assert length(t) = 1500 and t like E'S\nFrom A (x)\nAttachments: long name\nword%', 'total cap, body is what is cut: ' || left(t, 60);
  assert public.pms_emails_embed_text(null, null, null, null, null) is null, '5-arg blank is null';
  assert public.pms_emails_embed_text('', '  ', 'Nobody', 'n@x.com', '["a_file.pdf"]') is null, 'no subject and no body: nothing to embed, whoever sent it';
  -- the 2-argument form is untouched (it is what the snippet is cut from)
  assert public.pms_emails_embed_text('RE: S', 'b') = E'S\nb', '2-arg form unchanged';

  -- cap and blanks
  assert length(public.pms_emails_embed_text('S', repeat('word ', 1000))) = 1500, 'cap 1500';
  assert public.pms_emails_embed_text('', '   ') is null and public.pms_emails_embed_text(null, null) is null, 'blank is null';
  assert public.pms_emails_embed_text('Only a subject', null) = 'Only a subject', 'subject only';
  raise notice 'helpers ok';
end $$;

-- ── 1. rows ───────────────────────────────────────────────────────────────────
truncate public.pms_project_emails;
insert into public.pms_project_emails (record_id, project_id, conversation_id, subject, from_name, from_address, email_date, body_text, preview, has_attachments, msg_id, saved_at, sp_folder_url, saved_to_sharepoint)
select record_id, project_id, conversation_id, subject, from_name, from_address, email_date::timestamptz, body_text, preview, has_attachments, 'm-' || record_id, now(), '', false
from (values
-- a three-reply thread on p1 about the chiller disconnect
('e1', 'p1', 'conv-1', 'Chiller disconnect',     'Bob',  'bob@gc.com',    '2026-10-01 09:00+00', 'Can we move the disconnect to the wall behind the chiller?', 'Can we move', false),
('e2', 'p1', 'conv-1', 'RE: Chiller disconnect', 'Anne', 'anne@setty.com','2026-10-01 11:00+00', E'Within sight of the unit is the rule, so the wall works.\n\nFrom: Bob\nSent: x\nTo: Anne\nSubject: Chiller disconnect\n\nCan we move the disconnect?', 'Within sight', false),
('e3', 'p1', 'conv-1', 'RE: Chiller disconnect', 'Bob',  'bob@gc.com',    '2026-10-02 08:00+00', E'Thanks, we will run the conduit along the wall then and close this out.\n\nFrom: Anne\nSent: x\nTo: Bob\nSubject: RE: Chiller disconnect\n\nWithin sight of the unit is the rule.', 'Thanks', false),
-- an unrelated keyword hit on p1 (mentions "wall" too)
('e4', 'p1', 'conv-2', 'Fire wall penetration',  'Cat',  'cat@arch.com',  '2026-09-20 10:00+00', 'The duct through the rated wall needs a damper; please confirm the rating.', 'The duct', true),
-- two rows with no conversation id and a subject-only thread
('e5', 'p1', null,     'Grease trap sizing',     'Dan',  'dan@gc.com',    '2026-09-10 10:00+00', 'The pit is too small for the scheduled unit.', 'The pit', false),
('e6', 'p1', null,     'RE: Grease trap sizing', 'Anne', 'anne@setty.com','2026-09-11 10:00+00', 'Use the next size down, cut sheet attached.', 'Use the next', true),
-- another project
('e7', 'p2', 'conv-9', 'Chiller disconnect location', 'Eve', 'eve@gc.com', '2026-10-05 10:00+00', 'Where does the chiller disconnect go on this one?', 'Where', false),
-- nothing to embed
('e8', 'p2', null, '', 'Nobody', 'n@x.com', '2026-10-06 10:00+00', '   ', '', false)
) as v(record_id, project_id, conversation_id, subject, from_name, from_address, email_date, body_text, preview, has_attachments);

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
  assert r.embed_text = E'Chiller disconnect\nFrom Anne (setty)\nWithin sight of the unit is the rule, so the wall works.', 'queue carries the full text: ' || r.embed_text;

  -- store: a good row, a row with a stale hash, a row with no embedding key, garbage
  n := public.pms_emails_store_embeddings(jsonb_build_array(
    jsonb_build_object('record_id', 'e1', 'embed_hash', md5(public.pms_emails_embed_text('Chiller disconnect', 'Can we move the disconnect to the wall behind the chiller?', 'Bob', 'bob@gc.com', null)), 'embedding', pg_temp.tv(1, 0)::text),
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

-- ── 2b. stale rows keep their vector while they wait (20261029150000) ────────
do $$
declare r record; n int; ids text[];
begin
  -- a stale row (embedded_at cleared, vector kept) is listed after never-embedded rows
  update public.pms_project_emails set embedded_at = null where record_id = 'e4';
  select array_agg(record_id) into ids from public.pms_emails_to_embed(100);
  assert ids = array['e4'], 'stale row is queued: ' || coalesce(ids::text, 'null');
  insert into public.pms_project_emails (record_id, project_id, conversation_id, subject, from_name, from_address, email_date, body_text, preview, has_attachments, msg_id, saved_at, sp_folder_url, saved_to_sharepoint)
  values ('e20', 'p2', null, 'Pump curve', 'Fay', 'fay@x.com', '2026-01-01 10:00+00', 'Attached is the pump curve.', '', true, 'm-e20', now(), '', false);
  select array_agg(record_id) into ids from public.pms_emails_to_embed(100);
  assert ids = array['e20', 'e4'], 'never-embedded first, then stale, even when older: ' || ids::text;
  select array_agg(record_id) into ids from public.pms_emails_to_embed(1);
  assert ids = array['e20'], 'limit applies to the union: ' || ids::text;

  -- while stale, the row is still found by meaning
  select array_agg(record_id) into ids from public.search_project_emails('zzzz nothing', 'p1', 10, pg_temp.tv(0, 1));
  assert 'e4' = any(ids), 'stale row still searchable: ' || coalesce(ids::text, 'null');

  -- storing it stamps embedded_at and it leaves the queue
  n := public.pms_emails_store_embeddings(jsonb_build_array(
    jsonb_build_object('record_id', 'e4', 'embed_hash', md5(public.pms_emails_embed_text('Fire wall penetration', 'The duct through the rated wall needs a damper; please confirm the rating.', 'Cat', 'cat@arch.com', null)), 'embedding', pg_temp.tv(0, 1)::text)));
  assert n = 1, 'stale row stored';
  select array_agg(record_id) into ids from public.pms_emails_to_embed(100);
  assert ids = array['e20'], 'stored stale row leaves the queue: ' || ids::text;
  delete from public.pms_project_emails where record_id = 'e20';

  -- the one-off: a row with banner words at the top of the body is marked
  -- (vector kept); a row without them is not, whatever its hash; a row
  -- whose cleaned text is empty is marked too but never listed by the queue
  insert into public.pms_project_emails (record_id, project_id, conversation_id, subject, from_name, from_address, email_date, body_text, preview, has_attachments, msg_id, saved_at, sp_folder_url, saved_to_sharepoint, embedding, embedded_hash, embedded_at)
  values ('e21', 'p2', null, '', 'N', 'n@x.com', '2026-01-02 10:00+00', E'External Email: This message originated outside the organization.\n', '', false, 'm-e21', now(), '', false, pg_temp.tv(0.5, 0.5), 'old', now());
  update public.pms_project_emails set body_text = E'[EXTERNAL]\nThe pit is too small for the scheduled unit.' where record_id = 'e5';
  update public.pms_project_emails set embedded_hash = 'old' where record_id = 'e6';   -- no banner words: not marked
  update public.pms_project_emails set body_text = repeat('x ', 300) || 'External Email: in the quoted part only' where record_id = 'e7';
  update public.pms_project_emails
  set embedded_at = null
  where embedding is not null
    and embedded_at is not null
    and left(body_text, 400) ~* '(often get e-?mail from|learn why this is important|external|from outside)';
  select * into strict r from public.pms_project_emails where record_id = 'e5';
  assert r.embedding is not null and r.embedded_at is null, 'banner at the top: vector kept, marked stale';
  select * into strict r from public.pms_project_emails where record_id = 'e6';
  assert r.embedded_at is not null, 'no banner words: not marked';
  select * into strict r from public.pms_project_emails where record_id = 'e7';
  assert r.embedded_at is not null, 'banner words beyond the top 400 characters: not marked';
  select * into strict r from public.pms_project_emails where record_id = 'e21';
  assert r.embedding is not null and r.embedded_at is null, 'banner-only body: marked, vector kept';
  select array_agg(record_id) into ids from public.pms_emails_to_embed(100);
  assert ids = array['e5'], 'queue lists the marked row with text, not the empty one: ' || coalesce(ids::text, 'null');
  delete from public.pms_project_emails where record_id = 'e21';
  update public.pms_project_emails set body_text = 'Where does the chiller disconnect go on this one?' where record_id = 'e7';
  update public.pms_project_emails set embedded_at = now() where embedding is not null;
  update public.pms_project_emails set embedded_hash = 'h' where record_id in ('e5', 'e6');
  raise notice 'stale queue ok';
end $$;

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

-- ── 4b. one exchange filed twice (20261029120000) ───────────────────────────
-- The production cases of 2026-10-29: the same conversation filed from two
-- mailboxes (two conversation ids, one subject), a row filed with no
-- conversation id, a thread whose subject was edited, and the same subject in
-- another project, which must stay separate.
insert into public.pms_project_emails (record_id, project_id, conversation_id, subject, from_name, from_address, email_date, body_text, preview, has_attachments, msg_id, saved_at, sp_folder_url, saved_to_sharepoint, embedding, embedded_hash, embedded_at)
select record_id, project_id, conversation_id, subject, 'N', 'n@x.com', email_date::timestamptz, 'body ' || record_id, '', false, 'm-' || record_id, now(), '', false, pg_temp.tv(0.1, -1), 'h', now()
from (values
  ('e9',  'p3', 'AAQk-MAILBOX1-TAIL', 'Inspection approved at Kissena',        '2026-10-10 10:00+00'),
  ('e10', 'p3', 'AAQk-MAILBOX2-TAIL', 'RE: Inspection approved at Kissena',     '2026-10-09 10:00+00'),
  ('e11', 'p3', null,                 'FW: Inspection approved at Kissena',     '2026-10-08 10:00+00'),
  ('e13', 'p3', 'AAQk-MAILBOX1-TAIL', 'Kissena inspection: revised drawings',   '2026-10-07 10:00+00'),
  ('e12', 'p4', 'AAQk-MAILBOX3-OTHER','Inspection approved at Kissena',        '2026-10-11 10:00+00'),
  ('e14', 'p4', null,                 'Inspection approved at Kissena',         '2026-10-12 10:00+00')
) as v(record_id, project_id, conversation_id, subject, email_date);

do $$
declare r record; n int; rows_ text;
begin
  select count(*) into n from public.search_project_emails('zzzz nothing', null, 10, pg_temp.tv(0.1, -1));
  assert n = 2, 'one row per project exchange, not per message or per conversation id: ' || n;

  select * into strict r from public.search_project_emails('zzzz nothing', null, 10, pg_temp.tv(0.1, -1)) where project_id = 'p3';
  assert r.record_id = 'e9', 'p3 shows its newest message: ' || r.record_id;
  assert r.thread_count = 4, 'p3 counts both mailboxes, the null-id row and the edited-subject message: ' || r.thread_count;
  assert r.search_mode = 'hybrid' and r.similarity > 0.99, 'p3 row shape';

  select * into strict r from public.search_project_emails('zzzz nothing', null, 10, pg_temp.tv(0.1, -1)) where project_id = 'p4';
  assert r.record_id = 'e14' and r.thread_count = 2, 'p4 is separate from p3 and merges its own null-id row: ' || r.record_id || ' ' || r.thread_count;

  -- project filter and limit still apply to the merged rows
  select count(*) into n from public.search_project_emails('zzzz nothing', 'p3', 10, pg_temp.tv(0.1, -1));
  assert n = 1, 'project filter on merged rows';
  select count(*) into n from public.search_project_emails('zzzz nothing', null, 1, pg_temp.tv(0.1, -1));
  assert n = 1, 'limit on merged rows';

  -- keyword mode is untouched by the second pass: every message is its own row
  select count(*) into n from public.search_project_emails('body', 'p3', 10);
  assert n = 4, 'keyword mode still returns messages, not exchanges: ' || n;
  raise notice 'exchange collapse ok';
end $$;

-- ── 4c. snippet, keyword_hit, best_record_id, Newforma prefixes (20261029130000) ──
do $$
declare r record; n int; ids text[];
begin
  -- thread key strips the portal prefixes, repeatedly
  assert public.pms_emails_thread_subject('FW: Submittal Responded to and Closed: RE: Panelboard - Submittal:262416-001-0')
         = 'panelboard - submittal:262416-001-0', 'newforma prefixes';
  assert public.pms_emails_thread_subject('RFI Forwarded: Diffuser vs Light - RFI:381.1') = 'diffuser vs light - rfi:381.1', 'rfi prefix';
  assert public.pms_emails_thread_subject('Action Required: 60736219, Submittal 238219') = '60736219, submittal 238219', 'action required prefix';

  -- keyword mode: every row is its own best match, matched the words, and the snippet marks them
  for r in select * from public.search_project_emails('wall', 'p1', 10) loop
    assert r.keyword_hit and r.best_record_id = r.record_id, 'keyword row flags: ' || r.record_id;
    assert r.snippet like '%[wall]%', 'keyword snippet marks the match: ' || r.snippet;
  end loop;

  -- hybrid, matched the words: snippet from the best message of the exchange, marked
  select * into strict r from public.search_project_emails('wall', 'p1', 10, pg_temp.tv(1, 0)) where record_id = 'e4';
  assert r.keyword_hit and r.best_record_id = 'e4' and r.snippet like '%[wall]%', 'hybrid keyword row: ' || r.snippet;
  select * into strict r from public.search_project_emails('wall', 'p1', 10, pg_temp.tv(1, 0)) where record_id = 'e3';
  assert r.keyword_hit and r.best_record_id in ('e1', 'e2', 'e3'), 'thread best record is a member: ' || r.best_record_id;
  assert length(r.snippet) > 0, 'thread snippet present';

  -- hybrid, meaning only: the newest message is shown, the best-matching one is named and quoted
  select * into strict r from public.search_project_emails('zzzz nothing', 'p1', 10, pg_temp.tv(1, 0));
  assert r.record_id = 'e3' and r.best_record_id = 'e1', 'newest shown, best named: ' || r.record_id || ' ' || r.best_record_id;
  assert not r.keyword_hit, 'meaning-only row has no keyword hit';
  assert r.snippet like 'Can we move the disconnect%', 'meaning-only snippet is the best message''s cleaned text: ' || r.snippet;
  assert r.snippet not like '%Chiller disconnect%' or position('Can we move' in r.snippet) = 1, 'snippet does not start with the subject';

  -- one submittal's notifications collapse to one row
  insert into public.pms_project_emails (record_id, project_id, conversation_id, subject, from_name, from_address, email_date, body_text, preview, has_attachments, msg_id, saved_at, sp_folder_url, saved_to_sharepoint, embedding, embedded_hash, embedded_at)
  values
   ('e15', 'p5', 'c-a', 'Submittal Forwarded: Panelboard - Submittal:262416-001-0', 'N', 'n@x.com', '2026-10-15 10:00+00', 'please review by 10/26', '', false, 'm-e15', now(), '', false, pg_temp.tv(-0.5, -0.5), 'h', now()),
   ('e16', 'p5', 'c-b', 'Submittal Responded to and Closed: Panelboard - Submittal:262416-001-0', 'N', 'n@x.com', '2026-10-29 10:00+00', 'accepted as noted', '', true, 'm-e16', now(), '', false, pg_temp.tv(-0.5, -0.5), 'h', now());
  select count(*) into n from public.search_project_emails('zzzz nothing', 'p5', 10, pg_temp.tv(-0.5, -0.5));
  assert n = 1, 'notification pair is one row: ' || n;
  select * into strict r from public.search_project_emails('zzzz nothing', 'p5', 10, pg_temp.tv(-0.5, -0.5));
  assert r.record_id = 'e16' and r.thread_count = 2, 'pair shows the closed notice with a count of 2';
  raise notice 'snippet and flags ok';
end $$;

-- ── 4d. keyword snippet from the cleaned text (20261029140000) ───────────────
do $$
declare r record;
begin
  -- the words are in the new text: the snippet is cut from the cleaned text, so
  -- the quoted From:/Sent:/To:/Subject: lines below the reply marker never show
  select * into strict r from public.search_project_emails('conduit', 'p1', 10) where record_id = 'e3';
  assert r.snippet like '%[conduit]%', 'cleaned keyword snippet marks the match: ' || r.snippet;
  assert r.snippet not like '%From:%' and r.snippet not like '%Subject:%', 'no header lines in the snippet: ' || r.snippet;

  -- the words are only in the quoted history: the quoted match still shows,
  -- marked, with the header lines around it removed
  select * into strict r from public.search_project_emails('sight', 'p1', 10) where record_id = 'e3';
  assert r.keyword_hit and r.snippet like '%[sight]%', 'quoted-only match is marked: ' || r.snippet;
  assert r.snippet not like '%From:%' and r.snippet not like '%Subject:%', 'headers stripped from the quoted fallback: ' || r.snippet;

  -- the words are only in the subject: the subject is marked and the author's
  -- own text follows it, instead of a fall-through to the quoted history
  select * into strict r from public.search_project_emails('location', 'p2', 10) where record_id = 'e7';
  assert r.snippet like 'Chiller disconnect [location] Where does the chiller%', 'subject-only match shows the new text: ' || r.snippet;

  -- banners above the quoted history go with the headers (20261029150000)
  insert into public.pms_project_emails (record_id, project_id, conversation_id, subject, from_name, from_address, email_date, body_text, preview, has_attachments, msg_id, saved_at, sp_folder_url, saved_to_sharepoint)
  values ('e99', 'p9', 'c9', 'RE: Health Dept Chiller Lead Times', 'A', 'a@x.com', '2026-10-20 10:00+00',
    E'Gerry,\r\n\r\nWe got a 14 week lead time from Trane; let me know if that works.\r\n\r\nAndrew\r\n\r\nFrom: Martin, Gerry <g@cville.gov>\r\nSent: Monday\r\nTo: Andrew Davidson <a@x.com>\r\nSubject: Fw: Health Dept Chiller Lead Times\r\n\r\n** WARNING: This email has originated from outside of the organization. Do not click links.\r\n\r\nExternal Email: This message originated outside the organization. Use caution.\r\n\r\n> Can you check the chiller lead times with the vendor? See https://example.com/x\r\n',
    '', false, 'm-e99', now(), '', false);
  select * into strict r from public.search_project_emails('vendor', 'p9', 10);
  assert r.snippet like '%[vendor]%', 'quoted match marked: ' || r.snippet;
  assert r.snippet not like '%WARNING%' and r.snippet not like '%External Email%' and r.snippet not like '%Subject:%' and r.snippet not like '%http%', 'banners, headers and urls stripped: ' || r.snippet;
  select * into strict r from public.search_project_emails('chiller', 'p9', 10);
  assert r.snippet like 'Health Dept [Chiller] Lead Times Gerry, We got a 14 week%', 'subject match shows the new text: ' || r.snippet;

  -- same rule in hybrid mode, and the snippet is one line
  select * into strict r from public.search_project_emails('conduit', 'p1', 10, pg_temp.tv(1, 0)) where record_id = 'e3';
  assert r.keyword_hit and r.best_record_id = 'e3', 'hybrid: e3 is the best message of its exchange';
  assert r.snippet like '%[conduit]%' and r.snippet not like '%From:%', 'hybrid cleaned snippet: ' || r.snippet;
  assert r.snippet !~ E'\n', 'snippet has no newlines';
  raise notice 'cleaned snippet ok';
end $$;

-- ── 5. re-apply the migrations (idempotent: columns, index, rename guard, function) ──
\i supabase/migrations/20261020120000_emails_embeddings.sql
\i supabase/migrations/20261029120000_emails_thread_collapse_by_subject.sql
\i supabase/migrations/20261029130000_emails_search_snippet.sql
\i supabase/migrations/20261029140000_emails_search_snippet_cleaned.sql
\i supabase/migrations/20261029150000_emails_embed_text_banners.sql
\i supabase/migrations/20261030100000_emails_embed_text_sender_attachments.sql
do $$
declare r record;
begin
  select count(*) into r from public.search_project_emails('wall', 'p1', 10, pg_temp.tv(1, 0));
  assert r.count = 2, 're-apply keeps data and behaviour';
  select count(*) into r from pg_proc where proname in ('search_project_emails', 'pms_emails_search_lexical') and pronamespace = 'public'::regnamespace;
  assert r.count = 2, 'exactly one of each function';
  -- the one-offs ran again: 20261030100000 marks every embedded row stale,
  -- vector kept, and the queue lists them with the 5-argument text
  select count(*) filter (where embedded_at is null) as stale, count(*) as embedded into r from public.pms_project_emails where embedding is not null;
  assert r.stale = r.embedded and r.embedded > 0, 're-applied one-off marks every embedded row: ' || r.stale || '/' || r.embedded;
  select embed_text into strict r from public.pms_emails_to_embed(100) where record_id = 'e4';
  assert r.embed_text like E'Fire wall penetration\nFrom Cat (arch)\n%', 'stale rows are queued with the full text: ' || r.embed_text;
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
