# Plumbing QC candidate engineering standards (READ-ONLY extraction)

Project: "Eng - Plumbing Quality Control Reviewer" (claude_proj_011CXuNq84Vmugf1xek49svj). Chats since 2026-06-01 (46 listed, 2 deleted).
KEY SOURCE: the firm document "Setty_Plumbing_QC_Reviewer_v1.0" (Feb 2026) was printed in full inside chat claude_chat_019tMkVBRsAY5FhL2Vc88A9s (including the engineer's embedded review comments). Items sourced from it are "firm document" items. Everything else is Claude output and unverified.
Discipline for all items: Plumbing.

====================================================================
## DOMESTIC WATER
====================================================================

### D1 (HIGH) Residual pressure design basis
- system: Domestic cold/hot water
- standard_text: Verify that calculated pressure at the highest and furthest fixture is at least 15 psi, and at least 35 psi at flush-valve (flushometer) fixtures, after deducting elevation, friction and device losses (meter, backflow preventer, PRV). Confirm the incoming pressure and flow against a hydrant flow test.
- basis: Firm QC document, section 11.1 item 1 (reviewer-edited text: "Check for incoming flow data (Flow test)", "Flush type fixture minimum 35 PSI").
- source_reference: SETTY Plumbing QC Reviewer v1.0, 11.1 #1
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: high
- verify_note: Firm design basis, not a code minimum (IPC Table 604.3 minimums are lower and fixture/manufacturer specific). Store as firm design basis only.

### D2 (HIGH) Pressure zones and booster bypass
- system: Domestic water, pressure boosting
- standard_text: In buildings needing multiple pressure zones, confirm a bypass (or PRV-fed path) is provided so lower floors that do not need boosting are not served through the booster.
- basis: Firm QC document, Setty lessons learned item 10 (reviewer-edited).
- source_reference: SETTY Plumbing QC Reviewer v1.0, 11.2 #10
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s (also reused in claude_chat_019tMkVBRsAY5FhL2Vc88A9s booster-detail answer)
- confidence: high
- verify_note: None beyond normal engineering review.

### D3a (HIGH) Thermal expansion control on closed systems
- system: Domestic hot water
- standard_text: Where the water system is closed (backflow preventer, check valve or PRV on the supply), show a thermal expansion tank or other approved means, sized for system volume and temperature rise.
- basis: Firm QC document 11.1 #2; IPC 607.3 (thermal expansion control).
- source_reference: SETTY Plumbing QC v1.0 11.1 #2; IPC 607.3 (one chat cited 607.3.2)
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s; claude_chat_01VzKTpijjN61SqnsgND23Np
- confidence: high
- verify_note: Firm text is clear. Subsection 607.3.2 is cited only in one chat and I could not confirm it; cite 607.3 generally.

### D3b (MEDIUM) Expansion tank location
- system: Domestic hot water
- standard_text: Connect the expansion tank on the cold supply to the water heater, downstream (building side) of the backflow preventer, PRV and any check valve.
- basis: Firm document 11.2 #8 ("building side of backflow preventer and PRV") and Claude's later resolution of an open reviewer comment.
- source_reference: SETTY Plumbing QC v1.0 11.2 #8
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s; claude_chat_01S5q4HmRC93qWwd4n6AfX8u
- confidence: medium
- verify_note: Physically correct. The firm text still carries an open reviewer comment ("hot water or domestic cold?") and the chat explicitly asks the firm to confirm. Needs engineer sign-off before it is stored.

### D4 (HIGH) Water hammer arrestors
- system: Domestic water
- standard_text: Provide water hammer arrestors where quick-closing valves occur (solenoid valves, washing machines, flush valves, dishwashers, icemakers), installed per manufacturer and listed to ASSE 1010.
- basis: Firm document 11.1 #3 and IPC 604.9.
- source_reference: IPC 604.9; SETTY Plumbing QC v1.0 11.1 #3
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s; claude_chat_01Dvm2zwyjdMZejGs2CRUmNi
- confidence: high
- verify_note: IPC 604.9 is the water hammer section as I recall (2015 to 2021). UPC 609.10 is the equivalent if UPC jurisdiction.

### D5 (HIGH) Backflow device selection and RPZ drainage
- system: Backflow prevention
- standard_text: Use RPZ assemblies where a health hazard exists and DCVAs only for non-health-hazard applications. Size the RPZ drain/relief discharge for the catastrophic (full relief) discharge listed in the manufacturer's data.
- basis: Firm document 11.2 #7 (reviewer-edited).
- source_reference: SETTY Plumbing QC v1.0 11.2 #7
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: high
- verify_note: Consistent with ASSE 1013/1015 practice and IPC 608. Hazard classification is still an engineering and AHJ call.

### D6 (MEDIUM) Hose bibb / wall hydrant backflow protection
- system: Domestic water, hose connections
- standard_text: Provide listed backflow protection on every hose connection and non-freeze wall hydrant (vacuum breaker or integral backflow preventer to ASSE 1011, 1019 or 1052 as applicable).
- basis: Two chats flagged missing protection at wall hydrants (one cited ASSE 1019, one ASSE 1011). IPC 608.15.4.2 as I recall.
- source_reference: ASSE 1011/1019/1052; IPC 608.15.4.2 (section number not stated in chats)
- source_chat: claude_chat_01PzUgAaVtEA4Vmk1zyZ6BDM; claude_chat_01BWDq5XAQzr8dcXpX6sC1PH
- confidence: medium
- verify_note: Chats disagree on which ASSE number, which is a flag. All three are valid hose-connection standards. Do not store a single number.

### D7 (MEDIUM) Hot water recirculation sizing and controls
- system: Domestic hot water recirculation
- standard_text: Confirm a recirculation system is actually required and shown. Size pump flow from supply-piping heat loss and allowable temperature drop (GPM = heat loss, Btu/h / (500 x temperature drop, F)), show balancing valves, and provide controls to meet the energy code (ASHRAE 90.1).
- basis: Firm document 11.1 #4 (reviewer added "confirm requirement and existence of hot water system"); formula from ASPE Handbook Vol 2 Eq. 6-7 quoted in chat.
- source_reference: SETTY Plumbing QC v1.0 11.1 #4; ASPE Vol 2 ch. 6 Eq. 6-7; ASHRAE 90.1
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s; claude_chat_01Rcg67mR6TJ9BDEtjHusD6t; claude_chat_01S5q4HmRC93qWwd4n6AfX8u
- confidence: medium
- verify_note: Formula is correct (8.33 lb/gal x 60 min = 500). Chat says keep water at or above 120F per ASHRAE Guideline 12-2000; I believe Guideline 12 recommends 140F storage and about 124F minimum return, so do NOT store the 120F figure or the "5 to 15F drop" range. Return velocity "1 to 3 fps" is an ASPE guide, not a code limit.

### D8 (MEDIUM) Installed pipe larger than scheduled
- system: Domestic water piping
- standard_text: Model plumbing codes set minimum, not maximum, pipe sizes, so oversized domestic piping is not a code violation, but treat it as a substitution needing engineer approval. Check hot water wait time and volume limits, stagnation and Legionella risk on low-use branches, insulation and hanger sizes, and recirculation balancing.
- basis: Reasoned answer in chat; copper volumes quoted (about 0.025, 0.065, 0.16 gal/ft for 3/4, 1-1/4, 2 inch type L) match my calculation.
- source_reference: none cited (ASPE hot water volume discussion implied)
- source_chat: claude_chat_01S5q4HmRC93qWwd4n6AfX8u
- confidence: medium
- verify_note: Sound engineering but unsourced. Jurisdictions or green standards may cap hot water volume to the fixture. Severity guidance (Minor cold, Major hot branch) is Claude's suggestion, not firm.

### D9 (MEDIUM) Fixture shutoff valves, angle stops, unit shutoff valves
- system: Domestic water, valves
- standard_text: Each fixture supply needs its own accessible shutoff. An angle stop or integral stop satisfies this, so no additional ball valve is required at the fixture. IPC 606.2 exempts individual hotel/motel guest rooms that have a unit shutoff valve, and tubs/showers in one- and two-family dwellings. Showers elsewhere need valves with integral stops. Any unit or branch valve must be accessible.
- basis: IPC 606.2 (fixture supply shutoff) and 606.3 (access), as stated in two chats.
- source_reference: IPC 606.2, 606.3
- source_chat: claude_chat_01EGVrPkuJmcn3JHFYEoojUS; claude_chat_01PzUgAaVtEA4Vmk1zyZ6BDM
- confidence: medium
- verify_note: My recollection of 606.2 matches. One chat first cited "IPC 606.5.1 / UPC 605.4", which I believe is wrong, and then corrected its own severity. UPC and local amendments differ. Edition and AHJ must be confirmed.

### D10 (MEDIUM) Tempering and shower valve standards
- system: Domestic hot water, scald protection
- standard_text: Individual shower valves are pressure-balance/thermostatic valves to ASSE 1016 (ASME A112.1016). Point-of-use limiting devices at lavatories and sinks are ASSE 1070. Do not cite 1070 for showers. Central distribution mixing valves are ASSE 1017.
- basis: Chat comment that ASSE 1070 was misapplied to showers (should be 1016); 1017 added from my knowledge.
- source_reference: ASSE 1016, 1070, 1017
- source_chat: claude_chat_01BWDq5XAQzr8dcXpX6sC1PH; claude_chat_01EGVrPkuJmcn3JHFYEoojUS (ASSE 1016 on shower valves)
- confidence: medium
- verify_note: Standard scopes are correct to my knowledge. Whether a project needs a downstream TMV depends on occupancy and code (healthcare, accessibility). One chat in the set (Instructional Kitchen review) treated 1070 as conditional on "main HW above 120F", which is a design call, not a standard.

### D11 (LOW) Hot water storage temperature and Legionella
- system: Domestic hot water
- standard_text: Flag storage set points below the Legionella-safe range and require tempering at points of use where storage is hot. Cite ASHRAE Guideline 12 and ASHRAE 188 (water management plan) for owner and AHJ requirements.
- basis: Chat flagged 120F storage as critical and said "ASHRAE 12 requires 140F storage".
- source_reference: ASHRAE Guideline 12-2000 (as cited)
- source_chat: claude_chat_01BWDq5XAQzr8dcXpX6sC1PH
- confidence: low
- verify_note: Guideline 12 is a guideline, not a mandate, so "requires" is overstated. Do not store 140F as a firm number. Project, jurisdiction and building type (healthcare, hotel) drive this. Also ASHRAE 188 and Guideline 12 are not in the firm document.

### D12 (LOW) Water heater and expansion tank spec/schedule coordination
- system: Domestic water heaters
- standard_text: Reconcile heater schedule values with the cut sheet: recovery in GPH, storage in gallons, model number, gas inlet pressure for the actual fuel (natural gas and propane ranges differ). Make the expansion tank spec paragraph match the product (ASME Section VIII vs non-ASME, bladder vs diaphragm, working pressure). Keep fuel type consistent between spec Part 2 and the gas piping section cross-references.
- basis: Findings from one spec review.
- source_reference: none (manufacturer cut sheets)
- source_chat: claude_chat_01MJTgqF9wv8gkcgeAwLQTKp
- confidence: low
- verify_note: These are QC checklist habits from a single project, not engineering positions. Useful as checklist wording only.

### D13 (LOW) Booster pump package checklist
- system: Domestic water, pressure boosting
- standard_text: Booster sets should show low-suction cutoff, non-slam check valves, pump isolation, a pressure tank, and a skid bypass, with power coordinated with electrical. Do not connect life-safety loads to the booster without backup power.
- basis: Chat-generated generic 150 gpm duplex detail plus firm document items 10 and 14.
- source_reference: SETTY Plumbing QC v1.0 11.2 #10; 11.1 #14 (backup power remark is for gas boosters)
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: low
- verify_note: The detail is a Claude-generated generic sketch. Its TDH (120 to 160 ft), 5 to 10 HP, 2x50% staging and 15/35 psi targets must NOT be stored. The backup-power wording in the firm document applies to the gas booster, not the water booster.

### D14 (MEDIUM) Emergency eyewash and shower
- system: Emergency fixtures
- standard_text: Schedule flow rate, duration and supply temperature for emergency showers and eyewash units per ANSI Z358.1, and show tepid water supply and discharge/drain provisions.
- basis: Comment on one project and ASPE Vol 4 text quoted in a search result.
- source_reference: ANSI Z358.1
- source_chat: claude_chat_01XRtmfnW16VNTrpkGVgrVP7
- confidence: medium
- verify_note: No numbers stored on purpose. Z358.1 numeric values (flow, 15 minute duration, tepid range) vary by edition. Drain requirement is not mandated by most codes (ASPE says so).

### D15 (LOW) Harvested rainwater (non-potable) systems
- system: Rainwater harvesting
- standard_text: Identify and separate non-potable piping from potable, protect any potable makeup with an air gap or approved backflow device, and prove no cross-connection before use.
- basis: Functional test list generated by Claude for a rainwater system.
- source_reference: none cited
- source_chat: claude_chat_01EuvqvoxDpLA9C5oYCTU6c4
- confidence: low
- verify_note: No code section cited. Jurisdiction specific (for example DOEE, IPC 2021 chapter 13). Do not store treatment or testing numbers.

### D16 (LOW) Fixture flow and flush rates
- system: Fixtures
- standard_text: Verify scheduled water closet and urinal flush volumes and faucet flow rates against the adopted plumbing code, federal limits, and any green program (LEED, WaterSense).
- basis: Chat comments said a 6.0 GPF WC must be 1.28 GPF or less and a 5.0 GPF urinal must be 0.5 GPF or less "per IPC".
- source_reference: IPC 604.4 (not cited in chat)
- source_chat: claude_chat_01BWDq5XAQzr8dcXpX6sC1PH
- confidence: low
- verify_note: Numbers are WRONG as cited. IPC 604.4 allows 1.6 gpf WC and 1.0 gpf urinal (federal), while 1.28 and 0.5 are WaterSense or green code values. Store the check, not the numbers.

### D17 (MEDIUM) Water closet and lavatory clearances
- system: Fixture layout
- standard_text: Provide at least 15 inches from water closet centerline to any side wall or fixture and the code front clearance (21 inches IPC, 24 inches UPC); accessible compartments follow ADA/A117.1 instead.
- basis: Chat cited IPC 405.3.1 and UPC 402.5.
- source_reference: IPC 405.3.1; UPC 402.5
- source_chat: claude_chat_019pxJ3y3DCRTDWzPn5WUYnJ
- confidence: medium
- verify_note: Values match my recollection of both codes. Not a firm position, and accessibility dimensions control where applicable.

====================================================================
## SANITARY DRAINAGE AND VENT
====================================================================

### S1 (MEDIUM) Trap-arm length check and water closet exception
- system: Sanitary drainage / venting
- standard_text: Check developed trap-to-vent length against the adopted code table (IPC Table 909.1, UPC Table 906.1). Under IPC 909.1 the length for self-siphoning fixtures such as water closets is not limited; do not write a trap-arm length violation against a WC in an IPC jurisdiction.
- basis: Chat first flagged a 27 ft WC trap arm as Critical, then retracted it after quoting the 2018 IPC 909.1 exception.
- source_reference: IPC 909.1 and Table 909.1 (2018); UPC differs
- source_chat: claude_chat_01JfB4kGLEKj1wV4r56tLB87
- confidence: medium
- verify_note: The IPC exception is real as I recall. The chat's early numbers were wrong: it said "3 inch at 1/8 inch per ft is 12 ft, 6 ft at 1/4 inch per ft", but Table 909.1 limits (about 8 ft for 2 inch, 12 ft for 3 inch at 1/4 in/ft) do not vary that way. UPC is stricter. Store the rule, not the table values.

### S2 (LOW) Air admittance valves
- system: Vent systems
- standard_text: Every drainage system needs at least one vent or stack vent extending to the outdoors; AAVs may not vent sumps or tanks unless the vent is engineer-designed. Confirm AAVs are permitted by the AHJ and show their location and elevation.
- basis: Chat quoted "2018 IPC 918.7" and "918.8", but earlier in the same chat cited 918.4 and 918.5 for the same rules.
- source_reference: IPC section 918 (subsection numbers unreliable)
- source_chat: claude_chat_01JfB4kGLEKj1wV4r56tLB87
- confidence: low
- verify_note: Section numbers conflict inside the chat, so cite none. The chat's headline claim "AAV on a water closet is prohibited" was retracted in the same chat and is not an IPC rule. UPC prohibits AAVs generally. The chat's wet-vent sequence advice (IPC 912) is unverified.

### S3 (MEDIUM) HVAC condensate disposal
- system: Sanitary drainage, condensate
- standard_text: Discharge cooling-coil condensate to an approved receptor (floor sink, hub drain or fixture) through an air gap or air break, never by direct connection to the sanitary system. Protect the receptor trap seal.
- basis: Answer in one chat citing "IPC 307.2.1 / 802".
- source_reference: IPC 307.2, IPC chapter 8 (section 307.2.1 as cited is unconfirmed)
- source_chat: claude_chat_01UKsMZ5N3rXiLZCryEHYX1x
- confidence: medium
- verify_note: Principle is standard. The chat's "minimum 2 inch air gap" is unverified (IPC air gap is generally 1 inch minimum or twice the pipe diameter). Do not store 2 inch. Do not store a "trapped direct connection" exception: an earlier version of this note cited IMC 307.2.2 for one, which was wrong. In the 2021 IMC, 307.2.2 covers drain materials and sizes, and 307.2.1.1 prohibits connecting condensate drains directly to plumbing drain, waste or vent piping (review feedback, 2026-10-05; confirm against the adopted edition). Coordinate with mechanical.

### S4 (MEDIUM) Trap seal protection and electronic trap primers
- system: Sanitary drainage, trap seals
- standard_text: Protect traps subject to evaporation (floor drains, floor sinks, mechanical room drains) with a trap primer or deep seal. Electronic trap primers have no universal maximum distance; limit by the manufacturer's listing.
- basis: Two chats; ASSE 1018 and 1044 named.
- source_reference: IPC 1002.4; ASSE 1018, ASSE 1044
- source_chat: claude_chat_01Cu71vjHHLZ1KBx3kztPNzE; claude_chat_01UKsMZ5N3rXiLZCryEHYX1x
- confidence: medium
- verify_note: ASSE 1018 and 1044 are correct primer standards. The electronic-primer chat cited "IAPMO PS 42 / ASME A112.1044", and "ASME A112.1044" is a mis-citation (should be ASSE 1044). IPC 1002.4 is my recollection, not stated in the chats.

### S5 (LOW) Sewage ejector and sump basins
- system: Sanitary drainage, sumps
- standard_text: Show a schedule (tag, simplex or duplex, capacity, power), an alarm, accessible check and gate valves, a structural block-out, and a gas-tight vent connected to the vent system for each ejector basin.
- basis: Two project reviews (Critical: ejector with no schedule; basin vent called out as IPC 712.3).
- source_reference: IPC 712.3 (as cited)
- source_chat: claude_chat_01JvH7YW4YmRXLDeRVfCKrrP; claude_chat_01VzKTpijjN61SqnsgND23Np
- confidence: low
- verify_note: Section number not confirmed. Checklist content is reasonable, not a stated firm position.

### S6 (HIGH) Storm drainage primary and secondary systems
- system: Storm drainage
- standard_text: Verify a primary and a secondary (emergency overflow) roof drainage system is shown, and check whether the jurisdiction requires on-site retention or detention.
- basis: Firm document 11.2 #9 (reviewer-edited).
- source_reference: SETTY Plumbing QC v1.0 11.2 #9
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: high
- verify_note: Add IPC 1108 for secondary drains if the firm wants a code cite; it is not cited in any chat.

### S7 (LOW) Grease interceptors
- system: Grease waste
- standard_text: Show the grease interceptor sizing calculation and selected model on the drawings; hydromechanical units are sized and listed to PDI G101 or ASME A112.14.3, and local FOG ordinance requirements apply.
- basis: Project comment citing "IPC 1003.3 / PDI G-101"; a separate Claude-built detail cited 2022 CPC 1014 and ASPE.
- source_reference: IPC 1003.3; PDI G101
- source_chat: claude_chat_01BWDq5XAQzr8dcXpX6sC1PH; claude_chat_01FjzSdMo7M5Y5tb4v4MnaVw
- confidence: low
- verify_note: Do not store any tank size (the chat's 10 ft x 5 ft x 5 ft, 1,500 gal, 6 inch baffle submergence, 2:1 compartments are illustrative only). Section cited is the general interceptor section; confirm exact subsection.

====================================================================
## GAS PIPING AND MEDICAL GAS
====================================================================

### G1 (HIGH) Natural gas service pressure and booster checks
- system: Gas piping
- standard_text: Where natural gas is on the project, verify total load against meter and service capacity, maximum developed length, and design pressure against incoming pressure (PRV or booster as needed). Match equipment loads on the gas riser to the mechanical and plumbing schedules. Power gas boosters from a coordinated source and do not connect emergency equipment to a booster without battery backup.
- basis: Firm document 11.1 #14 and lesson 5 ("CRITICAL LESSON"), reviewer-expanded.
- source_reference: SETTY Plumbing QC v1.0 11.1 #14; 11.2 #5
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: high
- verify_note: None.

### G2 (MEDIUM) Gas pipe sizing method
- system: Gas piping
- standard_text: Size gas piping by the longest-run method (or other code-allowed method) from NFPA 54 / IFGC sizing tables, apply diversity correctly, and verify pressure drop by calculation for non-standard pressures.
- basis: Firm document 11.1 #15.
- source_reference: SETTY Plumbing QC v1.0 11.1 #15 (says "NFPA 54 Chapter 7")
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: medium
- verify_note: Citation flag: sizing is NFPA 54 Chapter 6 (Pipe Sizing) in recent editions, not Chapter 7 as the firm document says; IFGC chapter 4 equivalent. Correct before storing.

### G3 (MEDIUM) Medical gas installer qualification
- system: Medical gas
- standard_text: Medical gas work requires brazers and installers qualified under the ASSE/IAPMO/ANSI Series 6000 (installers ASSE 6010) per NFPA 99.
- basis: Firm document 11.2 #6 ("ASSE 6000 certified brazer/installer").
- source_reference: SETTY Plumbing QC v1.0 11.2 #6; NFPA 99
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: medium
- verify_note: Firm wording is imprecise: 6000 is the series and professional qualification standard; individual roles use 6010 (installer), 6020 (inspector), 6030 (verifier). Needs wording correction.

### G4 (LOW) Rooftop/emergency generator gas supply routing
- system: Gas piping
- standard_text: For natural gas serving a rooftop generator, confirm supply piping runs in a 2-hour rated chase and the installation matches the firm standard generator gas detail.
- basis: Reviewer comment embedded in the firm document.
- source_reference: SETTY Plumbing QC v1.0 11.1 #14 reviewer comment
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: low
- verify_note: The abbreviation "EG" is ambiguous in the text and the 2-hour chase is jurisdiction/project dependent (NFPA 54, IBC, local gas code). Needs the engineer to confirm scope and source.

====================================================================
## GENERAL / PROCESS (from the firm document)
====================================================================

### P1 (HIGH) Owner standards and green program
- system: General
- standard_text: Owner design standards take precedence; obtain them and verify compliance. Determine whether LEED applies and which version, and review water efficiency accordingly.
- basis: Firm document 11.2 #2, #3.
- source_reference: SETTY Plumbing QC v1.0 11.2 #2, #3
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: high
- verify_note: None.

### P2 (HIGH) Electrical coordination of plumbing equipment
- system: General
- standard_text: Coordinate all plumbing equipment that needs power (pumps, ejectors, heaters, primers, controls) with the electrical drawings.
- basis: Firm document 11.2 #4.
- source_reference: SETTY Plumbing QC v1.0 11.2 #4
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: high
- verify_note: None.

### P3 (HIGH) Existing conditions on renovations
- system: General
- standard_text: On renovation projects verify existing conditions; where existing systems are not surveyed, add protective notes.
- basis: Firm document 11.2 #1.
- source_reference: SETTY Plumbing QC v1.0 11.2 #1
- source_chat: claude_chat_019tMkVBRsAY5FhL2Vc88A9s
- confidence: high
- verify_note: None.

====================================================================
## ERRORS FOUND IN THE FIRM DOCUMENT ITSELF (do not store as standards)
====================================================================
- Section 1.2 states "Water Supply = square root of total WSFUs". Not a sizing rule; WSFU is converted to demand GPM with the Hunter curve or code table. (Flagged by claude_chat_01S5q4HmRC93qWwd4n6AfX8u; I agree.)
- Section 1.2 gives the water expansion coefficient as 0.0000069 per F. Real value is about 0.0002 per F over typical DHW range (roughly 25 to 30 times larger by my estimate; the chat says 15 to 20 times). Size expansion tanks from specific volumes or manufacturer tables.
- Section 11.1 #15 cites NFPA 54 Chapter 7 for sizing (see G2).
- The document is plain text with a .docx extension, and sections 3, 5, 7, 10 and 4.2 are listed in the table of contents but absent.
- "2 to 5 comments per sheet minimum" conflicts with the document's own "do not invent" rule (noted by the same chat).
- A proposed v1.1 revision (phase-aware review, Concept/SD/DD/CD expectations) exists as a Claude-written draft in claude_chat_01S5q4HmRC93qWwd4n6AfX8u; it is unreviewed and not a firm position.

## CLAIMS DROPPED OR REJECTED (wrong, retracted, or too project-specific)
- "AAV on a water closet is prohibited by IPC/UPC" (retracted in its own chat).
- "27 ft WC trap arm is a Critical violation" (IPC exempts self-siphoning fixtures).
- "Minimum 2 inch air gap for condensate" (unverified).
- "IPC 606.5.1 / UPC 605.4" for fixture shutoffs (wrong or unconfirmed numbering; use 606.2).
- "ASME A112.1044" (should be ASSE 1044).
- "Expansion tank required for systems over 4 gallons" and point-of-use heater sizes of 2.5 to 6 gal / 10 to 20 gal semi-instantaneous (generic Claude advice, not sourced).
- "ASHRAE 12 requires 140F storage" and "120F recirc minimum" (see D7, D11).
- Urinal "0.5 GPF per IPC" and WC "1.28 GPF" as code (see D16).
- Booster pump TDH/HP, tank and grease interceptor dimensions (illustrative).
- All project-specific comments (RO riser pressure-loss arithmetic, spec cross-references, schedule typos, revision-block gaps).

## Counts
High 10 (D1, D2, D3a, D4, D5, S6, G1, P1, P2, P3). Medium 13 (D3b, D6, D7, D8, D9, D10, D14, D17, S1, S3, S4, G2, G3). Low 9 (D11, D12, D13, D15, D16, S2, S5, S7, G4). Total 32 candidates.

## Chats reviewed / skipped
Listed: 46 chats since 2026-06-01 for the matched Project (paged through all 8 pages, has_more false). Read in full: 
UKsMZ5N3 (condensate), JfB4kGLE (drainage/vent), Cu71vjHH (trap primer), PzUgAaVt (ball valve), EGVrPkuJ (angle stops), MJTgqF9w (water heater spec), FjzSdMo7 (grease interceptor detail), Rcg67mR6 (recirc sizing), BWDq5XAQ (full QC checklist, result text only), VzKTpijj (ASI-001 QC), 017hs9Jk (storage heater guide), 019tMkVB (booster detail; contains the firm document), EuvqvoxD (rainwater), S5q4HmRC (prompt revision), HznrHBE4 (empty), JvH7YW4Y (ejector), JpuRDktC (storm, empty), HV96KEBX (role), 011G3M4J (Revit dialog), 019pxJ3y (toilet layout), RRnMW9D4 (RFI), XRtmfnW1 (Building 134), GYdiWvYH and LghXu5gZ (phase 3, connector failures, no content), Dvm2zwyj (kitchen).
Skipped as plainly not standards-bearing or not opened (title only): 019uWVwJ, 01EVbEmP (deleted, blank titles), 01N5bi64 and 012nWJWB (QC workbook for a project), 01MSYCwy, 01UkGG1e, 013zXUEk, 017K9B9h, 01FkhXdL, 011dNeoJ, 01RXbT9q, 011xjyih, 01JK9HDR, 0183RwWa, 01S99ZgT, 013C27np, 012nX3Lh, 011M7JRv, 01EV1cAK, 01A63Q9h, 01GudYgG, 01NRN5L3, 019BicqZ, 015LfHnW (PDF markup, document diff, email summary, narrative, project review logs). Several of the project-review chats (EV1cAK, 01A63Q9h, 01GudYgG, NRN5L3, 019BicqZ, 015LfHnW, N5bi64, 012nWJWB) were NOT opened and may contain reusable comments; a second pass could mine them.
