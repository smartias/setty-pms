-- QA reviews: the item-by-item checklist result and the design narrative,
-- kept on the review row so the QA Reviews tab can show them.
--
-- Until now a review left two things in the PMS: its findings (the punch
-- list) and a one-line coverage note. Whether each checklist item had been
-- looked at, and the brief narrative of the design as read from the drawings,
-- lived only in a markdown report filed to SharePoint. Per Sara (2026-11-16)
-- the report file is not wanted: the checklist results and the narrative
-- belong in the PMS.
--
--   pms_qa_reviews.checklist_results  [{ itemId, disposition, note }]
--       one entry per checklist item the review worked. disposition is one of
--       clean / finding / flag / partial / not attempted / n/a. It records
--       whether the item was looked at; it is not a sign-off.
--   pms_qa_reviews.design_narrative   the "Design as read" text: a draft read
--       from the drawings by the review, never the engineer's Basis of Design.
--
-- Written by record_qa_findings (the connector, service role). Read by the
-- tab under the existing qa_reviews_read policy; no new policy is needed.

alter table public.pms_qa_reviews
  add column if not exists checklist_results jsonb,
  add column if not exists design_narrative  text;
