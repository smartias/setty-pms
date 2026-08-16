-- Drawing Intelligence phase 2: per-page text index for drawing PDFs.
-- Written ONLY by the pms-mcp connector (service role) as a lazily-filled cache,
-- same posture as pms_mcp_tree_cache. It is not a business record: it can be
-- truncated and rebuilt at any time. Rows are keyed on the SharePoint item, so
-- every revision of a sheet keeps its own text and history is queryable.

create extension if not exists pg_trgm;

create table if not exists public.pms_drawing_index_files (
  item_id        text primary key,               -- "<driveId>|<itemId>"
  project_prefix text not null,
  file_name      text,
  folder_path    text,
  web_url        text,
  size_bytes     bigint,
  status         text not null default 'pending', -- pending | done | failed | skipped
  attempts       int  not null default 0,
  pages          int,
  text_pages     int,
  error          text,
  indexed_at     timestamptz,
  updated_at     timestamptz not null default now()
);
create index if not exists pms_drawing_index_files_prefix on public.pms_drawing_index_files (project_prefix);

create table if not exists public.pms_drawing_text (
  id                   bigserial primary key,
  project_prefix       text not null,
  item_id              text not null,
  page                 int  not null,
  file_name            text,
  folder_path          text,
  web_url              text,
  sheet_no             text,
  sheet_title          text,
  revision             text,
  revision_date        text,
  revision_description text,
  title_block_layout   text,
  text                 text not null,
  text_len             int,
  indexed_at           timestamptz not null default now(),
  unique (item_id, page)
);
create index if not exists pms_drawing_text_prefix on public.pms_drawing_text (project_prefix);
create index if not exists pms_drawing_text_sheet  on public.pms_drawing_text (project_prefix, sheet_no);
create index if not exists pms_drawing_text_trgm   on public.pms_drawing_text using gin (text gin_trgm_ops);

alter table public.pms_drawing_index_files enable row level security;
alter table public.pms_drawing_text        enable row level security;
drop policy if exists drawing_index_files_admin_all on public.pms_drawing_index_files;
create policy drawing_index_files_admin_all on public.pms_drawing_index_files for all using (is_pms_admin());
drop policy if exists drawing_text_admin_all on public.pms_drawing_text;
create policy drawing_text_admin_all on public.pms_drawing_text for all using (is_pms_admin());

-- Search. Patterns are POSIX regexes built by the connector (input escaped
-- there); ALL must match a page. Snippet and count come from the FIRST pattern
-- so a 12k-character page never leaves the database.
create or replace function public.pms_drawing_search(
  p_prefix   text,
  p_patterns text[],
  p_folder   text default null,
  p_limit    int  default 80
)
returns table (
  item_id text, page int, file_name text, folder_path text, web_url text,
  sheet_no text, sheet_title text, revision text, revision_date text,
  matches int, snippet text
)
language sql stable
set statement_timeout = '8s'
as $$
  select t.item_id, t.page, t.file_name, t.folder_path, t.web_url,
         t.sheet_no, t.sheet_title, t.revision, t.revision_date,
         regexp_count(t.text, p_patterns[1], 1, 'i')::int as matches,
         substr(t.text, greatest(regexp_instr(t.text, p_patterns[1], 1, 1, 0, 'i') - 160, 1), 360) as snippet
  from public.pms_drawing_text t
  where t.project_prefix = p_prefix
    and (p_folder is null
         or lower(t.folder_path) = lower(p_folder)
         or lower(t.folder_path) like lower(p_folder) || '/%')
    and t.text ~* all (p_patterns)
  order by t.folder_path desc, t.sheet_no nulls last, t.page
  limit p_limit;
$$;
revoke all on function public.pms_drawing_search(text, text[], text, int) from public, anon, authenticated;
grant execute on function public.pms_drawing_search(text, text[], text, int) to service_role;
