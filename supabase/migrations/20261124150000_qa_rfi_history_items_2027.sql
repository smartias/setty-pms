-- QA checklist: three more RFI history items (qa-635 to qa-637).
--
-- For the 2027 goal of cutting preventable RFIs, the preventable RFIs in
-- pms_rfi_root_causes that matched no checklist item were read again on
-- 2026-11-24. 66 of them were the kinds qa-630 to qa-634 describe and were
-- re-tagged to those items. Of the rest, three kinds repeat across projects;
-- one item each:
--
--   qa-635  what the selected equipment needs in order to run is powered and located
--   qa-636  what the specification requires is located on a drawing
--   qa-637  the documents state a decision wherever they defer to someone else
--
-- The counts behind them are small (about 8, 9 and 11 RFIs) and come from
-- Claude's reading of the log notes, some from the subject line alone. qa-637
-- leans on one project for nine of its eleven.
-- All 'assisted'. source = 'rfi-lesson', like the qa-630 series.

insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, phases, source, added_by) values
('qa-635','deliverable-qa','RFI History',1850,
 'Verify every auxiliary component the basis-of-design equipment needs in order to run has power, a location and a pathway on the drawings: control and network panels, condensate pumps, fire alarm remote panels, monitoring wiring and service disconnects.',
 '["qa-051 checks that equipment drawn by one discipline has its utility connections on the others. This item is the parts that are not on any schedule: what the selected product brings with it.", "For each major piece of equipment, open the basis-of-design product data and list what it needs beyond its main feed: a control or network panel, an interface module, a condensate pump, a remote annunciator, a monitoring or communication cable.", "Each of those: a circuit on a panel schedule, a location on a plan, and a conduit or pathway where the wiring leaves the room or the building.", "Fire alarm: every remote panel, power supply and annunciator on the FA sheets has a 120V circuit on the electrical sheets, and every monitored point outside the building has a raceway.", "Service and fire pump: the disconnecting means is drawn on the one-line with its frame and fuse size.", "RFIs: Tabler no circuits for the fire alarm RCC panels (two RFIs) and no conduit for the generator-to-fire-alarm wiring; Medgar Evers the CRAC network switch panel with no power; Boyland condensate pumps at the VRF branch controllers not shown, and a fire pump service switch missing from the one-line; Queens College no power detail for the roof scrubber."]'::jsonb,
 'assisted',
 'read_drawing_schedule on the M and P equipment schedules for the basis-of-design models; read_document on the matching spec sections for required accessories; search_drawings for each tag on the E and FA sheets, and for CONTROL PANEL, CONDENSATE PUMP, ANNUNCIATOR, NAC, POWER SUPPLY; view_drawing on the one-line at the service and the fire pump',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-24-rfi-history'),
('qa-636','deliverable-qa','RFI History',1860,
 'Verify everything the specification or a schedule requires is located on a plan or detail: thermometers and gauges, pipe supports and vibration isolation, fire alarm remote devices, hanging and mounting accessories.',
 '["Read the spec sections for the words that send the reader to the drawings: where indicated, as shown, where required, as scheduled. Each one is a promise that a drawing shows it.", "Thermometers, gauges, test plugs and flow measuring stations: drawn on the piping diagram or detail, with the range where the spec leaves it open.", "Pipe supports, rollers, guides, anchors and vibration isolation: the systems and locations that get each type are stated.", "Fire alarm remote devices: remote command center, annunciators and remote indicating lights are on a plan.", "Fixtures and equipment hung or mounted: the mounting or hanging accessory is in the schedule or a detail.", "RFIs: Tabler thermometer locations, fire alarm RCC panel mounting and elevator remote LED locations; Farmingdale thermometer ranges, roller support locations, pipe vibration isolation and the remote command center location; Q119 the hanging accessory for pendant fixtures; Dutchess space heater and receptacle locations."]'::jsonb,
 'assisted',
 'read_document on the Division 21 to 28 sections for WHERE INDICATED, AS SHOWN, WHERE REQUIRED, AS SCHEDULED; search_drawings for the item each phrase points to (THERMOMETER, GAUGE, ROLLER, ANCHOR, ISOLATOR, ANNUNCIATOR, REMOTE); view_drawing on the piping diagrams and details',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-24-rfi-history'),
('qa-637','deliverable-qa','RFI History',1870,
 'Verify the documents state a decision wherever they defer to the owner, the authority or a code edition: no ''as allowed by owner'', ''if applicable'' or unstated code year is left for the bidder to resolve.',
 '["qa-143 removes unused specification options. This item is the options that were kept and handed to someone else to decide.", "Search the specifications and sheet notes for: as allowed by, as permitted by, as approved by owner, as directed, if applicable, if required, where permitted. Each hit either states the answer or is a finding.", "Wiring methods are the usual one: say where MC cable, EMT and flexible conduit are allowed and where they are not.", "Code edition: where two editions ask for different work (elevator communication, emergency lighting), the documents name the one that governs.", "An option that depends on another choice in the set (a battery pack where the fixture is on generator) is stated one way.", "RFIs: Tabler whether the owner allows MC cable, asked nine times at bid; Homeport which code year governs elevator emergency communication; whether EM fixtures fed from the generator need battery packs."]'::jsonb,
 'assisted',
 'read_document on the specification sections and search_drawings on the general and sheet notes for AS ALLOWED, AS PERMITTED, AS APPROVED BY, AS DIRECTED, IF APPLICABLE, IF REQUIRED, WHERE PERMITTED; search_agency_preferences and search_knowledge for the owner''s standing answer before raising it',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-24-rfi-history')
on conflict (item_id) do nothing;
