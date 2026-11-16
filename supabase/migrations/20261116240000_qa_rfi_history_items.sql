-- QA checklist: RFI history items (qa-630 series).
--
-- 922 RFIs on 25 projects were tagged with a root cause on 2026-11-16
-- (pms_rfi_root_causes). 483 were preventable by a review before issue, and
-- 158 of those matched no checklist item. Those 158 fall into five repeating
-- kinds; one item each:
--
--   qa-630  existing conditions the design relies on were verified
--   qa-631  every new service shows its point of connection
--   qa-632  plan, schedule and spec agree on the small items
--   qa-633  every controlled item names its controller and its sequence
--   qa-634  a revision is carried to every sheet it touches
--
-- The tags came from Claude's reading of the logs, many from the subject line
-- alone, so the counts are indicative. The kinds are not in doubt: each one
-- recurs on at least three projects.
-- All 'assisted'. source = 'rfi-lesson', like the qa-600, qa-610 and qa-620 series.

insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, phases, source, added_by) values
('qa-630','deliverable-qa','RFI History',1800,
 'On a renovation, verify every existing condition the design relies on was confirmed, and that the drawings say how: each reused panel, circuit, riser, main, opening and piece of equipment is marked surveyed, taken from a named record drawing, or to be field verified by a named party.',
 '["List what the design reuses or connects to: panel spaces and circuit numbers, feeders, risers and mains, existing openings and shafts, existing equipment to remain or be relocated, existing dampers and controls.", "For each: is there a survey note, a photo, or a record drawing reference in the project folder? An existing item drawn with no source is a finding, written as the question a site visit answers.", "Circuits and panel spaces assigned to new work: the panel schedule shows them spare on a dated survey, not on the original design.", "New equipment through existing openings and into existing rooms: opening size, path in, and working clearance against what is there.", "''Relocate existing'' and ''existing to remain'' items: confirm the item exists.", "RFIs: Q119 panel CPP circuits assigned to the work were already in use; Q126 a tie-in to a hot water return that the rooms do not have; Queens College HWR lines, 4/0 feeders and a 400A switch that were not there; Oakwood existing openings too small for the selected fans and no working clearance at 11 units; a fire warden station to relocate that was never there."]'::jsonb,
 'assisted',
 'search_drawings on our sheets for EXISTING, EX., E.T.R., RELOCATE, FIELD VERIFY, V.I.F.; read_drawing_schedule on panel schedules for circuits given to new work; list_project_documents and search_field_photos for a survey, site visit report or record drawings; mark not attempted where the folder holds no survey',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-rfi-history'),
('qa-631','deliverable-qa','RFI History',1810,
 'Verify every new service, pipe, duct, feeder and cable shows where it starts and where it ends: the point of connection to the existing or upstream system is located on a plan, sized, and detailed.',
 '["Follow each new system to both ends. A line that stops at a wall, a break line or ''connect to existing'' with no location is a finding.", "At each tie-in: which existing main or riser (several may be in the same chase), its size, the connection detail, and the shutdown or isolation valve.", "Terminations: where BMS, fire alarm and metering cables land, relief valve discharge and set pressure, vents through roof, drains to a named receptor, condensate to a named drain.", "Steam and hydronic specialties at the connection: traps, strainers, supports and expansion.", "RFIs: Queens College which steam supply and return in the chase feed the new AHU, and a roof scrubber with no points of connection, power or drain receptor (six RFIs); Farmingdale steam trap requirements and meter monitoring circuitry; Dutchess no isolation valves at the hot water riser take-offs where the chilled water risers had them."]'::jsonb,
 'assisted',
 'search_drawings for CONNECT TO EXISTING, TIE-IN, POINT OF CONNECTION, P.O.C., TERMINATE, DISCHARGE TO; view_drawing on each hit and on the riser diagrams to follow the line to its end; read_drawing_schedule for relief valve and meter rows',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-rfi-history'),
('qa-632','deliverable-qa','RFI History',1820,
 'Verify plan, schedule, detail and specification agree on the small items: circuit numbers on plans against the panel schedule, material and construction of ductwork, piping and accessories, device ratings, and mounting heights.',
 '["qa-602 covers major equipment against the specification. This item is everything smaller, where most of the disagreements were.", "Circuiting: each homerun on a plan appears on the panel schedule with the same load and breaker, and each scheduled circuit is on a plan.", "Material and construction: duct material, gauge, lining and coating; pipe material and joining; jacket and insulation, as stated in the spec part 2, the spec part 3, the schedule, the detail and the plan note. One answer in all five.", "Accessories and specialties: grilles, dampers, goosenecks, hangers, vibration isolation, flexible connections: detail against plan against schedule.", "Device ratings and mounting heights: a sheet note against what is drawn (candela, NEMA rating, mounting height).", "RFIs: Oakwood fan type and duct and gooseneck material differing between spec 239000, the H-003 schedule and review comments (six RFIs); Tabler detail 5 on M701 aluminum-jacket outdoor duct against a spec calling for stainless, and E503 note limiting strobes to 110cd with 177cd devices drawn; Boyland a hard-mounted FCU filter box in a detail against flexible connections on plans."]'::jsonb,
 'assisted',
 'read_drawing_schedule on panel schedules and on the air device, duct and pipe material schedules; search_drawings for the material words (STAINLESS, ALUMINUM, GALVANIZED, DOUBLE WALL, LINED) and for MOUNTING HEIGHT, A.F.F., CANDELA; read_document on the matching spec sections, parts 2 and 3',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-rfi-history'),
('qa-633','deliverable-qa','RFI History',1830,
 'Verify every controlled item names what controls it: each fan, pump, heater, damper, valve and packaged unit is either on the BMS points list with a sequence, or stated as stand-alone with its thermostat or switch located on a plan.',
 '["qa-603 checks that riser, detail and controls diagram agree. This item checks that every piece of equipment is in the controls scope at all.", "Build the list from the equipment schedules. For each row: on the points list, or stand-alone? ''BMS if applicable'' and silence are both findings.", "Stand-alone items: the thermostat, sensor or switch is drawn on a plan, and electrical shows its power.", "Packaged equipment with its own controller: what the BMS reads or commands, and who provides the interface card.", "Control valves and dampers: flow rate or size, fail position, and the actuator power source.", "Gas detection, leak detection and refrigerant monitoring: who provides it, what it alarms to, and what it shuts down.", "RFIs: SUNY OW whether the Siemens BMS controls the electric unit heaters (two RFIs); Homeport EUH-15 with no thermostat and one thermostat for fan coils on different condensing units; Farmingdale about 23 controls and fire alarm RFIs from the controls contractor; ''BMS if applicable'' on three projects."]'::jsonb,
 'assisted',
 'read_drawing_schedule on every M and P equipment schedule to list the equipment; search_drawings for each tag on the controls and points list sheets; search_drawings for BMS, BAS, DDC, THERMOSTAT, STAND-ALONE, IF APPLICABLE; read_document on the controls specification scope article',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-rfi-history'),
('qa-634','deliverable-qa','RFI History',1840,
 'On an addendum, bulletin or conformed set, verify each change was carried to every sheet and specification section it touches, in every discipline.',
 '["For each changed item in the revision: list the other places the same item appears (plan, riser, schedule, detail, keynote, panel schedule, specification, and the other disciplines'' sheets).", "Open each of those at the newest revision. One that still shows the old condition is a finding, with both sheets named.", "Removed items: nothing still powers, drains, controls or refers to them.", "Background and reference changes: grid names, room numbers and room names on our backgrounds match the architect''s current set.", "A conformed set against the bid set plus addenda: every addendum item is in it.", "RFIs: Medgar Evers Bulletin 2 removed smoke dampers and duct detectors on FA-200 while E-200 still showed their power; a conformed set that differed from the bid set; stale grid names on mechanical backgrounds."]'::jsonb,
 'assisted',
 'search_drawings on the revision''s subfolder to list what changed, then search_drawings for each changed tag or note across the current sets and read its history (absentAt, stillPresentAtLatest); view_drawing on any sheet that did not change but shows the item',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-rfi-history')
on conflict (item_id) do nothing;
