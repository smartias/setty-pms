-- Two stores that let a later review reuse what an earlier one worked out.
--
-- 1) pms_drawing_schedules: the schedules parsed off one PDF page.
--    read_drawing_schedule downloaded the PDF and rebuilt its tables from text
--    geometry on EVERY call: in the QA review a few days before issue, and
--    again in each RFI and submittal review during CA. The parse of a given
--    file never changes, so it is kept. Keyed on the file and page, like
--    pms_drawing_text: a revision is a new file, so each revision keeps its own
--    schedules. `size_bytes` is the file's size when it was parsed; a reader
--    compares it with the file's current size (one metadata call, no download)
--    and re-parses when they differ, which is how a PDF replaced in place is
--    caught. `parser` versions the extractor, so a change to it invalidates
--    every row at once. Same posture as the drawing index: written only by the
--    connector (service role), a cache and not a business record, safe to
--    truncate.
--
--    This reverses the roadmap's "schedules rebuilt on demand" decision on
--    purpose (owner's call, 2026-11-16). The reason for that decision was that
--    a second store could drift from the drawings; keying on file + size and
--    versioning the parser is what keeps this one from drifting.
--
-- 2) Structured links, so "everything about EF-7 / sheet E-610" is one lookup
--    instead of a text search per review:
--      pms_qa_findings.tags   equipment tags a finding concerns, beside the
--                             `sheets` it already cites.
--      pms_ca_item_refs       the sheets, equipment tags and spec sections an
--                             RFI or submittal review relied on. One row per
--                             link. Written by save_ca_review (origin
--                             'ca-review'); the sheet links a PM confirms in
--                             the PMS stay on the item itself and are read from
--                             there, not copied here.

create table if not exists public.pms_drawing_schedules (
  item_id        text not null,                  -- "<driveId>|<itemId>" or an az: drive id
  page           int  not null,
  parser         text not null,                  -- extractor version
  size_bytes     bigint,                         -- file size when parsed
  has_text       boolean not null default true,  -- false: scanned / image-only page
  project_prefix text,                           -- null when read in direct mode
  sheet_no       text,
  revision       text,
  revision_date  text,
  folder_path    text,
  tables         jsonb not null default '[]'::jsonb,
  cached_at      timestamptz not null default now(),
  primary key (item_id, page)
);
create index if not exists pms_drawing_schedules_prefix on public.pms_drawing_schedules (project_prefix, sheet_no);

alter table public.pms_drawing_schedules enable row level security;
drop policy if exists drawing_schedules_admin_all on public.pms_drawing_schedules;
create policy drawing_schedules_admin_all on public.pms_drawing_schedules for all using (is_pms_admin());

alter table public.pms_qa_findings
  add column if not exists tags jsonb;           -- ["EF-7", "RTU-1"]

create table if not exists public.pms_ca_item_refs (
  id          bigserial primary key,
  project     text not null,
  item_type   text not null check (item_type in ('rfi','submittal')),
  item_number text not null,                     -- the item's logged number
  ref_kind    text not null check (ref_kind in ('sheet','tag','spec')),
  ref_key     text not null,                     -- comparable form: "e610", "EF-7", "237400"
  ref_label   text,                              -- as the review wrote it: "E-610 Rev 2"
  origin      text not null default 'ca-review',
  created_by  text not null,
  created_at  timestamptz not null default now(),
  unique (project, item_type, item_number, ref_kind, ref_key, origin)
);
create index if not exists pms_ca_item_refs_lookup on public.pms_ca_item_refs (project, ref_kind, ref_key);

alter table public.pms_ca_item_refs enable row level security;
drop policy if exists ca_item_refs_read on public.pms_ca_item_refs;
create policy ca_item_refs_read on public.pms_ca_item_refs for select to authenticated using (true);
drop policy if exists ca_item_refs_admin_all on public.pms_ca_item_refs;
create policy ca_item_refs_admin_all on public.pms_ca_item_refs for all
  using (is_pms_admin()) with check (is_pms_admin());
