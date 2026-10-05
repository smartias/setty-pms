-- pms_documents: one row per file, with the attributes people search by stored
-- and filterable. Everything is DERIVED by the pms-mcp sync job (documentMeta.ts)
-- from the register, folder and file names; nobody types it in. A person may
-- correct a derived value through `overrides`, which the sync never writes.
--
-- Scope: the project folder tree, plus the name-based Proposals and Contract
-- libraries. Image files are excluded (photos stay session-level in
-- pms_field_photo_sessions). pms_drawing_text, pms_project_emails and the photo
-- sessions remain the source of truth for their content; this table links to
-- them (item_id joins pms_drawing_index_files, email_record_id joins
-- pms_project_emails).

create extension if not exists pg_trgm;

create table if not exists public.pms_documents (
  item_id          text primary key,            -- Graph itemId, "<driveId>|<id>" (az: ids for Azure drives)
  scope            text not null,               -- sync unit: lower-case project number, or 'lib:<library>/<top folder>'
  project_prefix   text,                        -- lower-case project number; null for an unlinked library folder
  link_basis       text,                        -- how a library folder was tied to a project, null when not linked
  library          text not null,
  folder_path      text not null,               -- relative to the scope root
  name             text not null,
  ext              text,
  size_bytes       bigint,
  web_url          text,
  modified_at      timestamptz,                 -- Graph lastModifiedDateTime: weak evidence (bulk migration flattened it)

  -- derived attributes (canonical values, see documentMeta.ts)
  area             text,
  doc_type         text,
  discipline       text,                        -- code: M, E, P, FP, FA, T, EN, A, S, C, G, L
  design_phase     text,                        -- SD, DD, CD, Bid, CA, Programming, Validation
  site_phase       text,                        -- field/photo vocabulary
  set_name         text,                        -- Outgoing set folder name
  set_date         date,                        -- read from the folder name, never from modified_at
  sheet_no         text,
  revision         text,
  record_kind      text,                        -- 'RFI' | 'Submittal'
  record_number    text,
  email_record_id  text,                        -- pms_project_emails.record_id for files under Emails/<date subject>/

  -- supersession, from the transmittal register (only files issued through the tool)
  issue_status     text not null default 'unknown',
  transmittal_number text,

  -- provenance and human override
  derived_from     jsonb not null default '{}'::jsonb,   -- {"discipline":"register","design_phase":"folder"}
  overrides        jsonb not null default '{}'::jsonb,   -- {"doc_type":"Narrative"}; the sync never writes this column
  sidecar          jsonb,                                -- reserved: folder _pms-metadata.json (not read in v1)

  -- lifecycle
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  deleted_at       timestamptz,                 -- tombstone, only set after a COMPLETE walk of the scope
  updated_at       timestamptz not null default now(),

  search_tsv       tsvector generated always as (
    to_tsvector('simple',
      coalesce(name, '') || ' ' || coalesce(folder_path, '') || ' ' ||
      coalesce(set_name, '') || ' ' || coalesce(sheet_no, ''))
  ) stored,

  constraint pms_documents_issue_status_chk
    check (issue_status in ('current', 'superseded', 'ambiguous', 'unknown')),
  constraint pms_documents_design_phase_chk
    check (design_phase is null or design_phase in ('SD', 'DD', 'CD', 'Bid', 'CA', 'Programming', 'Validation'))
);

create index if not exists pms_documents_scope_idx
  on public.pms_documents (scope) where deleted_at is null;
create index if not exists pms_documents_project_idx
  on public.pms_documents (project_prefix) where deleted_at is null;
create index if not exists pms_documents_filters_idx
  on public.pms_documents (project_prefix, doc_type, discipline, design_phase) where deleted_at is null;
create index if not exists pms_documents_set_idx
  on public.pms_documents (project_prefix, set_date desc) where deleted_at is null;
create index if not exists pms_documents_record_idx
  on public.pms_documents (project_prefix, record_kind, record_number) where deleted_at is null;
create index if not exists pms_documents_email_idx
  on public.pms_documents (email_record_id) where email_record_id is not null;
create index if not exists pms_documents_search_idx
  on public.pms_documents using gin (search_tsv);
create index if not exists pms_documents_name_trgm_idx
  on public.pms_documents using gin (name gin_trgm_ops);

-- Reading an attribute should never have to remember the override rule.
create or replace view public.pms_documents_v as
select
  d.item_id, d.scope, d.project_prefix, d.link_basis, d.library, d.folder_path, d.name, d.ext,
  d.size_bytes, d.web_url, d.modified_at, d.area,
  coalesce(d.overrides->>'doc_type', d.doc_type)           as doc_type,
  coalesce(d.overrides->>'discipline', d.discipline)       as discipline,
  coalesce(d.overrides->>'design_phase', d.design_phase)   as design_phase,
  coalesce(d.overrides->>'site_phase', d.site_phase)       as site_phase,
  d.set_name, d.set_date,
  coalesce(d.overrides->>'sheet_no', d.sheet_no)           as sheet_no,
  d.revision, d.record_kind, d.record_number, d.email_record_id,
  d.issue_status, d.transmittal_number, d.derived_from, d.overrides,
  d.first_seen_at, d.last_seen_at, d.search_tsv
from public.pms_documents d
where d.deleted_at is null;

-- Per-scope sync state: rotation order, and whether the last walk was complete
-- (a truncated walk must never tombstone files it simply did not reach).
create table if not exists public.pms_documents_sync (
  scope             text primary key,
  last_started_at   timestamptz,
  last_completed_at timestamptz,
  complete          boolean not null default false,
  file_count        integer,
  skipped_images    integer,
  error             text,
  updated_at        timestamptz not null default now()
);

-- Same posture as pms_mcp_tree_cache and pms_drawing_text: written by the
-- connector (service role, which bypasses RLS) and readable by PMS admins. The
-- browser at large does not read it. Proposals and Contract folders are not
-- visibility-gated by project today (see the note above
-- sharePointDriveIsKnownLibrary in pms-mcp), and this table adds no new exposure.
alter table public.pms_documents enable row level security;
alter table public.pms_documents_sync enable row level security;

drop policy if exists pms_documents_admin_all on public.pms_documents;
create policy pms_documents_admin_all on public.pms_documents for all using (is_pms_admin());
drop policy if exists pms_documents_sync_admin_all on public.pms_documents_sync;
create policy pms_documents_sync_admin_all on public.pms_documents_sync for all using (is_pms_admin());

alter view public.pms_documents_v set (security_invoker = true);
