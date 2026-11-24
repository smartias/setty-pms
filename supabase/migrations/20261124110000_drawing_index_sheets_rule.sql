-- pms_drawing_index_files.sheets_rule: which drawing-list rule has numbered a
-- file's pages.
--
-- Combined drawing books index with no sheet number on any page unless the
-- architect's title block is one of the three templates parseTitleBlock knows
-- (about 10,800 of 11,800 indexed drawing pages on 2026-11-24). The connector
-- now numbers those pages from the book's own drawing list
-- (sheetFromDrawingList.ts), working from the text already stored in
-- pms_drawing_text. This column records that a file has been through that
-- pass, and under which rule set, so the pass runs once per file and can be
-- re-run for every file by changing the rule name in the code.
--
-- null = not yet looked at. The pass only ever fills sheet_no where it is
-- null, and stamps the rows it fills with title_block_layout = the rule name.
--
-- Undo the numbering (the column can stay):
--   update public.pms_drawing_text
--      set sheet_no = null, sheet_title = null, revision = null,
--          revision_date = null, revision_description = null, title_block_layout = null
--    where title_block_layout like 'drawing-list.%';
-- Rollback: alter table public.pms_drawing_index_files drop column sheets_rule;

alter table public.pms_drawing_index_files
  add column if not exists sheets_rule text;

comment on column public.pms_drawing_index_files.sheets_rule is
  'Drawing-list rule that has numbered this file''s pages (sheetFromDrawingList.ts DRAWING_LIST_LAYOUT); null = not yet processed.';
