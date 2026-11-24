-- QA checklist: fire alarm against mechanical (qa-639).
--
-- On 2026-11-24 the preventable RFIs in pms_rfi_root_causes that still
-- matched no checklist item were read again. One kind repeats across projects
-- and no item covers it (3 RFIs, 2 projects): the fire alarm set and the
-- mechanical set disagree on fire smoke dampers and duct detectors, or the
-- fire alarm matrix names an interface without saying what it does.
--
-- Two other kinds found in the same reading need no new item: scheduled
-- numbers that cannot both be true are qa-638 (20261124200000, schedule
-- arithmetic), and content left over from another project is qa-231.
--
-- The count is small and comes from Claude's reading of the log notes.
-- 'assisted'. source = 'rfi-lesson', like the qa-630 series.

insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, phases, source, added_by) values
('qa-639','deliverable-qa','RFI History',1890,
 'Verify the fire alarm and mechanical drawings show the same fire smoke dampers and duct smoke detectors, and that the fire alarm input/output matrix says what each interface does: no interface named without its action.',
 '["qa-612 checks dampers against the rated walls and shafts. This item checks the two sets that both draw them against each other.", "Count: the fire smoke dampers and duct smoke detectors on the mechanical plans and schedules against the monitor and control modules and detectors on the fire alarm plans and riser. The counts agree, floor by floor.", "Who provides: the duct detector and the damper actuator are assigned to one trade, and the 120V or 24V power for each is on an electrical sheet.", "Matrix: every input (waterflow, tamper, duct detector, elevator recall, kitchen hood) has a row, and every output names the equipment it acts on. Where a building has wings or zones, bells and strobes say which zone they sound in.", "Interfaces named in a note (IT, AV, DAS, ERRCS, BMS, elevator, access control): each has a row in the matrix and a location for its head-end or tie-in point, or it is removed from the note.", "RFIs: Girls Club fire alarm set showing 35 dampers and 35 duct detectors against 46 and 13 on mechanical; Tabler waterflow bells not assigned to East, West or Commons, and a note calling for fire alarm interfaces with IT, AV and DAS with no matrix rows and no ERRCS head-end location."]'::jsonb,
 'assisted',
 'search_drawings for FSD, FIRE SMOKE DAMPER, DUCT DETECTOR, DUCT SMOKE on the M and FA sheets and count per floor; read_drawing_schedule on the damper schedule; view_drawing on the fire alarm riser and the input/output matrix; search_drawings on the FA general notes for INTERFACE, ERRCS, DAS, BMS, ELEVATOR RECALL',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-24-fa-mechanical')
on conflict (item_id) do nothing;
