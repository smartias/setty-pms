-- QA reviews: a status the QA Reviews tab can show while a review is running.
--
-- A review used to reach the PMS only when it was recorded at the end, so for
-- the half hour or more it takes there was nothing to see, and no way to tell
-- a review still working from one whose session had died. Per Sara
-- (2026-11-16) the tab should show where a running review stands.
--
--   pms_qa_reviews.status         running / complete / stopped. NULL on rows
--                                 recorded before this (read as complete).
--   pms_qa_reviews.progress_step  the step it is on ("Pass 1: checklist")
--   pms_qa_reviews.progress_note  one line of detail (areas done, what is next,
--                                 or why it stopped)
--   pms_qa_reviews.progress_at    when it last reported. A running row that has
--                                 not reported for a long while is shown as
--                                 probably ended, never as still running.
--
-- Written by set_qa_review_progress (opens the row at the start of a review
-- and updates it at each step) and by record_qa_findings (marks it complete).
-- Read by the tab under the existing qa_reviews_read policy.

alter table public.pms_qa_reviews
  add column if not exists status        text,
  add column if not exists progress_step text,
  add column if not exists progress_note text,
  add column if not exists progress_at   timestamptz;

alter table public.pms_qa_reviews drop constraint if exists pms_qa_reviews_status_check;
alter table public.pms_qa_reviews
  add constraint pms_qa_reviews_status_check
  check (status is null or status in ('running', 'complete', 'stopped'));
