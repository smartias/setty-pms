-- pms_engineering_standards.status was limited to ('active','superseded'), so
-- the review-queue rows staged by 20261002120100_stage_mechanical_standards_
-- from_qc_chats.sql ('suggested') were rejected. Widen it. Ordered before that
-- migration so a fresh replay (preview branch, local reset) inserts cleanly.
-- Already applied to production by hand (recorded there as version
-- 20261002191407); the drop/add is idempotent.
alter table public.pms_engineering_standards
  drop constraint if exists pms_engineering_standards_status_check;
alter table public.pms_engineering_standards
  add constraint pms_engineering_standards_status_check
  check (status = any (array['active'::text, 'superseded'::text, 'suggested'::text]));
