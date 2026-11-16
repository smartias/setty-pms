-- RFI root causes: the RFI log feeds QA for the next project.
--
-- QA is proactive (it removes the causes of RFIs before a set goes out) and
-- RFIs are reactive. The RFI log is therefore the record of what the documents
-- got wrong. Twice on 2026-11-16 a project's log was compared by hand against
-- a QA review of its issued set (Tabler Quad, 276 RFIs; BPL New Lots, 41), and
-- each comparison produced checks the checklist lacked. This table makes that
-- comparison a by-product of ordinary CA work: one tag per RFI, written when
-- the RFI is reviewed, saying why it was asked and which QA check would have
-- caught it.
--
--   cause        why the RFI was asked:
--                  doc-conflict     the documents disagree with themselves
--                  doc-missing      something needed is not in the documents
--                  coordination     MEPFP against another discipline, or trade
--                                   against trade in space
--                  scope-gap        who furnishes, installs or wires it
--                  contractor       answered by the documents as issued, means
--                                   and methods, a substitution request
--                  field-condition  an existing or site condition
--                  owner-change     the owner changed what they want
--                  other
--   preventable  could a review of the documents before issue have caught it
--   qa_item      the checklist item that would have caught it (qa-614 ...);
--                null on a preventable row means NO check covers it, which is
--                how a missing checklist item shows up
--   phase        bid or construction
--
-- Written by the connector: save_ca_review (one RFI, during its review) and
-- tag_rfi_root_causes (back-filling a log). Claude proposes the tag; the row
-- carries who ran it. Internal, like the QA ledger: never shown to the
-- contractor or on a transmittal.

create table if not exists public.pms_rfi_root_causes (
  id           bigserial primary key,
  project      text not null,
  item_type    text not null default 'rfi' check (item_type in ('rfi','submittal')),
  item_number  text not null,
  subject      text,
  phase        text not null default 'construction' check (phase in ('bid','construction')),
  cause        text not null check (cause in ('doc-conflict','doc-missing','coordination','scope-gap','contractor','field-condition','owner-change','other')),
  preventable  boolean not null default false,
  qa_item      text,
  sheets       text[],
  note         text,
  tagged_by    text not null,
  tagged_at    timestamptz not null default now(),
  unique (project, item_type, item_number)
);
create index if not exists pms_rfi_root_causes_cause on public.pms_rfi_root_causes (cause, preventable);
create index if not exists pms_rfi_root_causes_item on public.pms_rfi_root_causes (qa_item);

alter table public.pms_rfi_root_causes enable row level security;
drop policy if exists rfi_root_causes_read on public.pms_rfi_root_causes;
create policy rfi_root_causes_read on public.pms_rfi_root_causes for select to authenticated using (true);
drop policy if exists rfi_root_causes_admin_all on public.pms_rfi_root_causes;
create policy rfi_root_causes_admin_all on public.pms_rfi_root_causes for all
  using (is_pms_admin()) with check (is_pms_admin());
