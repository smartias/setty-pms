# Proposal: semantic search on CA items, as a bounded experiment

Status: EXPERIMENT PASSED ON HIT COUNTS (2026-10-20, 9 of 10 hybrid vs 2 of 10 keyword, nothing lost); SEMANTIC RANKING ON BY DEFAULT. Migration applied (#362), connector deployed (#363, #366, #367). 2026-10-17: the
embed pass moved out of `documents-sync` into its own one-minute route
(`admin/ca-items-embed`) after the first version was killed by the edge
runtime's 2 s CPU cap before storing a row; the sizing below (200 rows per
15-minute run) is superseded by the README. Migration: `supabase/migrations/20261017150000_ca_items_embeddings.sql`
(extension, columns, `pms_ca_items_embed_text`, the two job helpers, hybrid
`search_ca_items`), tested locally with pgvector built from source. Nothing
reads the new columns until the connector PR. Connector: `caItems.ts` (embedding
helpers, hybrid args), `index.ts` (embed pass in documents-sync, query embedding,
`CA_ITEMS_SEMANTIC` default off, `semantic` tool argument). Next: the ten
questions. The experiment below decides
whether embeddings earn a place; if they do not, the column and the RPC
parameter come out again in one PR. Follows PROPOSAL-ca-items-table.md
(steps 1 and 2 live since 2026-10-17; step 3, removing the fallback, is
scheduled for 2026-10-24).

## What we know now that we did not know when the note deferred this

- The corpus is 2,879 RFIs and submittals firm-wide (the live total on
  2026-10-17). That is small: embedding all of it is a few minutes of compute,
  and a vector search over it needs no index.
- Full-text search with stemming is live. "dampers" finds "damper", item
  numbers and spec sections match exactly, and a discipline or status word
  still matches. The exact-and-near-exact questions are covered.
- What is NOT covered is paraphrase across projects: "has a contractor ever
  argued a damper rating with us", "substitution for the scheduled VAV
  manufacturer", "temporary cooling during construction". The words an
  engineer uses are not the words in the record. That is the only thing
  embeddings add, and it is the only thing the experiment measures.

## Three decisions, made so the experiment is cheap to run and cheap to undo

### 1. Model: the edge runtime's built-in `gte-small`, not a vendor

Supabase Edge Runtime (v1.36.0 and later) runs the `gte-small` embedding model
natively: `new Supabase.ai.Session("gte-small")`, 384 dimensions, normalized
output, so cosine similarity is the right measure. Three reasons it is the
right choice for an experiment:

- No new vendor, no new key, no new secret in the environment.
- CA text never leaves Supabase. RFIs and submittal comments are contractor
  correspondence; sending them to a third-party embedding API is a data
  decision Sara should make deliberately, not a side effect of a search
  experiment.
- It is free, and the connector already runs in that runtime
  (`index.ts` imports the edge-runtime types).

Its limits, stated up front: it is a small English model, so quality is a
floor not a ceiling, and it reads about 512 tokens, so the text embedded per
item is `subject` plus the first ~1,500 characters of `body_text`. Long
responses are truncated for the experiment; chunking is out of scope. If the
experiment passes but quality looks thin, the upgrade path is a vendor model
(Voyage or OpenAI, 1,024 to 1,536 dimensions) in a new column, which is a
migration plus that data decision.

### 2. Storage and freshness: a column on `pms_ca_items`, filled by the existing sync run

```sql
create extension if not exists vector with schema extensions;
alter table public.pms_ca_items
  add column embedding     extensions.vector(384),
  add column embedded_at   timestamptz,
  add column embedded_hash text;            -- md5 of the text that was embedded
```

- The `documents-sync` run (the 15-minute cron that already calls
  `pms_ca_items_reconcile()`) gains one more step: select up to 200 rows where
  `embedding is null or embedded_at < projected_at`, embed each in the edge
  function, and write `embedding`, `embedded_at`, `embedded_hash` back. The
  hash guard skips rows whose embedded text did not change, so a reconcile
  that rewrote `projected_at` costs nothing.
- Backfill: 2,879 rows at 200 per run is about 15 runs, under four hours on
  the cron; or one admin call with `{"caItemsEmbed": {"max": 3000}}` to do it
  at once. Model load on a cold isolate is one to two seconds, then
  milliseconds per item.
- No vector index at this size. A sequential scan over 2,879 vectors of 384
  dimensions is milliseconds. Add `hnsw (embedding vector_cosine_ops)` only
  past roughly 50,000 rows, which the CA log will not reach for years.
- A row with no embedding yet is still found by full text. The fusion below
  treats a missing semantic rank as zero, so nothing disappears during
  backfill.

### 3. Search: hybrid by reciprocal rank fusion, in text mode only

The number, spec-section and list shapes are untouched; they are exact by
nature. In text mode, `search_ca_items` gains `p_embedding
extensions.vector(384) default null`. When it is null the function behaves
exactly as today. When present:

```sql
-- sketch; filters (row ids, type, status, discipline, open) apply inside BOTH branches
with fts as (
  select item_key, row_number() over (order by rank desc, date_received desc nulls last) as rank_ix
  from <today's text and field hits>                        -- the existing predicate
  limit least(p_limit, 30) * 2
),
semantic as (
  select item_key, row_number() over (order by embedding <=> p_embedding) as rank_ix
  from pms_ca_items c
  where c.project_row_id = any (p_row_ids) and <the same filters>
    and c.embedding is not null
    and 1 - (c.embedding <=> p_embedding) >= p_min_similarity   -- floor, tuned in the experiment
  limit least(p_limit, 30) * 2
)
select ..., coalesce(1.0 / (50 + fts.rank_ix), 0) * 1.0
          + coalesce(1.0 / (50 + semantic.rank_ix), 0) * 1.0 as rank
from fts full outer join semantic using (item_key)
join pms_ca_items c on ...
order by rank desc
limit p_limit
```

- Snippet: `ts_headline` when the row was a full-text hit, otherwise the first
  200 characters of `body_text`.
- The similarity floor starts at 0.75 and is the one knob the experiment
  tunes. Without it, every query returns the limit's worth of vaguely
  related items, which reads as noise.
- The connector embeds the query with the same model in the edge function,
  one session per isolate, and passes `p_embedding`. `caItems.ts`'s classifier
  is unchanged. The answer says `searchMode: "hybrid"`.
- Latency: the query embedding is tens of milliseconds on a warm isolate; the
  first call after a cold start pays the model load once. The
  `pms-mcp-keepwarm` ping keeps that rare.
- Flag: `CA_ITEMS_SEMANTIC`, default OFF, plus an optional `semantic: true`
  argument on `search_rfis_submittals` for the experiment, so both modes can
  be run side by side on the same question without a redeploy. The argument
  is removed when the experiment ends, whichever way it goes.

## The experiment

Written down before anything is built, so the result cannot be argued with
afterwards.

1. **Ten questions**, written by engineers in their own words, each with the
   item or items they would expect to find, chosen before anyone runs a
   search. Candidates, to be replaced by real ones: a contractor pushing back
   on a fire smoke damper rating; a manufacturer substitution on scheduled
   equipment; a grease interceptor venting question; temporary cooling during
   construction; a failed hydrostatic test; controls integrated with a BMS
   versus stand-alone; sleeve locations clashing with structure; exterior
   lighting photometrics; lightning protection; water hammer.
2. **Run each twice** through the connector, text mode and hybrid mode, limit
   5, firm-wide.
3. **Score**: is the expected item in the top five? Count, per mode. Also
   record any semantic-only hit the engineer judges useful (recall gained) and
   any top-five item they judge irrelevant (precision lost).
4. **Pass**: hybrid finds at least three expected items that text mode missed,
   and loses none that text mode found. **Fail**: anything else. A fail means
   one PR that drops the column, the parameter, the sync step and the flag.

Cost of the experiment: an afternoon of an engineer's time to write and judge
the ten questions, and the three PRs below.

## Risks, honestly

- **Staleness** is bounded by the cron: an edited response is re-embedded
  within 15 minutes. Full text is current immediately, so a stale embedding
  only affects the semantic branch.
- **Model drift**: if Supabase updates `gte-small`, old and new vectors do not
  compare. Pin by name, and if the model ever changes, null the column and let
  the sync re-embed everything (a few hours).
- **Truncation** at ~512 tokens: the long NOTATIONS boilerplate on many
  submittals is exactly what gets embedded first, and it is near-identical
  across items. Mitigation for the experiment: strip the known boilerplate
  prefix ("NOTATIONS: 1. Comments, corrections, approvals...") before
  embedding, the same way `pms_strip_html` already normalises. If boilerplate
  dominates the results, that is a finding, not a failure of the idea.
- **Privacy**: none for `gte-small`. Revisit if a vendor model is chosen.
- **Operational**: one more step in the sync run, with the same posture as the
  reconcile step: it logs and continues, never fails the run.

## Rollout, same conventions as before

1. **Migration PR**: the extension, the three columns, and the RPC with
   `p_embedding` and `p_min_similarity` (DROP + CREATE, return type unchanged
   this time). pgvector is NOT installed in the Postgres 16 used by `ca-items-local-test.sql` (no `vector.control`), so the RPC is tested on a Supabase preview branch instead, and the local test keeps covering the non-vector shapes.
2. **Connector PR**: the embed step in `documents-sync`, the query embedding,
   the flag (default off) and the experiment argument. BUILD bump, deploy via
   the workflow.
3. **Experiment and decision**: the ten questions, the scores, and one of two
   PRs: flip the default on and remove the argument, or revert.

Migrations are applied by hand in the SQL editor, as before. The backfill
runs itself once the connector is deployed.

## Out of scope

- Emails. `pms_project_emails` has full-text search and an unknown row count;
  the same column-plus-sync pattern applies later if the CA experiment passes
  and the email coverage problem (only add-in-filed mail reaches the log) is
  worth solving first.
- Chunking long bodies into several vectors per item.
- Re-ranking the top 20 with Claude. The connector already calls the Claude
  API for meeting extraction, so this is cheaper to try than it sounds, but it
  adds a model call per search and belongs after a positive embedding result,
  not alongside it.
