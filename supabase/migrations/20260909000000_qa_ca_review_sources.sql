-- Submittal / RFI review flow (per Sara, 2026-09-09): the CA reviewer's
-- cost/scope RED FLAGS land in the SAME findings ledger as coordination
-- review findings and external comments, so one back-check engine tracks
-- them all. A submittal that deviates from the bid documents is a cost
-- event, not just a technical one — the QA skill already says so — and
-- keeping those flags in the ledger means they get worked and backchecked
-- like any other finding instead of dying inside one submittal record.
--
-- Two enum widenings, nothing structural:
--   pms_qa_findings.source gains 'submittal' and 'rfi' — the flag's origin
--     is a CA item, not a drawing review. external_ref carries the CA
--     item number (e.g. 'SUB-012'); these rank as INTERNAL findings (a
--     deviation we caught), so QA_EXTERNAL_SOURCES deliberately does not
--     include them and an automated pass may close a 'qa'-class row but
--     these follow the same human-close courtesy as any tracked flag.
--   pms_qa_reviews.kind gains 'ca-review' — the review run that produced
--     the flags was a submittal/RFI review, distinct from a set review,
--     backcheck, or comment-log ingest.

alter table public.pms_qa_findings drop constraint if exists pms_qa_findings_source_check;
alter table public.pms_qa_findings add constraint pms_qa_findings_source_check
  check (source in ('qa','ripple','drchecks','owner','architect','agency','other','submittal','rfi'));

alter table public.pms_qa_reviews drop constraint if exists pms_qa_reviews_kind_check;
alter table public.pms_qa_reviews add constraint pms_qa_reviews_kind_check
  check (kind in ('review','backcheck','comment-log','ca-review'));
