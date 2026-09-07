-- Severity gains 'cost' (per Sara, 2026-09-07): large-cost exposure is its
-- own attention class, ranking between agency and rfi-bait. Priority order
-- the tools and skill honor: life-safety > agency > cost > rfi-bait >
-- polish, with EXTERNAL-source rows (drchecks/owner/architect/agency)
-- outranking internal rows of the same severity - reviewer comments get
-- worked first. Post-bid, cost weighs heavier still: after bid issuance
-- every change is a potential change order.
alter table public.pms_qa_findings drop constraint if exists pms_qa_findings_severity_check;
alter table public.pms_qa_findings add constraint pms_qa_findings_severity_check
  check (severity in ('life-safety','agency','cost','rfi-bait','polish'));
