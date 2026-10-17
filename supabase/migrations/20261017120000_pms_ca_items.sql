-- pms_ca_items: one row per RFI / submittal, PROJECTED from the two jsonb
-- arrays in pms_projects.project (`rfis`, `submittals`) by a trigger on that
-- table. The blob stays the source of truth: the PMS modal, the connector's
-- updateProjectRecord, pms_projects_history and the Realtime broadcast all keep
-- reading and writing it unchanged. This table exists so CA items can be
-- indexed, ranked (full text) and joined, which an array inside a blob cannot
-- be. Design and rollout: supabase/functions/pms-mcp/PROPOSAL-ca-items-table.md
-- (step 1 of three; the search RPC and the connector switch-over are the next
-- PR, so nothing reads this table yet).
--
-- Rules the projection follows:
--   - keyed on item.id (a uid; backloaded items carry backload-<type>-<uid>),
--     never on `number`, which gets renumbered. An item with no id is keyed
--     '<type>:<number>' and marked source='no-id' so it can be found and fixed
--     (see supabase/ca-items-verify.sql).
--   - a save that did not change an item leaves its row alone (the
--     `is distinct from` guard on raw), so a milestone edit does not rewrite
--     every CA row of the project.
--   - items removed from the blob are removed from the projection; a deleted
--     project row cascades.
--   - a projection failure NEVER blocks a person's save: the trigger catches,
--     raises a WARNING (visible in Postgres logs) and returns, and
--     pms_ca_items_reconcile() repairs the row afterwards. The connector's
--     nightly sync calls it (next PR); the backfill at the end of this file is
--     the same function run once over everything.
--
-- Visibility: rows are a projection of pms_projects, whose select policy is
-- `to authenticated using (true)` (baseline 20260727, unchanged by the
-- confidential-projects migration 20260919160000, which gates in the connector
-- and in the WRITE policy). The same select policy applies here, so this table
-- exposes nothing the source table does not. Writes: none from clients. The
-- trigger runs as definer; the reconcile function is service_role only.

create extension if not exists pg_trgm;

-- ── Helpers ───────────────────────────────────────────────────────────────────

-- HTML → plain text, for the modal's rich-text fields (rfi.response,
-- submittal.comments). Order matters: drop script/style bodies, turn breaks
-- and block ends into newlines, strip the remaining tags, THEN decode entities
-- (decoding first would turn a literal "&lt;b&gt;" into a tag and lose it).
create or replace function public.pms_strip_html(p text)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select nullif(btrim(
    regexp_replace(                                   -- collapse blank lines and space around newlines
      regexp_replace(                                 -- no space before punctuation ("<i>FSD</i>." -> "FSD.")
        regexp_replace(                               -- collapse runs of spaces
          replace(replace(replace(replace(replace(replace(replace(
            regexp_replace(                           -- strip every remaining tag
              regexp_replace(                         -- breaks and block ends -> newline
                regexp_replace(p, '<(script|style)[^>]*>.*?</\1\s*>', ' ', 'gi'),
                '<br\s*/?>|</(p|div|tr|li|h[1-6])\s*>', E'\n', 'gi'),
              '<[^>]+>', ' ', 'g'),
            '&nbsp;', ' '), '&#160;', ' '), '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''),
          '[ \t\r]+', ' ', 'g'),
        '\s+([.,;:!?)])', '\1', 'g'),
      E'\\s*\n\\s*', E'\n', 'g'),
    E' \t\n\r'), '')
$$;

-- The client stores a blank date as '' and the import era left a few odd
-- strings; neither may abort the projection.
create or replace function public.pms_date_or_null(p text)
returns date
language plpgsql immutable strict parallel safe
set search_path = ''
as $$
begin
  if p !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return left(p, 10)::date;
exception when others then
  return null;
end
$$;

-- `rfis` / `submittals` as an array, or an empty one when absent or malformed.
create or replace function public.pms_ca_items_array(p_project jsonb, p_key text)
returns jsonb
language sql immutable strict parallel safe
set search_path = ''
as $$
  select case when jsonb_typeof(p_project -> p_key) = 'array' then p_project -> p_key else '[]'::jsonb end
$$;

-- THE definition of "still needs attention". Same sets as RFI_OPEN /
-- SUBMITTAL_OPEN in pms-mcp/index.ts; the connector reads the column instead
-- of re-deriving it once it switches over.
create or replace function public.pms_ca_item_is_open(p_type text, p_status text)
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case p_type
    when 'rfi'       then coalesce(p_status, '') in ('Open', 'Pending Sub Response')
    when 'submittal' then coalesce(p_status, '') in ('Received', 'Under Review', 'Pending Sub Review', 'Resubmittal Required')
    else false end
$$;

-- ── Table ─────────────────────────────────────────────────────────────────────

create table if not exists public.pms_ca_items (
  project_row_id     text not null references public.pms_projects(id) on delete cascade,
  item_type          text not null,
  item_id            text not null,              -- item.id; '<type>:<number>' when the item has none
  project_number     text,                       -- project->>'projectNumber' as typed (pms_lessons.project_id, pms_ca_review_feedback.project)
  project_prefix     text,                       -- lower(project_number): joins pms_documents.project_prefix / pms_drawing_text
  number             text,                       -- 'RFI-012', 'SUB-004'
  subject            text,                       -- rfi.title | submittal.description (the row title in the modal)
  description        text,                       -- rfi.description (the question); null for submittals
  response           text,                       -- rfi.response | submittal.comments, HTML stripped
  stamp              text,                       -- submittal only
  status             text,
  is_open            boolean not null default false,
  discipline         text,
  spec_section       text,
  from_party         text,                       -- item.from
  assigned_to        text[],
  sub_assigned       text,
  date_received      date,
  due_date           date,
  date_closed        date,                       -- rfi.dateResponded | submittal.dateReturned
  resub_number       integer,
  register_item_id   text,                       -- submittal.registerItemId
  sp_folder_url      text,
  links              jsonb not null default '[]'::jsonb,   -- the human-recorded links array, verbatim
  has_ai_review      boolean not null default false,
  ai_review_at       text,                       -- aiReview.at; joins pms_ca_review_feedback.ai_at
  source             text,                       -- item.source ('backload', …) or 'no-id'
  body_text          text,                       -- subject + description + response, HTML stripped: the ONE field for search and, later, embeddings
  raw                jsonb not null,             -- the item as stored, for anything this table does not model
  project_updated_at timestamptz,                -- pms_projects.updated_at when the row was projected
  projected_at       timestamptz not null default now(),

  search_tsv tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig,  coalesce(number, '') || ' ' || coalesce(spec_section, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(body_text, '')), 'B')
  ) stored,

  constraint pms_ca_items_pkey primary key (project_row_id, item_type, item_id),
  constraint pms_ca_items_type_chk check (item_type in ('rfi', 'submittal'))
);

create index if not exists pms_ca_items_project_idx
  on public.pms_ca_items (project_prefix, item_type, is_open);
create index if not exists pms_ca_items_number_idx
  on public.pms_ca_items (project_prefix, item_type, number);
create index if not exists pms_ca_items_spec_idx
  on public.pms_ca_items (spec_section) where spec_section is not null;
create index if not exists pms_ca_items_search_idx
  on public.pms_ca_items using gin (search_tsv);
create index if not exists pms_ca_items_number_trgm_idx
  on public.pms_ca_items using gin (number gin_trgm_ops);

-- ── Projection ────────────────────────────────────────────────────────────────

-- Projects ONE pms_projects row: upserts every item in its two arrays (only
-- rows whose content changed are written) and deletes rows for items that are
-- no longer in the blob. Returns the number of rows written or deleted. Shared
-- by the trigger and the reconcile function so they can never disagree.
create or replace function public.pms_ca_items_project_row(p_row public.pms_projects)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upserted integer := 0;
  v_deleted  integer := 0;
begin
  with items as (
    -- last occurrence of a duplicated id wins; the array order is the UI order
    select distinct on (x.item_type, x.item_id) x.item_type, x.item_id, x.item
    from (
      select k.item_type, i.item, i.ord,
             coalesce(nullif(i.item ->> 'id', ''), k.item_type || ':' || coalesce(i.item ->> 'number', '?')) as item_id
      from (values ('rfi', 'rfis'), ('submittal', 'submittals')) as k(item_type, arr_key)
      cross join lateral jsonb_array_elements(public.pms_ca_items_array(p_row.project, k.arr_key))
        with ordinality as i(item, ord)
      where jsonb_typeof(i.item) = 'object'
    ) x
    order by x.item_type, x.item_id, x.ord desc
  )
  insert into public.pms_ca_items as c (
    project_row_id, item_type, item_id, project_number, project_prefix,
    number, subject, description, response, stamp, status, is_open,
    discipline, spec_section, from_party, assigned_to, sub_assigned,
    date_received, due_date, date_closed, resub_number, register_item_id,
    sp_folder_url, links, has_ai_review, ai_review_at, source, body_text, raw,
    project_updated_at, projected_at)
  select
    p_row.id, s.item_type, s.item_id,
    p_row.project ->> 'projectNumber',
    lower(p_row.project ->> 'projectNumber'),
    s.item ->> 'number',
    case s.item_type when 'rfi' then s.item ->> 'title' else s.item ->> 'description' end,
    case s.item_type when 'rfi' then s.item ->> 'description' end,
    public.pms_strip_html(case s.item_type when 'rfi' then s.item ->> 'response' else s.item ->> 'comments' end),
    s.item ->> 'stamp',
    s.item ->> 'status',
    public.pms_ca_item_is_open(s.item_type, s.item ->> 'status'),
    s.item ->> 'discipline',
    nullif(btrim(s.item ->> 'specSection'), ''),
    s.item ->> 'from',
    case when jsonb_typeof(s.item -> 'assignedTo') = 'array'
         then (select array_agg(a) from jsonb_array_elements_text(s.item -> 'assignedTo') a) end,
    s.item ->> 'subAssigned',
    public.pms_date_or_null(s.item ->> 'dateReceived'),
    public.pms_date_or_null(s.item ->> 'dueDate'),
    public.pms_date_or_null(coalesce(nullif(s.item ->> 'dateResponded', ''), nullif(s.item ->> 'dateReturned', ''))),
    case when (s.item ->> 'resubNumber') ~ '^\d+$' then (s.item ->> 'resubNumber')::integer end,
    s.item ->> 'registerItemId',
    s.item ->> 'spFolderUrl',
    case when jsonb_typeof(s.item -> 'links') = 'array' then s.item -> 'links' else '[]'::jsonb end,
    coalesce(jsonb_typeof(s.item -> 'aiReview') = 'object', false),
    s.item -> 'aiReview' ->> 'at',
    coalesce(nullif(s.item ->> 'source', ''), case when nullif(s.item ->> 'id', '') is null then 'no-id' end),
    public.pms_strip_html(concat_ws(E'\n',
      nullif(s.item ->> 'title', ''), nullif(s.item ->> 'description', ''),
      nullif(s.item ->> 'response', ''), nullif(s.item ->> 'comments', ''))),
    s.item,
    p_row.updated_at, now()
  from items s
  on conflict (project_row_id, item_type, item_id) do update set
    project_number = excluded.project_number, project_prefix = excluded.project_prefix,
    number = excluded.number, subject = excluded.subject, description = excluded.description,
    response = excluded.response, stamp = excluded.stamp, status = excluded.status,
    is_open = excluded.is_open, discipline = excluded.discipline, spec_section = excluded.spec_section,
    from_party = excluded.from_party, assigned_to = excluded.assigned_to, sub_assigned = excluded.sub_assigned,
    date_received = excluded.date_received, due_date = excluded.due_date, date_closed = excluded.date_closed,
    resub_number = excluded.resub_number, register_item_id = excluded.register_item_id,
    sp_folder_url = excluded.sp_folder_url, links = excluded.links,
    has_ai_review = excluded.has_ai_review, ai_review_at = excluded.ai_review_at,
    source = excluded.source, body_text = excluded.body_text, raw = excluded.raw,
    project_updated_at = excluded.project_updated_at, projected_at = now()
  where c.raw is distinct from excluded.raw
     or c.project_number is distinct from excluded.project_number;
  get diagnostics v_upserted = row_count;

  delete from public.pms_ca_items c
  where c.project_row_id = p_row.id
    and not exists (
      select 1
      from (values ('rfi', 'rfis'), ('submittal', 'submittals')) as k(item_type, arr_key)
      cross join lateral jsonb_array_elements(public.pms_ca_items_array(p_row.project, k.arr_key)) as i(item)
      where jsonb_typeof(i.item) = 'object'
        and k.item_type = c.item_type
        and coalesce(nullif(i.item ->> 'id', ''), k.item_type || ':' || coalesce(i.item ->> 'number', '?')) = c.item_id);
  get diagnostics v_deleted = row_count;

  return v_upserted + v_deleted;
end
$$;

-- The trigger: project, and never let a projection bug abort the save that
-- fired it. plpgsql's exception block runs the body in a subtransaction, so a
-- failed projection is rolled back on its own and the pms_projects write
-- commits as if this trigger did not exist.
create or replace function public.pms_ca_items_project_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.pms_ca_items_project_row(new);
  return null;
exception when others then
  raise warning 'pms_ca_items: projection failed for project row % (%): %', new.id, sqlstate, sqlerrm;
  return null;
end
$$;

drop trigger if exists pms_ca_items_project_trigger on public.pms_projects;
create trigger pms_ca_items_project_trigger
after insert or update of project on public.pms_projects
for each row execute function public.pms_ca_items_project_trigger();

-- Re-project one row (p_row_id) or every row; also the backfill. One failing
-- project is reported in its row, not allowed to stop the rest.
create or replace function public.pms_ca_items_reconcile(p_row_id text default null)
returns table (project_row_id text, written integer, error text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.pms_projects;
begin
  for r in
    select p.* from public.pms_projects p
    where p_row_id is null or p.id = p_row_id
    order by p.id
  loop
    project_row_id := r.id;
    begin
      written := public.pms_ca_items_project_row(r);
      error := null;
    exception when others then
      written := -1;
      error := sqlstate || ': ' || sqlerrm;
    end;
    return next;
  end loop;
end
$$;

-- ── Privileges and RLS ────────────────────────────────────────────────────────

revoke all on function public.pms_ca_items_project_row(public.pms_projects) from public, anon, authenticated;
revoke all on function public.pms_ca_items_project_trigger() from public, anon, authenticated;
revoke all on function public.pms_ca_items_reconcile(text) from public, anon, authenticated;
grant execute on function public.pms_ca_items_reconcile(text) to service_role;

alter table public.pms_ca_items enable row level security;

drop policy if exists pms_ca_items_select on public.pms_ca_items;
create policy pms_ca_items_select on public.pms_ca_items
  for select to authenticated using (true);

-- No insert/update/delete policy: the trigger and reconcile write as definer,
-- the connector as service_role. Supabase default privileges grant anon and
-- authenticated everything on new public tables; RLS already denies the
-- writes, but TRUNCATE ignores RLS, so state the intended surface explicitly.
revoke all on public.pms_ca_items from anon;
revoke insert, update, delete, truncate, references, trigger on public.pms_ca_items from authenticated;

-- ── Backfill ──────────────────────────────────────────────────────────────────
-- Projects every existing row. Does not touch pms_projects, so no version
-- bump, no history row, no broadcast. supabase/ca-items-verify.sql checks the
-- counts afterwards.
do $$
declare
  v_rows integer;
  v_failed integer;
begin
  select count(*), count(*) filter (where error is not null)
    into v_rows, v_failed
  from public.pms_ca_items_reconcile();
  raise notice 'pms_ca_items backfill: % project rows projected, % failed', v_rows, v_failed;
end
$$;
