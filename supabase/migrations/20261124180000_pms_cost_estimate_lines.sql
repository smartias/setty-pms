-- pms_cost_estimate_lines: the line-by-line detail of a reviewed cost estimate.
--
-- A cost estimate review (project.costEstimateReviews in the project record,
-- written by the connector's save_cost_estimate_review) holds totals: the
-- construction cost and an amount per discipline. This table holds every line
-- of the estimate behind one review, so the next estimate can be compared line
-- by line and the engineer can search an estimate without opening the file.
--
--   review_id   the review's id in project.costEstimateReviews
--   line_no     order within the review, 1-based
--   sheet       workbook sheet the line came from
--   row_ref     where it was read: 'Sheet!R45' for a workbook, 'p.14' for a PDF
--   section     the heading the line sits under, as the estimate words it
--   code        the estimate's own item or CSI code
--   discipline  mechanical | electrical | plumbing | fireProtection | technology,
--               from the heading, code or sheet; null for everything else
--   is_subtotal a total or subtotal row: kept, and left out of sums
--   source      'workbook' = read cell by cell from the file by the connector;
--               'transcribed' = typed out by the reviewer from a PDF, so a
--               number can be wrong and is checked against the document
--   verified    transcribed lines only: true = the amount was found printed in
--               the PDF's text, false = it was not (check it), null = not
--               checked (no amount, or a scanned PDF with no text). Workbook
--               lines are always true.
--
-- Written only by the connector (service role): save_cost_estimate_lines
-- replaces a review's lines as a set. Construction cost is fee data, so rows
-- are readable only by a signed-in user with the fees permission on the project.

create table if not exists public.pms_cost_estimate_lines (
  id            bigserial primary key,
  project       text not null,
  review_id     text not null,
  document_name text,
  item_id       text,
  line_no       integer not null,
  sheet         text,
  row_ref       text,
  section       text,
  code          text,
  discipline    text check (discipline is null or discipline in ('mechanical','electrical','plumbing','fireProtection','technology')),
  description   text not null,
  quantity      numeric,
  unit          text,
  unit_cost     numeric,
  amount        numeric,
  is_subtotal   boolean not null default false,
  source        text not null default 'transcribed' check (source in ('workbook','transcribed')),
  verified      boolean,
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (project, review_id, line_no)
);
create index if not exists pms_cost_estimate_lines_review on public.pms_cost_estimate_lines (project, review_id, line_no);
create index if not exists pms_cost_estimate_lines_discipline on public.pms_cost_estimate_lines (project, discipline);

alter table public.pms_cost_estimate_lines enable row level security;
drop policy if exists cost_estimate_lines_read on public.pms_cost_estimate_lines;
create policy cost_estimate_lines_read on public.pms_cost_estimate_lines
  for select to authenticated using (public.pms_has_cap('fees.view', project));
drop policy if exists cost_estimate_lines_admin_all on public.pms_cost_estimate_lines;
create policy cost_estimate_lines_admin_all on public.pms_cost_estimate_lines for all
  using (is_pms_admin()) with check (is_pms_admin());
