# Proposal: embed more of each email, measured first

Status: PROPOSED (2026-10-29). Nothing built. Written the day meaning-based
email search was switched on (PR #380) with the limits recorded in
`EXPERIMENT-emails-semantic.md`: hybrid found 5 of 10 threads, and the five
misses point at what gets embedded, not at the ranking.

## The ask, in one paragraph

Today each filed email is embedded once, from the subject plus the NEW text of
the message, cut at 1,500 characters, with the quoted history below the reply
dropped on purpose. Two things that rule throws away turned out to matter in
the experiment: the end of a long message (the one measured miss) and the
quoted history under a short reply (the four likely misses). This proposal
measures how often each happens across the whole log before building
anything, then fixes them in two steps of very different size: raise the cap
(a one-line change and a partial re-embed), and, only if the measurement says
it is worth it, embed the quoted history as extra chunks (a new table, a
changed search, a longer backfill). Each step gets its own ten-thread test.

## What the experiment showed

| Row | Question | Why it missed (from reading the expected message) |
|---|---|---|
| 7 | large breakers adjustable trip so downstream trips first | MEASURED: the sentence about electronic trip units begins at about character 1,415 of the 1,500 embedded (subject 119 + body 1,295 before it). The part that carries the meaning is cut off. |
| 1 | evacuation simulation passes with no reaction time | LIKELY: the newest text of the message read is a two-line meeting request; the egress findings sit in the quoted history, which is dropped. |
| 3 | how we sized cooling for a packed gym | LIKELY: newest text is a note about attached spreadsheets; the gym assumptions are in an earlier quoted message. |
| 4 | client wants zero billed for construction phase | LIKELY: newest text is a one-line reminder; the "correct this down to 0%" request is quoted from December. |
| 10 | about forty submittal reviews owed on science lab | LIKELY: the "~40 submittals" sentence is in the quoted message below the reply. |

"Likely" means: the content was seen in the quoted part of the message read,
and no check was made of whether another filed message of the same thread
carries it as new text. That check is the first step below; if a sibling
message does carry it and still was not found, the cause is ranking, and
embedding more text will not help that row.

## What exists today

- `pms_emails_embed_text(subject, body_text)` (migration `20261020120000`):
  subject minus RE:/FW:, then the body cut at the first reply marker when the
  text above the marker is 40+ characters, footers and URLs removed, the
  result cut at 1,500 characters. One vector per email in
  `pms_project_emails.embedding`.
- The embed job (`admin/emails-embed`, once a minute) takes rows whose
  `embedding` is null; it does not re-hash existing rows. A change to the
  cleaning rule therefore needs the one-off re-queue statement at the bottom
  of that migration, which nulls `embedding` where the stored hash no longer
  matches, and the job then re-embeds those rows at the measured pace of
  about 5 a minute.
- The search (`20261029120000`) fuses keyword and vector lists and collapses
  to one row per exchange. It reads one vector per row; nothing in it knows
  about chunks.
- The model, `gte-small`, reads about 512 tokens. For English prose that is
  roughly 2,000 characters; text past that is ignored by the model whether or
  not the SQL cuts it.

## Step 0. Measure (no code, one SQL session)

Three questions, each one query in `supabase/emails-embed-text-measure.sql`
(to be written with the PR that takes this proposal on; the shape is given
here so it can be run by hand first).

1. **How many emails are cut by the cap?** Count rows where the cleaned text
   before the cap is longer than 1,500 characters, and the distribution of
   those lengths (how many between 1,500 and 2,000, how many above). This
   says what raising the cap to 2,000 buys and how many rows it re-embeds.

   ```sql
   with t as (
     select length(public.pms_emails_embed_text_uncapped(subject, body_text)) as n
     from public.pms_project_emails
   )
   select count(*) filter (where n > 1500) as cut_today,
          count(*) filter (where n > 1500 and n <= 2000) as fixed_by_2000,
          count(*) filter (where n > 2000) as still_cut_at_2000,
          count(*) as emails
   from t;
   ```

   (`pms_emails_embed_text_uncapped` is the same function without the final
   `left(..., 1500)`; the measuring PR adds it, or the query inlines the body.)

2. **How much quoted history is dropped, and is it anywhere else?** For each
   email, the length of the body against the length of the cleaned new text
   gives the dropped share. The firm-wide number says how much text the
   search cannot see at all today. The per-thread version matters more: for
   the five missed threads, list every filed message of the exchange with
   the length of its new text and whether the key phrase of the question
   ("selective coordination", "pre-movement", "bleacher", "0%", "40
   submittals") appears in its NEW text or only in its quoted text.

   ```sql
   select e.record_id, e.email_date, length(e.body_text) as body_chars,
          length(public.pms_emails_embed_text(e.subject, e.body_text)) as embedded_chars,
          position('pre-movement' in public.pms_emails_embed_text(e.subject, e.body_text)) > 0 as in_new_text,
          position('pre-movement' in e.body_text) > 0 as in_body
   from public.pms_project_emails e
   where e.project_id = 'vm913xb3'
     and public.pms_emails_thread_subject(e.subject) = public.pms_emails_thread_subject('Status of the egress modelling v the current required egress times.')
   order by e.email_date;
   ```

   One such query per missed row, phrase and project changed. If `in_new_text`
   is true for some message of the thread and the thread still missed, that
   row is a ranking miss and step 2 will not fix it.

3. **What would chunking cost?** Count, per email, how many 1,500-character
   windows the full cleaned text (new text AND quoted history, footers and
   URLs removed) would need, capped at 4, and sum it. At 5 embeddings a
   minute that sum is the backfill in minutes.

Decision rule for the steps below, written now: step 1 goes ahead if query 1
shows the cap cuts more than about 1 email in 20. Step 2 goes ahead only if
query 2 shows at least three of the four "likely" misses are quoted-only in
every filed message of their thread, AND query 3's backfill is under about
two weeks of one-minute calls.

## Step 1. Raise the cap to 2,000 (small)

- One migration: `pms_emails_embed_text` cuts at 2,000 instead of 1,500, with
  the comment updated to say why (the model's real limit, and the measured
  miss). Then the re-queue statement, limited to rows the change affects:

  ```sql
  update public.pms_project_emails
  set embedding = null
  where embedded_hash is distinct from md5(public.pms_emails_embed_text(subject, body_text));
  ```

  Only rows whose cleaned text is longer than 1,500 characters get a new
  hash, so only those are re-embedded. Query 1 says how many; at 5 a minute,
  2,000 rows is about seven hours.
- Nothing else changes: same table, same search, same job. While the
  affected rows are re-embedding they are absent from the vector list (their
  `embedding` is null), so for those hours a search can miss a long email it
  found yesterday. Say so in the PR; it is a one-time cost.
- Test: the local test gets a case with a 1,800-character body whose last
  sentence must survive. Then a new ten-thread experiment, same rules as
  `EXPERIMENT-emails-semantic.md`, with threads NOT used before. Pass rule
  for a change that only adds text: Lost = 0 against the current build, and
  Gained >= 1. (The bar is low because the change is small and reversible;
  the point of the test is to catch a regression.)

## Step 2. Embed the quoted history as chunks (larger)

Only after step 0's rule says yes.

- **Storage**: a new table `pms_email_chunks(record_id, chunk_ix, text_hash,
  embedding vector(384), embedded_at)`, one row per 1,500-character window of
  the FULL cleaned text of a message (new text first, then the quoted
  history, with footers, URLs, quote prefixes and header blocks removed), at
  most four chunks per email so a 40-reply thread does not cost 40 vectors.
  `pms_project_emails.embedding` stays as it is for the new text; chunk 0
  would duplicate it, so chunks start at the first window AFTER the new text.
- **Cleaning**: `pms_emails_chunk_texts(subject, body_text)` returns the
  windows. The quoted history keeps its "From:/Sent:" header lines removed
  but its message boundaries respected: a window should not start in the
  middle of a quoted message when it can start at its top. The subject is
  prepended to every window so a chunk still knows which thread it belongs
  to.
- **Job**: the same `runEmbedPass` loop with chunk-shaped `storeRow` and
  `label`, a queue function `pms_emails_chunks_to_embed`, and a store
  `pms_emails_store_chunk_embeddings`. A separate route
  (`admin/emails-embed-chunks`) and cron entry, so the per-message job is
  untouched and the chunk backfill can be paused on its own.
- **Search**: in `search_project_emails`, the semantic list takes the best of
  (the message's own vector, the max over its chunks). In SQL: a union of the
  two sources, `max(similarity)` per `record_id`, then the existing fusion and
  collapse. A chunk that quotes a message filed elsewhere in the thread makes
  that message's exchange score once more, which the collapse absorbs.
- **Cost**: query 3 gives it. Rough shape: if the average email needs one
  extra chunk, that is about 22,000 embeddings, three days at 5 a minute, or
  a day and a half with a 30-second schedule; storage about 35 MB per 22,000
  chunks.
- **Test**: the local test gets a thread where the content exists ONLY in the
  quoted part of a short reply and must be found; and a ten-thread experiment
  on new threads with the same rule as step 1.

## Risks and what limits them

- **Quoted history is other people's words, repeated.** Embedding it means a
  search can return a reply because of what it quotes, not what it says. The
  result row is still the newest matching message of the exchange, so the
  reader lands in the right thread; and the alternative, today, is not
  finding the thread at all.
- **A re-embed leaves a gap.** Step 1 nulls the affected vectors before the
  job refills them. Run it in the evening; or, if the count is large, change
  the queue to prefer rows with `embedded_hash` set (a re-embed) over rows
  never embedded, so recent mail is not starved. Decide from query 1.
- **The model's limit is tokens, not characters.** 2,000 characters of
  prose fits; 2,000 characters of a parts list with many numbers may not.
  The cap is a ceiling the model enforces anyway; raising it past 2,000
  buys nothing.
- **Chunking changes the search function's shape.** Step 2 is the first time
  the function reads two tables for the vector side. The local test must
  cover a message with chunks and none, and both must still collapse.
- **Measurement before building.** Both steps are gated by step 0, written
  down above before anything was run.

## Sequence and cost

| Step | Depends on | Effort | Ships as |
| --- | --- | --- | --- |
| 0. Measure | nothing | one hour, SQL editor | numbers pasted into this file |
| 1. Cap to 2,000 + partial re-embed | step 0 says yes | half a day + the re-embed hours | one migration PR, applied by hand, then a ten-thread test PR |
| 2. Chunks for quoted history | step 0 says yes, step 1 done | two days + the backfill | migration PR, connector PR with a route and a cron line, test PR |

If step 0 says the cap cuts few emails and the quoted history is not where
the misses live, this proposal ends there with the numbers recorded, and the
next place to look is ranking, not text.
