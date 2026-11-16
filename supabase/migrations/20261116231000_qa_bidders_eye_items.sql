-- QA checklist: bidder's eye items (qa-620 series).
--
-- About half of Tabler Quad's RFI log (roughly 137 of 276) was bid RFIs,
-- asked within weeks of issue. They are mostly not engineering questions:
-- who provides it, which trade wires it, how many, which spec section
-- governs, where the work stops. A design review reads the set as its
-- author; these five items read it as someone who has to put a price on it.
--
--   qa-620  who provides it: by others / by owner / N.I.C. names a party
--   qa-621  division of work between M, P, FP and E for every motor
--   qa-622  can it be counted and priced
--   qa-623  the spec book as one set, basis of design still made
--   qa-624  site, utility and temporary service interfaces
--
-- CD, permit, bid and addendum sets only: a DD set is not priced by bidders.
-- All 'assisted'. source = 'rfi-lesson', like the qa-600 and qa-610 series.

insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, phases, source, added_by) values
('qa-620','deliverable-qa','Bidder''s Eye',1700,
 'Verify every item marked by others, by owner, by G.C., N.I.C. or furnished-by names the party that provides it, and that the other party''s documents agree.',
 '["Collect every ''by others'', ''by owner'', ''by G.C.'', ''N.I.C.'', ''furnished by'', ''installed by'' and ''by campus'' or ''by utility'' note on the MEPFP sheets and in Divisions 21 to 28.", "Each one names a party. ''By others'' with no party is a finding: a bidder cannot price it and will ask.", "Find the same item in that party''s documents (another spec division, the architect''s sheets, the owner''s standards). If they also call it by others, nobody has it.", "Split items need both halves: furnished by one party and installed or wired by another.", "Tabler Quad: door holders powered on E with holders ''by campus access control'' and no door list; temporary power and phone raised by four bid RFIs; door security wiring by the owner."]'::jsonb,
 'assisted',
 'search_drawings on the M, E, P, FP, FA sheets for BY OTHERS, BY OWNER, BY G.C., N.I.C., FURNISHED BY, INSTALLED BY; read_document on the spec sections'' ''related work'' and ''work by others'' articles; then find the item in the other party''s sheet or section',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-tabler-bid'),
('qa-621','deliverable-qa','Bidder''s Eye',1710,
 'Verify the division of work between mechanical, plumbing, fire protection and electrical for every motor and powered item: who furnishes and installs the starter, disconnect, VFD, control wiring and interlocks, stated the same way on both sets.',
 '["For each motor and powered unit on the M, P and FP schedules: starter, disconnect, VFD, control transformer, control wiring, fire alarm interlock.", "Each is furnished by one trade and installed and wired by a named trade, and the E schedule or one-line shows the same split.", "A disconnect scheduled ''by Div 26'' on mechanical and absent from electrical is a finding; so is one shown by both.", "Control wiring for fans, dampers and pumps: which division, and where the sequence says so.", "Tabler Quad: RFIs on the chiller disconnect and on exhaust and supply fan controls."]'::jsonb,
 'assisted',
 'read_drawing_schedule on the M, P, FP equipment schedules for their starter, disconnect and VFD columns and notes; read_drawing_schedule on the E equipment connection schedule; search_drawings for DIV 26, DIVISION 23, BY ELECTRICAL, BY MECHANICAL, CONTROL WIRING; read the spec ''motors'' and ''controls'' sections',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-tabler-bid'),
('qa-622','deliverable-qa','Bidder''s Eye',1720,
 'Verify a bidder can count and price everything shown: every device, fixture and piece of equipment is tagged and scheduled, quantities and extents are stated, and nothing appears on another discipline''s sheets that ours omit.',
 '["Untagged fixtures, devices or equipment on a plan; a tag with no schedule row; ''typical'' with no stated extent or count.", "Lighting, devices or equipment drawn on the architectural sheets and not on ours, or laid out differently.", "Alternates, allowances and unit prices named in Division 01 are identifiable on the drawings, and the reverse.", "A wiring method or installation the documents require but do not show a way to do (conduit in an exposed ceiling, power to a slab-mounted item).", "Tabler Quad bid RFIs: untagged lighting on the architectural drawings, a lighting layout that differed between A and E, no stated way to run power in exposed plank ceilings."]'::jsonb,
 'assisted',
 'find_equipment and read_drawing_schedule to reconcile tags against schedules; view_drawing (direct mode) on the architectural RCPs and plans beside our lighting and power plans; read_document on Division 01 alternates and allowances',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-tabler-bid'),
('qa-623','deliverable-qa','Bidder''s Eye',1730,
 'Verify the specification book reads as one set to a bidder: no section issued twice, no section referenced that is not in the book, no section for work the drawings do not have, and each basis-of-design product is still made.',
 '["Table of contents against the sections in the book: duplicates in two versions, missing sections, wrong numbers.", "Sections that refer to another section that was not issued.", "Sections for systems the project does not have (left from a prior project), and drawn systems with no section.", "Basis-of-design model numbers for major equipment: confirm with the manufacturer''s current literature that the model is still offered. A discontinued basis of design becomes an RFI on bid day.", "Tabler Quad: two versions of the sprinkler section; a fan coil cassette that had been discontinued. BPL New Lots: a discontinued DOAS unit."]'::jsonb,
 'assisted',
 'find_document docType Spec and read_document on the table of contents, then on each MEPFP section''s first page; search the manufacturer''s site for each basis-of-design model where web access is available, otherwise mark that part not attempted',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-tabler-bid'),
('qa-624','deliverable-qa','Bidder''s Eye',1740,
 'Verify the points where the building work meets the site, the utilities and temporary services are assigned and dimensioned: each service entry has a size, an invert or elevation and a named limit of work, and temporary power, water and heat are assigned.',
 '["Each utility at the building line: size, material, invert or elevation, and where our work stops and civil''s or the utility''s starts (5 ft outside the building is the usual limit; say it).", "The same value on our riser or plan and on the civil utility plan.", "Utility company work against contractor work: service conductors, meter, transformer pad, gas regulator, backflow and meter pit.", "Fire department connection, hydrant and site lighting: which discipline shows it, and that only one does.", "Temporary power, water, heat and phone during construction: Division 01 assigns them.", "Tabler Quad: RFIs on the fire department connection location, clearance between manholes and the HTHW trench, and temporary power and phone at bid."]'::jsonb,
 'assisted',
 'search_drawings on our plans and risers for the service entries and INV; view_drawing (direct mode) on the civil utility plan and profiles; read_document on Division 01 temporary facilities',
 '["CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-16-tabler-bid')
on conflict (item_id) do nothing;
