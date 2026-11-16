-- QA checklist: RFI prevention items (qa-600 series).
--
-- QA is proactive: its purpose is to remove the causes of RFIs and change
-- orders before a set goes out. The record of what contractors actually
-- asked is the best evidence of what a pre-issue review should look for, so
-- these four items were written from one project's RFI log (SUNY Stony Brook
-- Tabler Quad, 276 RFIs, classified 2026-11-16). Each is a way the documents
-- disagreed with themselves; several were asked at bid and again in
-- construction. A test QA review of that project's 100% CD set, run without
-- these items, found 25 other discrepancies and almost none of the ones that
-- became RFIs, because nothing on the checklist pointed at them.
--
-- Roughly a quarter of that log's document-caused RFIs fall under these four:
--   keynote / note sizes vs the feeder schedule      ~10 issue groups
--   keynote legend defects                            ~3
--   specifications vs drawings                        ~12
--   riser vs detail vs controls diagram               ~4
--
-- Rows are content, like the rest of pms_qa_checklist: QA admins can edit or
-- disable them in the Admin Console. Phase-restricted to the sets that carry
-- the content (a schematic set has no feeder schedule or spec book).
-- source = 'rfi-lesson' marks an item as written from an RFI log, so the next
-- project's lessons can be added the same way and counted.

insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, phases, source, added_by) values
('qa-600','deliverable-qa','RFI Prevention',1500,
 'Verify every conduit, conductor and feeder size stated in a keynote, plan note, site-plan note or one-line keynote matches the feeder schedule.',
 '["Read the feeder schedule row for each feeder a note names: service, chiller, fire pump, generator, ATS, duct banks, panel feeders.","Compare size, number of sets, conduit type (Schedule 40 / 80) and any fire rating (2-hour) between the note and the schedule.","Compare the same feeder across EVERY sheet that notes it: a size corrected on one plan and left on another comes back as a second RFI.","Tabler: chiller feeder 4 inch on E211 and E401 vs 2-1/2 inch on the feeder schedule; duct bank conduit 2, 2-1/2 and 4 inch in three places; 2-hour rating in a keynote and not in the schedule."]'::jsonb,
 'assisted',
 'read_drawing_schedule on the feeder schedule sheet (view_drawing by region if the table has no title); search_drawings on E plans, site plans and one-lines for CONDUIT, KCMIL, SETS OF, 2 HR, SCHEDULE 40/80; compare per feeder',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16'),
('qa-601','deliverable-qa','RFI Prevention',1510,
 'Verify each sheet''s keynote legend is complete and correct: every keynote used on the plan is in the legend, no number appears twice, no two keynotes are swapped, and none points to a sheet or detail that is not in the set.',
 '["A keynote on an item marked existing-to-remain is a contradiction: say which governs.","Check that a keynote''s text is about the thing it is attached to (swapped keynotes read correctly one at a time).","Tabler: keynote 13 on an existing pole with no legend entry; keynotes 17 and 18 swapped; two keynotes numbered 20 on one sheet; a note citing a sheet that does not exist."]'::jsonb,
 'assisted',
 'search_drawings (subfolder pinned to the set) for the keynote legend text per sheet; view_drawing on the legend region and on the tagged area to confirm',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16'),
('qa-602','deliverable-qa','RFI Prevention',1520,
 'Verify the specifications and the drawings describe the same major equipment: type, basis-of-design manufacturer and required accessories agree, the spec table of contents matches the sections in the book, and no section refers to one that was not issued.',
 '["Equipment to compare: chiller, air handling, boilers and heat exchangers, pumps, generator and load bank, switchgear, fire pump, fire alarm panel and annunciator, elevators, air compressors.","Table of contents vs sections present: a section listed and missing, a wrong section number, the same section included twice in two versions.","A construction or material shown on a detail with no spec behind it (double-wall duct, duct gauge), and the reverse.","If the spec book is not in the project library, mark this item not attempted and say so: reviewing the drawings alone leaves this whole class of RFI uncovered.","Tabler: traction elevator in the spec vs hydraulic shunt-trip diagram; graphic annunciator in the spec vs alphanumeric on the drawings; fire pump section listed under the wrong number; a sprinkler section issued twice; sections citing a power-monitoring section never issued."]'::jsonb,
 'assisted',
 'find_document docType Specification then read_document on the TOC and the equipment sections; read_drawing_schedule and search_drawings for the same equipment on the drawings',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16'),
('qa-603','deliverable-qa','RFI Prevention',1530,
 'Verify each valve, damper and control device is shown consistently on the riser diagram, the piping or installation detail, and the controls or flow diagram.',
 '["Every isolation and control valve on one of the three appears on the others, on the same side (supply or return).","Every damper or device on a control schematic has a line in the sequence of operation and is drawn on the plans.","Hardwired points on a schematic vs DDC in the sequence is the same kind of conflict.","Tabler: heat exchanger secondary valves on the riser, absent from the detail and the control diagram (asked at bid and again in construction); fan coil control valve on the return in the riser and on the supply in the detail; an isolation damper on a schematic with no sequence."]'::jsonb,
 'assisted',
 'search_drawings for the equipment tag to find its riser, detail and controls sheets; view_drawing each at the equipment and compare valve by valve',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16')
on conflict (item_id) do nothing;
