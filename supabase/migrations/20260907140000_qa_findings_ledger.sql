-- The QA findings ledger: one shared record for internal coordination review
-- findings AND external review comments (DrChecks / owner / architect), so a
-- single back-check engine works both. Two tables:
--
--   pms_qa_reviews  - one row per review run (or per ingested comment log):
--                     project, the set/deliverable reviewed, derived phase,
--                     who ran it, coverage note.
--   pms_qa_findings - the rows that live until resolved: checklist item ref,
--                     source, sheets cited, evidence, status.
--
-- Status contract (enforced by check, honored by the tools):
--   open               - raised, nothing verified since
--   ready_to_backcheck - evidence of pickup found; a HUMAN closes it. The
--                        automated back-check may set this for ANY source,
--                        but may set closed only for source='qa' (internal),
--                        never for external comments - agency backchecks are
--                        contractual, so the click is human.
--   closed             - resolved with evidence or by a human
--   dismissed          - human override with a note ("not picking this up
--                        because ..."); nothing silently disappears.
--
-- Writes go through the connector tools (service role) which stamp the
-- caller and refuse the anonymous shared-secret lane, or through the PMS app
-- as the signed-in user. RLS: read authenticated; direct writes admin-only
-- (the app's QA tab acts via admins or the connector).

create table if not exists public.pms_qa_reviews (
  id           bigserial primary key,
  project      text not null,
  set_name     text,
  phase        text,
  kind         text not null default 'review' check (kind in ('review','backcheck','comment-log')),
  source_doc   text,          -- for comment-log ingests: the register file name
  coverage     text,          -- honest coverage note at run time
  run_by       text not null, -- caller email
  run_at       timestamptz not null default now()
);

create table if not exists public.pms_qa_findings (
  id            bigserial primary key,
  review_id     bigint references public.pms_qa_reviews(id) on delete set null,
  project       text not null,
  item_id       text,          -- pms_qa_checklist ref (nullable: ripple/external rows)
  source        text not null default 'qa' check (source in ('qa','ripple','drchecks','owner','architect','agency','other')),
  severity      text check (severity in ('life-safety','agency','rfi-bait','polish')),
  title         text not null,
  sheets        jsonb,         -- ["M601 Rev 11", "E602 Rev 15"]
  evidence      text,
  action        text,          -- suggested action at raise time
  status        text not null default 'open' check (status in ('open','ready_to_backcheck','closed','dismissed')),
  status_note   text,
  status_by     text,
  status_at     timestamptz,
  external_ref  text,          -- comment number in the source register (DrChecks id etc.)
  created_by    text not null,
  created_at    timestamptz not null default now()
);
create index if not exists pms_qa_findings_project on public.pms_qa_findings (project, status);
create index if not exists pms_qa_findings_review  on public.pms_qa_findings (review_id);

alter table public.pms_qa_reviews  enable row level security;
alter table public.pms_qa_findings enable row level security;
drop policy if exists qa_reviews_read on public.pms_qa_reviews;
create policy qa_reviews_read on public.pms_qa_reviews for select to authenticated using (true);
drop policy if exists qa_reviews_admin_all on public.pms_qa_reviews;
create policy qa_reviews_admin_all on public.pms_qa_reviews for all
  using (is_pms_admin()) with check (is_pms_admin());
drop policy if exists qa_findings_read on public.pms_qa_findings;
create policy qa_findings_read on public.pms_qa_findings for select to authenticated using (true);
drop policy if exists qa_findings_admin_all on public.pms_qa_findings;
create policy qa_findings_admin_all on public.pms_qa_findings for all
  using (is_pms_admin()) with check (is_pms_admin());
