-- QA checklist: two more RFI history items (qa-638, qa-639).
--
-- On 2026-11-24 the 66 preventable RFIs in pms_rfi_root_causes that still
-- matched no checklist item were read again. 27 of them are logged with a
-- subject line only and cannot be judged. Of the rest, two kinds repeat
-- across projects and no item covers them; one item each:
--
--   qa-638  what is scheduled or keynoted can be bought and can do what the
--           schedule asks                              (8 RFIs, 4 projects)
--   qa-639  the fire alarm and mechanical sets agree on dampers and duct
--           detectors, and the matrix defines every interface
--                                                      (3 RFIs, 2 projects)
--
-- A third kind, content left over from another project (4 RFIs, 3 projects),
-- is already qa-231; those RFIs are re-tagged to it, not given a new item.
--
-- The counts are small and come from Claude's reading of the log notes.
-- Both 'assisted'. source = 'rfi-lesson', like the qa-630 series.

insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, phases, source, added_by) values
('qa-638','deliverable-qa','RFI History',1880,
 'Verify what is scheduled or keynoted can be bought and can do what the schedule asks: capacities agree with each other, the named product exists in that configuration, and it holds what the plan puts in it.',
 '["qa-602 checks that the specification and the drawings name the same equipment. This item asks whether that equipment, as scheduled, is possible.", "Air and heat: for each unit with a heating or cooling coil, airflow, capacity and entering and leaving temperatures agree (BTU/h = 1.08 x cfm x temperature rise for air). A unit whose scheduled heat needs more air than it moves is a finding.", "Basis of design: the named model and size is made with the scheduled options (coil type, voltage, capacity) and meets the scheduled leaving conditions.", "Panels: the panel voltage matches its source on the one-line; the breaker types called for (GFCI, GFPE, shunt trip) are made at the scheduled interrupting rating; the enclosure size is one the manufacturer offers.", "Boxes and controllers: a floor or wall box holds the devices the plan puts in it; a lighting or control panel has as many zones or points as the plan uses.", "Fixture and accessory schedules: no two tags of different types carry the same model, and each product suits the assembly it sits in.", "RFIs: Homeport MAU-1 scheduled 1700 cfm with 42 kW of heat, and GFCI breakers at an interrupting rating not made; Remsen Hall a basis-of-design unit that cannot meet its scheduled leaving air temperature; an SCA floor box too small for the devices shown; Girls Club six lighting zones on a four-zone controller and one sink model under two fixture tags."]'::jsonb,
 'assisted',
 'read_drawing_schedule on the M, P and E equipment, fixture and panel schedules; view_drawing on the one-line for each panel''s source voltage and interrupting rating; read_document on the matching spec section and on the basis-of-design product data when it is filed; search_drawings for each floor box, lighting control panel and keynoted product to count what the plan puts in it',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-24-buildable-fa'),
('qa-639','deliverable-qa','RFI History',1890,
 'Verify the fire alarm and mechanical drawings show the same fire smoke dampers and duct smoke detectors, and that the fire alarm input/output matrix says what each interface does: no interface named without its action.',
 '["qa-612 checks dampers against the rated walls and shafts. This item checks the two sets that both draw them against each other.", "Count: the fire smoke dampers and duct smoke detectors on the mechanical plans and schedules against the monitor and control modules and detectors on the fire alarm plans and riser. The counts agree, floor by floor.", "Who provides: the duct detector and the damper actuator are assigned to one trade, and the 120V or 24V power for each is on an electrical sheet.", "Matrix: every input (waterflow, tamper, duct detector, elevator recall, kitchen hood) has a row, and every output names the equipment it acts on. Where a building has wings or zones, bells and strobes say which zone they sound in.", "Interfaces named in a note (IT, AV, DAS, ERRCS, BMS, elevator, access control): each has a row in the matrix and a location for its head-end or tie-in point, or it is removed from the note.", "RFIs: Girls Club fire alarm set showing 35 dampers and 35 duct detectors against 46 and 13 on mechanical; Tabler waterflow bells not assigned to East, West or Commons, and a note calling for fire alarm interfaces with IT, AV and DAS with no matrix rows and no ERRCS head-end location."]'::jsonb,
 'assisted',
 'search_drawings for FSD, FIRE SMOKE DAMPER, DUCT DETECTOR, DUCT SMOKE on the M and FA sheets and count per floor; read_drawing_schedule on the damper schedule; view_drawing on the fire alarm riser and the input/output matrix; search_drawings on the FA general notes for INTERFACE, ERRCS, DAS, BMS, ELEVATOR RECALL',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-24-buildable-fa')
on conflict (item_id) do nothing;
