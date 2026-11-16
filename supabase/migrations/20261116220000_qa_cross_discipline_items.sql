-- QA checklist: cross-discipline coordination items (qa-610 series).
--
-- The checklist mostly tests the MEPFP set against itself. A comparison of a
-- QA review of BPL New Lots' 100% CD set with that project's RFI log
-- (2026-11-16) showed where that falls short: the review found 33 problems
-- inside the MEPFP sheets and matched none of the RFIs, and 18 of the 25 RFIs
-- a document review could have caught were MEPFP against architecture,
-- structure, the life safety plan or a non-MEP spec section.
--
-- These seven items are the cross-discipline pass of the
-- qa-coordination-review skill (checks X-1a, X-1b, X-2 ... X-6), added to the
-- checklist so each one shows in the PMS, can be edited or disabled by QA
-- admins, and gets a tracked result in every review:
--   qa-610  X-1a  what the others ask MEPFP to provide
--   qa-611  X-1b  what MEPFP asks the others to provide
--   qa-612  X-2   fire ratings, dampers and vents vs the life safety plan
--   qa-613  X-3   structure
--   qa-614  X-4   ceiling space, chases and access
--   qa-615  X-5   devices and fixtures
--   qa-616  X-6   room names and numbers
--
-- All are 'assisted': Claude gathers the evidence, a person confirms. Each
-- depends on holding the other disciplines' drawings for the same issue; a
-- review without them reports the item 'not attempted' and asks for the set.
-- source = 'rfi-lesson', like the qa-600 series: written from an RFI log.

insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, phases, source, added_by) values
('qa-610','deliverable-qa','Cross-Discipline Coordination',1600,
 'Verify everything the architectural drawings, the door and hardware schedule and the non-MEP specifications (Divisions 08, 10, 11, 12, 14) ask MEPFP to power, alarm, supply, drain or exhaust is shown on the E, FA, P or M sheet that serves it.',
 '["Look for fire and smoke doors and shutters that close on alarm, door operators and hold-opens, motorized shades, projectors and screens, appliances, hand dryers, drinking fountains, elevators and their pits, drip pans called for under piping, heat trace.", "For each, find the circuit, the fire alarm connection, the water or drain connection, or the exhaust on our sheets.", "An item another document calls for and the MEPFP set does not show is a finding.", "BPL New Lots: spec 083513.23 called for a powered Won-Door released by fire alarm, on no A, E or FA sheet; automatic door openers at a vestibule with no power; a refrigerator with ice and water and no water line."]'::jsonb,
 'assisted',
 'find_document and read_document on the spec book for Divisions 08, 10, 11, 12, 14; search_drawings or view_drawing (direct mode) on the architectural plans and the hardware and appliance schedules; then search_drawings on E, FA, P, M for the same item',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-bpl'),
('qa-611','deliverable-qa','Cross-Discipline Coordination',1610,
 'Verify everything the MEPFP sheets hand to another discipline (by architect, by structural, by others, architecturally-provided, refer to architectural) is actually shown in that discipline''s documents, as our note needs it.',
 '["Collect every hand-off note on the M, E, P, FP and FA sheets: general notes, keynotes, sequences, smoke control and purge notes, details.", "Write down what each needs: the item, where, and any number (a free area, a rating in hours, a size, a clearance).", "Find it on the other discipline''s plan, schedule or keynote and in their spec. Missing is a finding; so is shown differently.", "A note that only defers (refer to architectural plans for exact locations) is a flag: name the sheet of theirs that has to carry the answer.", "BPL New Lots: a post-fire smoke purge relied on a breakable skylight of 40.25 sq ft free area where the architect specified a fixed skylight under a steel screen; storm piping to be concealed by the architect in an electrical room with no enclosure drawn."]'::jsonb,
 'assisted',
 'search_drawings on our sheets for BY ARCHITECT, BY OTHERS, BY G.C., REFER TO ARCH, SEE STRUCT, ARCHITECTURALLY-PROVIDED, N.I.C., and for rated enclosures, access panels, louvers, breakable or operable openings, pads, curbs, sumps, sleeves, beam penetrations; then view_drawing (direct mode) on the other discipline''s sheet at that location',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-bpl'),
('qa-612','deliverable-qa','Cross-Discipline Coordination',1620,
 'Verify fire dampers, fire smoke dampers and shaft, stair and elevator vents agree with the rated walls, shafts and floors on the life safety plan, and that the life safety plan agrees with the architectural wall types.',
 '["Every duct, transfer opening and outside-air path crossing a rated wall, shaft or floor has a fire or fire smoke damper on the mechanical plan; smoke dampers have power on E and monitoring on FA.", "Check the reverse: dampers drawn at walls the life safety plan does not rate.", "Wall ratings that differ between the architectural wall tags and the life safety plan are a finding for the architect, and change our damper count either way.", "Stair, elevator and shaft vents: same location and type on A, M and FA.", "BPL New Lots: wall types tagged 2-hour on the plans where the life safety plan showed 1-hour; fire dampers on transfer ducts only, none on supply branches through the same walls; ducts crossing a stair in a rated soffit the life safety plan did not show."]'::jsonb,
 'assisted',
 'view_drawing (direct mode) on the life safety or code sheet and the wall type sheet; search_drawings on M plans for FD, FSD, SD; view_drawing on the M plan at each rated wall crossing; search_drawings on E and FA for the smoke damper tags',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-bpl'),
('qa-613','deliverable-qa','Cross-Discipline Coordination',1630,
 'Verify MEPFP work clears the structure: underslab piping and conduit against footings and grade beams, mains and sprinkler heads against beams and joists, and equipment supports, openings and penetrations against what structural shows and allows.',
 '["Underslab sanitary, storm and conduit against footings, grade beams and wall footings on the foundation plan; inverts stated where a pipe passes a footing.", "Beams, joists and timber members against duct mains, sprinkler mains and the heads above ceilings.", "Roof and floor openings, equipment weights, supports and dunnage height against the structural plans.", "Penetrations through beams, mass timber or post-tensioned slabs: shown to structural, within the limits on the structural details.", "BPL New Lots: elevator sump in a different corner on plumbing and on the foundation plan; glulam beam penetrations scheduled only by the architect, some larger than the unreinforced limit on the structural detail."]'::jsonb,
 'assisted',
 'view_drawing (direct mode) on the foundation and framing plans beside our underslab and floor plans for the same area; read_drawing_schedule for equipment weights; read the structural penetration detail for its limits',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-bpl'),
('qa-614','deliverable-qa','Cross-Discipline Coordination',1640,
 'Verify equipment above ceilings can be reached and fits: an access panel is drawn at every unit above a ceiling that is not lay-in tile, nothing blocks its service side, the plenum is deep enough, and every riser and pipe drop has a chase or wall on the architectural plan.',
 '["List every fan coil, VAV and CAV box, fan, damper actuator, control or balancing valve and cleanout above a ceiling, with its room.", "Give each room its ceiling type and height from the RCP. Gypsum board, plaster, acoustic plaster, wood slats and exposed structure are not accessible.", "Each item above a non-accessible ceiling needs an access panel drawn on the RCP or the mechanical plan. A general clearance note does not count.", "At each unit, check for a light fixture, soffit, operable partition track, stair, beam or our own pipe on the access side.", "Do the depth sum with numbers at the lowest ceiling on each floor, every corridor, and every place a duct main crosses a beam line.", "Trace every riser to a chase on each floor, and every fixture drop to a partition that can hold it."]'::jsonb,
 'assisted',
 'read_drawing_schedule on the M schedules for the unit list and heights; view_drawing (direct mode) on the RCPs, building sections and framing plans; view_drawing on the M plan at each unit; report the table of locations the skill asks for',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-bpl'),
('qa-615','deliverable-qa','Cross-Discipline Coordination',1650,
 'Verify devices and fixtures do not land where the architect put something else: devices on curtain wall, glazing, millwork or movable partitions have a mounting detail and height; lights, diffusers, sprinkler heads and access panels do not compete on the RCP; plumbing fixtures match the architectural plans and fixture schedule in count, type and location.',
 '["Devices and outlets on curtain wall, glazing, millwork or movable partitions: mounting detail and height given.", "Lights, diffusers, sprinkler heads and access panels in the same ceiling space on the RCP.", "Plumbing fixture count, type, model and location against the architectural fixture schedule and plans; floor drains shown by the architect and not by plumbing, or the reverse.", "BPL New Lots: floor drains drawn by the architect in the electrical and IT rooms and not on plumbing; a water closet model that differed between the two schedules."]'::jsonb,
 'assisted',
 'view_drawing (direct mode) on the architectural plans, RCPs and fixture and appliance schedules; read_drawing_schedule on the P fixture schedule; search_drawings on our plans for the same rooms',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-bpl'),
('qa-616','deliverable-qa','Cross-Discipline Coordination',1660,
 'Verify room names and numbers on the M, E, P and FP schedules, panel circuit descriptions and sequences of operation match the current architectural plans.',
 '["Equipment schedule location columns, panel schedule circuit descriptions, sequence text and riser labels.", "The same room carrying two numbers across our own sheets is the usual sign the architect renumbered.", "A room number used twice on the architectural plan is a finding for the architect.", "BPL New Lots: the main electrical room, main IT room and plumbing room each carried two or three different numbers across the M, E and P schedules; panel schedules named rooms that were not on the architectural plans."]'::jsonb,
 'assisted',
 'read_drawing_schedule on the M and P equipment schedules and the E panel schedules for their location and description columns; search_drawings or view_drawing (direct mode) on the architectural plans for the room list; compare',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-bpl')
on conflict (item_id) do nothing;
