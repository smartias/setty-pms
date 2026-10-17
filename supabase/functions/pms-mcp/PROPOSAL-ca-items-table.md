# Proposal: a real table for RFIs and submittals (`pms_ca_items`)

Status: DRAFT (2026-10-17). Step 1 of the "semantic layer" discussion:
give Construction Administration items an indexed, queryable home before
any embedding or ontology work. One slice per branch per PR, same working
rules as ROADMAP.md.

## Why

RFIs and submittals live inside `pms_projects.project` as two jsonb arrays
(`rfis`, `submittals`). That is fine for the PMS modal, which edits one
project at a time, and wrong for everything that searches across them:

- `search_rfis_submittals` loads EVERY visible project blob into the edge
  function and does a lower-cased `String.includes` over a concatenated
  field string. No ranking, no stemming ("dampers" misses "damper"), no
  index, and cost grows with the portfolio on every firm-wide call.
- Nothing in SQL can join an RFI to anything. `pms_ca_review_feedback`,
  `pms_qa_findings` (source 'rfi' / 'submittal') and `pms_documents`
  (`record_kind` + `record_number`) all carry `(project, type, number)` as
  loose text with no row to point at.
- `trace_references` derives sheet links from item text on every call
  because there is nowhere to store them (deliberately: Stage 0 of the
  linking plan measures precision before anything is materialized). The
  table below is where Stage 1 would land them.
- Hybrid search later (full-text + pgvector) needs a row per item with a
  plain-text body. Today the body is HTML inside a blob.

Emails are NOT in scope: `pms_project_emails` already has ranked
full-text search through the `search_project_emails` function and its
limit is coverage (only add-in-filed mail), which no table fixes.

## The decision that matters: projection, not migration

The blob stays the source of truth. `pms_ca_items` is a PROJECTION kept
current by a trigger on `pms_projects`, the same way the broadcast trigger
already hangs off that table.

Why not move the arrays out of the blob:

- The PMS client saves the whole project with optimistic concurrency
  (`version=eq.N` PATCH, `saveStateV2`), and the connector writes through
  `updateProjectRecord` the same way. `save_ca_review`, `backload_ca_item`,
  the modal, links, `aiReview`, `pms_projects_history` and the Realtime
  broadcast all assume the item is in the blob. Moving it is a multi-week
  change to `SettyPMS.html` with a cache-version bump and a data migration
  that cannot be rolled back cleanly.
- A projection is one migration, zero client changes, and reversible by
  dropping the table. If the shape proves out, flipping the source of
  truth is a later, separate decision with the table already populated.

Cost of the projection: the trigger re-projects a project's CA arrays on
every save of that project. The arrays are tens to low hundreds of items;
the upsert is skipped when nothing changed (`is distinct from` guard), so
a save that touched a milestone does not rewrite CA rows.

## Schema

```sql
create table if not exists public.pms_ca_items (
  project_row_id   text not null references public.pms_projects(id) on delete cascade,
  item_type        text not null check (item_type in ('rfi','submittal')),
  item_id          text not null,            -- item.id (uid / backload-…); number can be renumbered, id cannot
  project_number   text,                      -- project->>'projectNumber' as typed (matches pms_lessons.project_id, pms_ca_review_feedback.project)
  project_prefix   text,                      -- lower(project_number): joins pms_documents.project_prefix / pms_drawing_text
  number           text,                      -- 'RFI-012', 'SUB-004'
  subject          text,                      -- rfi.title | submittal.description (what the modal shows as the row title)
  description      text,                      -- rfi.description (the question); null for submittals
  response         text,                      -- rfi.response | submittal.comments, HTML stripped (see body_text)
  stamp            text,                      -- submittal only
  status           text,
  is_open          boolean not null default false,  -- RFI_OPEN / SUBMITTAL_OPEN sets, evaluated in the trigger
  discipline       text,
  spec_section     text,
  from_party       text,                      -- item.from
  assigned_to      text[],
  sub_assigned     text,
  date_received    date,
  due_date         date,
  date_closed      date,                      -- rfi.dateResponded | submittal.dateReturned
  resub_number     integer,
  register_item_id text,                      -- submittal.registerItemId
  sp_folder_url    text,
  links            jsonb not null default '[]'::jsonb,   -- the human-recorded links array, verbatim
  has_ai_review    boolean not null default false,
  ai_review_at     text,                      -- aiReview.at, joins pms_ca_review_feedback.ai_at
  source           text,                      -- item.source ('backload', 'newforma', null)
  body_text        text,                      -- subject + description + response, HTML stripped: ONE field for ts and later embeddings
  raw              jsonb not null,            -- the item as stored, for fields this table does not model
  project_updated_at timestamptz,             -- pms_projects.updated_at at projection time
  projected_at     timestamptz not null default now(),
  search_tsv       tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(number,'') || ' ' || coalesce(spec_section,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(subject,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(body_text,'')), 'B')
  ) stored,
  primary key (project_row_id, item_type, item_id)
);

create index pms_ca_items_project_idx  on public.pms_ca_items (project_prefix, item_type, is_open);
create index pms_ca_items_number_idx   on public.pms_ca_items (project_prefix, item_type, number);
create index pms_ca_items_spec_idx     on public.pms_ca_items (spec_section) where spec_section is not null;
create index pms_ca_items_search_idx   on public.pms_ca_items using gin (search_tsv);
create index pms_ca_items_number_trgm  on public.pms_ca_items using gin (number gin_trgm_ops);  -- pg_trgm is already installed (pms_documents)
```

Notes on the choices:

- Two text-search configs on purpose. Numbers and spec sections go
  through `simple` so "23 09 23" and "RFI-012" are kept as typed;
  prose goes through `english` so "dampers" finds "damper". The emails
  function and `pms_documents` use `simple` only; that is right for file
  names and would be wrong for RFI prose.
- `body_text` is a plain column written by the trigger (HTML stripped
  with `regexp_replace(x, '<[^>]+>', ' ', 'g')`, entities for `&nbsp;`,
  `&amp;` decoded). It is the one field a later embedding job reads, so
  the vector and the tsvector never disagree about what the item says.
- `raw` keeps the whole item. The table models what people filter and
  search by; anything else is still reachable without a schema change.
- `is_open` is computed in the trigger from the same status sets the
  connector uses (`RFI_OPEN`, `SUBMITTAL_OPEN` in index.ts). Those sets
  become the single definition in SQL, and the connector reads the column.
- Keyed on `item.id`, not `number`. Items get renumbered; `findCaItem`
  already falls back from number to id for that reason. Backloaded items
  carry `backload-<type>-<uid>` ids, so every item has one. An item with
  an empty id (unlikely, but the pre-id era may have some) is keyed as
  `<type>:<number>` and flagged in `source` as `'no-id'` so it can be
  found and fixed.

## Trigger

```sql
create or replace function public.pms_ca_items_project()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Project both arrays. ON CONFLICT updates only when something changed, so
  -- a save that touched a milestone leaves CA rows alone.
  insert into public.pms_ca_items (project_row_id, item_type, item_id, project_number, project_prefix,
      number, subject, description, response, stamp, status, is_open, discipline, spec_section,
      from_party, assigned_to, sub_assigned, date_received, due_date, date_closed, resub_number,
      register_item_id, sp_folder_url, links, has_ai_review, ai_review_at, source, body_text, raw,
      project_updated_at, projected_at)
  select new.id, k.item_type, coalesce(nullif(i->>'id',''), k.item_type || ':' || (i->>'number')),
         new.project->>'projectNumber', lower(new.project->>'projectNumber'),
         i->>'number',
         case k.item_type when 'rfi' then i->>'title' else i->>'description' end,
         case k.item_type when 'rfi' then i->>'description' end,
         pms_strip_html(case k.item_type when 'rfi' then i->>'response' else i->>'comments' end),
         i->>'stamp', i->>'status',
         case k.item_type
           when 'rfi' then (i->>'status') in ('Open','Pending Sub Response')
           else (i->>'status') in ('Received','Under Review','Pending Sub Review','Resubmittal Required') end,
         i->>'discipline', nullif(i->>'specSection',''), i->>'from',
         (select array_agg(x) from jsonb_array_elements_text(coalesce(i->'assignedTo','[]'::jsonb)) x),
         i->>'subAssigned',
         pms_date_or_null(i->>'dateReceived'), pms_date_or_null(i->>'dueDate'),
         pms_date_or_null(coalesce(nullif(i->>'dateResponded',''), nullif(i->>'dateReturned',''))),
         nullif(i->>'resubNumber','')::int, i->>'registerItemId', i->>'spFolderUrl',
         coalesce(i->'links','[]'::jsonb),
         (i ? 'aiReview'), i->'aiReview'->>'at',
         coalesce(i->>'source', case when nullif(i->>'id','') is null then 'no-id' end),
         pms_strip_html(concat_ws(' ', i->>'title', i->>'description', i->>'response', i->>'comments')),
         i, new.updated_at, now()
  from (values ('rfi','rfis'), ('submittal','submittals')) as k(item_type, arr_key)
  cross join lateral jsonb_array_elements(coalesce(new.project->k.arr_key, '[]'::jsonb)) as i
  on conflict (project_row_id, item_type, item_id) do update
    set raw = excluded.raw, body_text = excluded.body_text, /* …every modelled column… */
        project_updated_at = excluded.project_updated_at, projected_at = now()
    where pms_ca_items.raw is distinct from excluded.raw
       or pms_ca_items.project_number is distinct from excluded.project_number;

  -- Items removed from the blob are removed from the projection.
  delete from public.pms_ca_items c
  where c.project_row_id = new.id
    and not exists (
      select 1 from (values ('rfi','rfis'), ('submittal','submittals')) as k(item_type, arr_key)
      cross join lateral jsonb_array_elements(coalesce(new.project->k.arr_key, '[]'::jsonb)) as i
      where k.item_type = c.item_type
        and coalesce(nullif(i->>'id',''), k.item_type || ':' || (i->>'number')) = c.item_id);
  return null;
exception when others then
  -- A projection bug must NEVER block a human's save. Log and let the save through;
  -- the nightly reconcile (below) repairs the row.
  raise warning 'pms_ca_items projection failed for %: %', new.id, sqlerrm;
  return null;
end $$;

create trigger pms_ca_items_project_trigger
after insert or update of project on public.pms_projects
for each row execute function public.pms_ca_items_project();
```

`pms_strip_html(text)` and `pms_date_or_null(text)` are two small
immutable SQL helpers in the same migration (the date one exists because
the client stores dates as `''` when blank, which `::date` rejects).

The `exception` block is the important line. An AFTER trigger that
throws aborts the PATCH, and the PMS would show a save failure for a bug
in a side table. Swallow, warn, and reconcile.

Reconcile: one statement, `update pms_projects set updated_at = updated_at
where id = …` is NOT it (that bumps nothing but still fires history). Add
a `pms_ca_items_reconcile(p_row_id text default null)` function that runs
the same projection body for one or all rows, and call it from the
connector's existing nightly document sync so a warning in the logs never
becomes permanent drift. The backfill at migration time is
`select pms_ca_items_reconcile();`.

## Row-level security

Rows are a projection of `pms_projects`, so they must not be readable by
anyone who cannot read the source row. Mirror the `pms_projects` SELECT
policy exactly as the broadcast migration did (it documented that policy
as `for select to authenticated using (true)` on 2026-09-18). VERIFY
before merge that the confidential-projects work (migration
`20260919160000`) did not narrow that policy; if it did, the projection
needs the same predicate or the confidential gate leaks through search.
Writes: none from clients. The trigger runs as definer; the reconcile
function is `service_role` only, like `pms_equipment_tags`.

## Connector changes (`index.ts`, new `caItems.ts`)

New RPC, called from `search_rfis_submittals`:

```sql
create function public.search_ca_items(
  q text, proj_prefixes text[], p_type text, p_status text, p_discipline text,
  p_open_only boolean, lim int)
returns table (…modelled columns…, rank real, snippet text)
```

- `proj_prefixes` is the caller's VISIBLE project set (from `getProjects()`
  after caps), or one project. The RPC never decides visibility; the
  connector does, as it does today. Firm-wide search sends the full
  visible list rather than `null` so a hidden project cannot surface
  through a search hit.
- Query handling, in order: a token that looks like an item number
  (`RFI-012`, `012`, `SUB 4`) or a spec section (`23 09 23`) runs as a
  trigram / normalised equality match first and those rows lead; then
  `websearch_to_tsquery('english', q)` ranked with `ts_rank_cd` on
  `search_tsv`; `ts_headline` on `body_text` supplies the snippet instead
  of the current "first 200 chars of the response".
- `status`, `discipline`, `openOnly` become WHERE clauses on indexed
  columns. `discipline` keeps its exact-match semantics.
- `driveOnly` (folders under CA with no log entry) is unchanged; it is a
  Graph walk, not a search.
- `read_rfi_submittal`, `save_ca_review`, `backload_ca_item` keep reading
  and writing the blob. Nothing about writes changes in this slice.
- `project_briefing` and `list_action_items` counts can move to
  `count(*) … group by status` on the table in a follow-up; not needed
  here.

`caItems.ts` holds the query classifier (number / spec section / prose)
and the row-to-tool-output mapper, with `caItems.test.mjs` covering the
classifier edge cases that already bit `trace_references`: two-digit
equipment tags, `option E 2021`, spec sections with and without spaces.

## Acceptance

- After backfill, `select item_type, count(*) from pms_ca_items group by 1`
  equals the sum of array lengths across `pms_projects`; a diff query in
  the migration PR shows zero mismatches.
- Editing an RFI response in the PMS modal and saving changes
  `pms_ca_items.body_text` within the same request (trigger, not a job).
- Deleting an item in the modal removes its row.
- `search_rfis_submittals` with `query: "dampers"` returns an item whose
  text says "damper" (stemming); `query: "RFI-012"` returns that item
  first on any project; `query: "23 09 23"` returns the submittals in
  that section.
- A firm-wide query returns in well under a second with no project blob
  loaded into the edge function (check the function's memory and duration
  in `function_edge_logs` before and after).
- A deliberately broken projection (test branch: raise inside the
  function) does not stop a PMS save; the warning appears in Postgres logs
  and `pms_ca_items_reconcile(id)` repairs the row.
- No `window.__appVersion` bump: `SettyPMS.html` does not change.

## Rollout

1. Migration PR: table, helpers, trigger, reconcile function, backfill,
   RLS, plus the count-diff query in the PR description. Deploy with
   `supabase db push` / `apply_migration`; the trigger starts projecting
   immediately.
2. Connector PR: `caItems.ts`, the RPC, `search_rfis_submittals` switched
   over behind a `CA_ITEMS_TABLE=1` env flag for one deploy so the old
   in-memory path can be restored without a rollback. Deploy via
   `deploy.ps1` (a merge alone does not ship it).
3. Remove the flag and the in-memory path once a week of use shows no
   missing items.

## Out of scope, by design

- Embeddings. The table leaves room (`body_text`, one row per item) and
  nothing else. Add `embedding vector(…)` and an embed-on-change job only
  after step 2 of the discussion is agreed and the corpus size is known.
- Materialising `trace_references` sheet links into a `pms_ca_item_refs`
  table. That is Stage 1 of the linking plan and is gated on the Stage 0
  precision measurement, not on this table. When it comes, it keys on
  `(project_row_id, item_type, item_id)` from here.
- Moving the source of truth out of the blob. Revisit only if the
  projection shows a real need (concurrent editors on CA items, or the
  blob size becoming a save-time problem).
- Emails: already full-text indexed; coverage is a filing-habit problem.

## Open questions for the owner

- Are there projects whose CA items were imported without `id`s
  (Newforma era)? The `'no-id'` source flag answers this after backfill;
  if the count is large, a one-off id assignment in the blob is cheap
  and should happen before anything links to these rows.
- `english` stemming is right for prose and wrong for a few
  domain tokens (`VAV`, `AHU`) that stem harmlessly but
  `ts_headline` may highlight oddly. Acceptable, flagging so nobody
  reads it as a bug.
