# Handoff: finishing the email embeddings migration (PR #372)

Written 2026-10-20 for a session that HAS Supabase access to the PMS project
(`khxmgjilwhdguuepbhne`). The session that wrote PR #372 did not.

## The short version: one query, then hand it back

Everything else is done or can be done by the session without access. The
only thing this session needs to do is run the query in step A (one
`execute_sql` call, read-only) and give the full output back, either pasted
into the original chat session or posted as a comment on PR #372 (that
session is subscribed to the PR and wakes on the comment). Steps B and C
below are what happens next; they are here for completeness and do NOT need
to be done by this session.

Also done without access, waiting only on the query: the connector half
(embed route, flagged query embedding) is on PR #373.

## Where things stand

The database half of meaning-based email search is written and tested on
draft PR #372 (branch `claude/emails-embeddings-migration`). Files:

| File | What it is |
| --- | --- |
| `supabase/migrations/20261020120000_emails_embeddings.sql` | Embedding columns and a queue index on `pms_project_emails`; the cleaning rule `pms_emails_embed_text`; job helpers `pms_emails_to_embed` and `pms_emails_store_embeddings`; a new `search_project_emails(q, proj, lim, p_embedding, p_min_similarity)` that fuses keyword and vector lists and collapses to one row per thread |
| `supabase/emails-local-standin.sql`, `supabase/emails-local-test.sql` | Throwaway-Postgres behaviour test. ALL TESTS PASSED on Postgres 16 with pgvector 0.8 in all three application orders |
| `supabase/emails-verify.sql` | Production checks; section 0 is the capture query |
| `supabase/functions/pms-mcp/README.md` | Section "Email embeddings" |

The blocker: the live keyword function `search_project_emails` was created in
the SQL editor and its text is not in the repository. The migration does not
rewrite it. It renames the live function to `pms_emails_search_lexical`,
untouched, and the new function wraps it, so with no embedding the results
are exactly today's. Three unchecked assumptions about the live function:

1. It takes `(q text, proj text, lim integer)`, in that order, with those
   names (the connector calls it by name: `{q, proj, lim}`).
2. Its result has a `record_id` column and a numeric `rank` column.
3. It returns rows best first.

The new function also declares the table's column types as `email_date
timestamptz`, `direction text`, `to_addresses text`, `has_attachments
boolean`, `preview text`, `conversation_id text`.

Do not apply the migration in production until step A has confirmed this.

## Step A: run the capture query

Read-only; also section 0 of `supabase/emails-verify.sql`.

```sql
select 'func' as kind, pg_get_functiondef(p.oid) as detail
from pg_proc p
where p.proname in ('search_project_emails', 'pms_emails_search_lexical')
  and p.pronamespace = 'public'::regnamespace
union all
select 'col', column_name || ' ' || data_type || ' nullable=' || is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'pms_project_emails'
union all
select 'idx', indexdef from pg_indexes
where schemaname = 'public' and tablename = 'pms_project_emails'
order by 1, 2;
```

| Check | Where to look | If it disagrees |
| --- | --- | --- |
| Exactly one `func` row, named `search_project_emails` | first lines | More than one: the migration refuses to apply by design. Rename the keyword one to `pms_emails_search_lexical` by hand, then apply. |
| Arguments are `(q text, proj text, lim integer)` | the `create or replace function` line | Different types (e.g. `proj uuid`): change the `proj text` parameter of the NEW function and the `proj` comparison in its `sem` CTE. Different names: the connector breaks, so keep `q`, `proj`, `lim` on the wrapper and pass positionally. |
| Result has `record_id` and a numeric `rank` | the `returns` clause | No `rank`: in the `lex` CTE replace `l.rank::real` with `(1.0 / l.ordinality)::real`. |
| Rows come back best first | an `order by ... desc` at the end | Not ordered: add the order in the capture migration body (a behaviour change; say so on the PR). |
| Column types | the `col` rows | Fix the `returns table (...)` of the new function and the stand-in table, re-run the local test. |
| Indexes | the `idx` rows | Nothing to change; a GIN index on a tsvector column says how the keyword search is fast. |

Also run the per-status filing summary from `PROPOSAL-emails-embeddings.md`
(section "Pre-check"); nobody has yet:

```sql
select p.project->>'status' as status,
       count(*) as projects,
       count(*) filter (where e.n > 0) as with_filed_mail,
       coalesce(sum(e.n), 0) as filed_emails
from public.pms_projects p
left join (select project_id, count(*) as n
           from public.pms_project_emails group by project_id) e
  on e.project_id = p.id
group by 1 order by 4 desc;
```

## Step B: write the capture migration

On the same branch add
`supabase/migrations/20261020110000_search_project_emails_capture.sql`. Take
the `func` row from step A verbatim and change exactly one thing: the name.

```sql
-- Step 0 of PROPOSAL-emails-embeddings.md: the keyword email search as it
-- ran in production on <date>, captured with pg_get_functiondef so the
-- repository holds it. Only the name differs: migration 20261020120000
-- renames the live search_project_emails to pms_emails_search_lexical and
-- wraps it, so this file is a no-op after that migration and creates the
-- function before it. Nothing about the ranking is changed here.

create or replace function public.pms_emails_search_lexical(q text, proj text, lim integer)
-- ... the rest of the pg_get_functiondef output, unchanged ...
```

- Keep `create or replace`, the parameter names and types, the `returns`
  clause, the language, `security definer` and `set search_path` if present.
- No grants here; the main migration revokes the renamed function from
  `anon`, `authenticated`, `public` and grants `service_role` by name.
- If step A showed no `rank` or no ordering, edit the main migration first
  (table above) and say so in the PR description.
- `20261020110000` sorts before `20261020120000`, so a fresh database applies
  capture first. Production can apply them in either order; both are tested.

Then the local test (throwaway Postgres 16 with pgvector, from the repo root):

```
psql -v ON_ERROR_STOP=1 -f supabase/emails-local-standin.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261020100000_baseline_pms_project_emails.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261020110000_search_project_emails_capture.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261020120000_emails_embeddings.sql
psql -f supabase/emails-local-test.sql      # must end with ALL TESTS PASSED
```

If the captured function references a column the baseline table lacks (a
`search_vector` tsvector column is likely), add it to the table in
`supabase/migrations/20261020100000_baseline_pms_project_emails.sql` with the
type step A printed (that file only runs where the table is missing, so
production is untouched). Correct the baseline's other column types from the
`col` rows at the same time. Commit and push to the same branch.

## Step C: apply in production and verify

Migrations are applied by hand; a merge alone changes nothing. Apply capture
first, then the main migration (SQL editor or `apply_migration`); both are
safe to re-run. Then `supabase/emails-verify.sql`:

1. Section 1 lists the functions: exactly one `search_project_emails` (five
   arguments) and one `pms_emails_search_lexical` (three).
2. Section 2 runs the same keyword query through both; the lists must be
   identical, row for row, same order.
3. In a chat with the PMS connector, search emails for any topic. It must
   still answer. "Could not choose the best candidate function" means two
   functions of the name survived; section 1 shows which, drop the
   three-argument one.

Then mark PR #372 ready and merge it (merge commit, no squash). The embedding
columns stay empty until the connector route exists.

## After that, and loose ends

1. Connector PR (step 2): `POST /pms-mcp/admin/emails-embed` reusing
   `runEmbedPass` with the two email RPCs; `search_emails` embeds a prose
   query only when the secret `EMAILS_SEMANTIC=1` is set, passes it as
   `p_embedding`, reports `searchMode` and `threadCount`. OFF by default.
   Deploy with the "Deploy pms-mcp" workflow on `main`.
2. Schedule the backfill once deployed:

   ```sql
   select cron.schedule('pms-emails-embed', '* * * * *',
     replace((select command from cron.job where jobname = 'pms-documents-sync'),
             'admin/documents-sync', 'admin/emails-embed'));
   ```

   About three days at 5 rows a minute; a second `30 seconds` entry halves it.
3. Latency check (verify section 5); HNSW index only past ~300 ms.
4. The ten-question experiment, same shape as `EXPERIMENT-ca-items-semantic.md`,
   at least three questions from design-phase projects and three from CA.
   Pass: Gained >= 3 AND Lost = 0, no thread twice in any hybrid top five.

Loose ends:

- PR #371 (the proposal) still showed as an open draft at 15:10 UTC on
  2026-10-20; mark ready and merge. Nothing on #372 depends on it.
- The per-status filing summary has not been run.
- `SUPABASE_ACCESS_TOKEN` in the repo environment is expired; that is why
  the writing session had no database access.
- `thread_count` counts matched messages collapsed into the row, not the
  whole thread, on purpose.
- Cleaning changes to `pms_emails_embed_text` do not re-queue rows by
  themselves; the one-off re-queue statement is at the bottom of the migration.
- The CA fallback-flag removal task still fires 2026-10-24 13:00 UTC in a
  fresh session; unrelated to email.
