# Electrical QC candidate engineering standards (READ-ONLY extraction, NOT verified firm positions)

Sources: claude.ai Projects "Eng - Electrical Quality Control Reviewer" (id claude_proj_011CXttUQLwaDD3uYGhhrRhK, 12 chats since 2026-02-01) and "Electrical QAQC Reviewer" (id claude_proj_011CYDymRgvzjZkUXP6x3Uzc, about 96 chats since 2026-02-01). Both Projects fully paged (has_more false). Chats whose project_id did not match were ignored.

Firm documents that appear verbatim in the chats' project_knowledge_search results (these are the only "firm text" sources; everything else is Claude output):
- FIRM-A: "Electrical QAQC Reviewer.docx", Claude Project Instructions v1.1, Feb 2026 (sections 5 riser review, 8 existing power, 9 utility coordination, 10 power conditioning/SPD).
- FIRM-B: "Electrical_QAQC_Instructions_v3_0.txt", v3.0, March 2026 (Parts 0 to 11: master checklist sections A to I, Part 6 interdiscipline, Part 7 renovation, Part 8 utility, Part 9 power conditioning).
- Also loaded in the Project: Electrical_Sizing_Charts.xlsx, Siemens switchboard sizing chart, NEC 2020 (NFPA 70) volumes. NEC 2020 text excerpts seen in chats are used below to verify some code claims.

Method notes:
- Confidence: high = restates FIRM-A/FIRM-B directive text or an NEC 2020 requirement I could check against NEC text shown in the chats, and is not technically questionable. medium = plausible and partly sourced but edition/jurisdiction dependent or only Claude output. low = single chat, unsourced, or contains something I could not verify.
- Many HIGH items are restatements of the Project's own instruction documents, so they may already be implicit in existing QC practice. Treat them as "codify what the instructions already say".
- I did NOT carry over numeric thresholds (conductor sizes, AIC/kA values, cal/cm2, growth percentages, time delays, unit counts) unless the number is a code-stated rule and is flagged. Where a number is in a standard_text I say so in verify_note.
- NEC section numbers shift between editions (2017, 2020, 2023, 2026). Every NEC section cited below must be checked against the edition adopted by the project AHJ. The firm's own v3.0 table lists NEC 2017/2020/2023 and does not mention the 2026 edition.

Ordering: grouped by system; inside each group ordered high, medium, low.

================================================================
## 1. Service entrance, utility basis, short-circuit
================================================================

### E01 Available fault current and equipment ratings on the riser
- discipline: Electrical
- system: Service / short-circuit / coordination
- standard_text: Show the utility's available fault current (kA symmetrical, from the utility load letter) on the power riser at the service entrance and at each distribution point. Show the interrupting/short-circuit current rating of every switchboard, panelboard, disconnect and transfer switch and confirm each exceeds the available fault current at its location.
- basis: Recurs in about 15 reviews (missing fault current and missing AIC/SCCR on panels is the single most repeated finding). FIRM-A 5.3 checklist ("SCCR exceeds available fault current") and FIRM-B Part B (service and distribution).
- source_reference: FIRM-A v1.1 5.3; FIRM-B v3.0 Part 5 Section B and Part 8.1; NEC 110.9, 110.10, 408.6 (panelboard/switchboard SCCR), 110.24 (field marking of available fault current at service equipment)
- source_chat: 01Qo7v1i (Mar 6), 018wW7xh (Mar 5), 01Nw9XUU, 01AzBW7p, 01Lyc8xF, 01BkajcbN, 016yRE34, 01GDZMuH, 01E59RNZ, 01XekZWe note
- confidence: high
- verify_note: Verify section numbers per adopted NEC edition (110.24 field-marking rule exists in 2017 and 2020; confirm 2023/2026). Do not store any kA value from the chats. The Sizing Charts "minimum AIC by frame" table was quoted in one chat and is not carried here.

### E02 Utility service data on the riser (non-campus)
- discipline: Electrical
- system: Service / utility coordination
- standard_text: Identify the serving utility by name on the power riser and show service voltage and configuration, service amperage, service type (overhead, underground, pad-mount), metering/CT cabinet location and the main disconnect type and rating. Reference the utility load letter (service availability confirmation) on the riser.
- basis: FIRM-A and FIRM-B checklists list each of these items; the omission "utility not identified, no load letter referenced" was flagged in at least 6 reviews.
- source_reference: FIRM-A v1.1 5.2.1 and 9.1; FIRM-B v3.0 Part 5 Section B "Utility service", Part 8.1; NEC Article 230
- source_chat: 01SUqB3T, Osceola review (older Project, 019Q2Jzm), 01BkajcbN, 016yRE34, 01Lyc8xF
- confidence: high
- verify_note: Partial conceptual overlap with active standard (c) (campus utility basis), but (c) is campus-specific. This candidate is the general (non-campus) version. Decide whether to merge.

### E03 Verify that physical utility infrastructure exists before finalizing the service entrance
- discipline: Electrical
- system: Service / utility coordination
- standard_text: Before finalizing the service entrance design, confirm that utility poles, transformers or ductbanks actually exist at the site (utility contact, civil drawings, aerial and street-level imagery) and record the finding in the project file. If it is undocumented, carry it as a coordination item.
- basis: FIRM-A 9.6 and FIRM-B 8.2 state this as a required check.
- source_reference: FIRM-A v1.1 9.1 and 9.6; FIRM-B v3.0 8.2
- source_chat: 01C2T1Yw/01UJKEnJ context only (the text appears in knowledge results), no review chat applied it
- confidence: medium
- verify_note: Firm process text, no code basis. The specific tools (Google Earth/Street View) are a method, not a requirement. Not tested in any review chat.

### E04 System voltage and configuration consistency across the riser
- discipline: Electrical
- system: Service / distribution
- standard_text: Confirm the service voltage and configuration is the same at the utility connection, CT cabinet, main switchboard, transfer switches and equipment schedules (for example 120/208V wye versus 240V delta or high-leg delta). Resolve any mismatch with the utility before issue.
- basis: Two reviews found a CT cabinet or ATS schedule at a different voltage than the distribution equipment. Also an exit sign specified at a voltage that did not exist in the system.
- source_reference: FIRM-A 5.2.1 (service voltage specified); NEC Article 230 general; no single section
- source_chat: 01BkajcbN, Osceola review (019Q2Jzm)
- confidence: medium
- verify_note: Found by Claude in two chats, both plausible. Not tied to a code section. Partial overlap with active standard (a) (riser vs schedules). Keep separate only if you want voltage checked explicitly.

### E05 Short-circuit, coordination and arc-flash study responsibility
- discipline: Electrical
- system: Short-circuit / coordination
- standard_text: State on the drawings who performs the short-circuit, coordination and arc-flash studies (engineer of record or contractor) and require results before equipment release. Provide available fault current on the riser so the study has a basis.
- basis: One chat asked "EOR or contractor?" about a general note requiring the contractor to perform the study; no firm position found in the instructions.
- source_reference: IEEE 1584 (listed in FIRM-A 2.2 and FIRM-B Part 0); NEC 110.16 (arc-flash labeling); NEC 700.32 (emergency selective coordination, 2017/2020 numbering)
- source_chat: 01KJ81G9 (911 on 19 March), 01E59RNZ, 01MNmAY8
- confidence: low
- verify_note: The responsibility split is a firm policy question that the chats did not resolve. Do not store as a standard until a senior engineer states the position. Selective coordination for emergency systems is a real NEC requirement (verify 700.32 and 701.32 in the adopted edition).

================================================================
## 2. Load calculations and feeder sizing
================================================================

### E06 Article 220 load calculation backs service, feeder and transformer sizing
- discipline: Electrical
- system: Load calculations / service sizing
- standard_text: Provide an NEC Article 220 demand load calculation that supports the service, main switchboard, feeders and transformers shown on the riser. Show connected and demand load and the remaining spare capacity on each piece of distribution equipment.
- basis: Listed in the riser checklist ("load calculations provided and verified") and as a common riser error ("service undersized", "no spare capacity in service").
- source_reference: FIRM-A v1.1 5.3 and 5.4; FIRM-B v3.0 Part 5 Section B ("service entrance sizing matches calculated demand load per NEC Article 220"); NEC Article 220
- source_chat: 01TPtUD8 (Sep 16), 01KJ81G9, 018wW7xh, 01LNSaCH, 01Lyc8xF
- confidence: high
- verify_note: Do not store spare-capacity percentages. The chats quote several different "headroom" figures (a UPS growth number, a panel loading percent). One chat treated 1% margin as "no spare" which is a judgment, not a code point.

### E07 Existing service capacity determined from measured demand (NEC 220.87)
- discipline: Electrical
- system: Load calculations / existing power
- standard_text: Where new load is added to an existing service, determine existing demand from metered or utility-billed maximum demand data (state the measurement period and source) rather than assuming it. Add the new load to the measured demand with the multiplier required by the adopted code.
- basis: Two chats used utility bill peak demand and referenced 220.87; one EV feasibility chat refused to assess capacity without panel data and a definition of what the metered demand covers.
- source_reference: NEC 220.87 (determining existing loads); FIRM-A 8.2 and FIRM-B 7.2 (existing service capacity must be verified)
- source_chat: 017DBq95 (Apr 9), 016Z91Sn (Sep 21), 01VVH5HR (EV)
- confidence: medium
- verify_note: 220.87 is a real NEC section (2017/2020); I did not see its text in the chats. Check which measurement period and multiplier the adopted edition requires. Related to active standard (b); this adds the method.

### E08 Noncoincident loads in demand calculations (NEC 220.60)
- discipline: Electrical
- system: Load calculations
- standard_text: Apply NEC 220.60 noncoincident load treatment only to loads that cannot operate at the same time (for example heating versus cooling, or a standby unit). Document the exclusion on the schedule and calculate both seasonal cases before accepting the smaller one.
- basis: A review corrected a standby boiler demand to zero using 220.60, then required a second calculation substituting the chiller to confirm the larger case.
- source_reference: NEC 220.60
- source_chat: 01KJ81G9 (911 on 19 March)
- confidence: medium
- verify_note: NEC 220.60 exists in 2017 and 2020. Single chat. The "winter is the larger case" conclusion is project-specific.

### E09 Voltage drop calculations and what the NEC actually requires
- discipline: Electrical
- system: Voltage drop
- standard_text: Provide voltage drop calculations for long feeders and branch circuits (site lighting, remote equipment, long homeruns) and fill in any voltage drop table shown on the drawings. Treat the NEC 3 percent branch and 5 percent total figures as informational recommendations, and check the specifications for an enforceable limit.
- basis: One review asked for blank voltage drop tables to be completed. A construction-phase chat noted the NEC values are informational notes, so exceeding them is not by itself a code violation unless the specs impose a limit. FIRM-A 1.2 lists the voltage drop formula.
- source_reference: NEC 210.19(A) Informational Note, NEC 215.2 Informational Note (voltage drop recommendations); FIRM-A v1.1 1.2
- source_chat: 0169RWrU (Aug 21), 01E59RNZ, 01SUqB3T
- confidence: medium
- verify_note: The informational-note paragraph numbers differ by edition (one chat cited 215.2(A)(3) IN No. 2, which looks like 2017 numbering). One chat cited a "maximum 3 percent to secondary transformer, 5 percent total" statement as if required, which is wrong. The percentages themselves are NEC informational values, not firm numbers.

### E10 Motor conductor and feeder sizing from NEC tables
- discipline: Electrical
- system: Motor circuits
- standard_text: Size motor branch-circuit and feeder conductors from the NEC full-load current tables (430.247 to 430.250), not from the nameplate. For several motors, size the feeder at 125 percent of the largest motor plus 100 percent of the others, and set overload protection from the nameplate current.
- basis: The NEC 2020 Annex D example shown in the chats states exactly this. One chat also applied 430.24 to a two-motor feeder.
- source_reference: NEC 430.6(A), 430.22, 430.24, 430.32, Tables 430.247 to 430.250
- source_chat: 01RKCT94 (Sep 1, text shown), 01FamQxH (Sep 10)
- confidence: high
- verify_note: Verified against NEC 2020 Annex D Example D8 text visible in a chat. Check 430.6(A) still points to the same tables in the adopted edition. The chat's 10 hp numeric example (28 A) is not carried.

================================================================
## 3. Transformers and grounding
================================================================

### E11 Transformer data and protection shown on the riser
- discipline: Electrical
- system: Transformers
- standard_text: Show kVA, primary and secondary voltage, impedance and primary overcurrent protection for every transformer on the riser, with the primary protection sized per the adopted NEC transformer protection rules. State whether primary-only or primary-and-secondary protection is used.
- basis: FIRM-A 5.2.4 and 5.3 ("all transformers properly sized and protected"); common error "using primary-only protection instead of primary-secondary". Missing or illegible transformer kVA flagged in at least 5 reviews.
- source_reference: FIRM-A v1.1 5.2.4, 5.3, 5.4; NEC 450.3(B)
- source_chat: 012emy7Q, 018wW7xh, 01LNSaCH, 01MNmAY8, 01Lyc8xF
- confidence: high
- verify_note: The worked example in FIRM-A (primary current x 1.25 then next standard size) is a 450.3(B) primary-only calculation for certain conditions; confirm the conditions for the adopted edition. Do not store the example values or the 125 percent factor without checking Table 450.3(B).

### E12 Separately derived system grounding shown for each transformer and generator
- discipline: Electrical
- system: Grounding
- standard_text: Show the system bonding jumper, grounding electrode connection and grounding electrode conductor size for every separately derived system (step-down transformers and any generator treated as separately derived) on the riser or a referenced grounding detail.
- basis: FIRM-A common error list ("no grounding for separately derived systems") and checklist; flagged in at least 6 reviews.
- source_reference: FIRM-A v1.1 5.3, 5.4; FIRM-B v3.0 Section H; NEC 250.30
- source_chat: 01EE2o1Y, 014wkk5u, 01SUqB3T, 01XvYcGD, 01Nw9XUU
- confidence: high
- verify_note: One chat described a system bonding jumper at the transformer and a "supply-side bonding jumper at the first disconnect" as both shown and both required. That description looks wrong because the NEC allows the system bonding jumper at either the source or the first disconnect, one location only. Do not store subsection numbers (250.30(A)(1) to (A)(6) renumbered between 2017 and 2020).

### E13 Neutral to ground bond only at the service or at a separately derived source
- discipline: Electrical
- system: Grounding
- standard_text: Make the neutral-to-ground bond at the service or at the source of a separately derived system, at one point only. Do not bond the neutral to ground downstream of that point, and do not mark up a transformer secondary bond as an error when the transformer is a separately derived system.
- basis: One chat correctly rebutted a reviewer comment ("neutral only connected to ground at main service") that was applied to a transformer riser. The position is standard NEC practice.
- source_reference: NEC 250.30, 250.24, 250.142
- source_chat: 01XvYcGD (Apr 2)
- confidence: medium
- verify_note: Principle is sound; the chat's sub-subsection citations are not reliable. Single chat. Confirm the same position with a senior engineer before storing.

### E14 Generator grounding, key notes and ATS pole count must agree
- discipline: Electrical
- system: Emergency power / grounding
- standard_text: State whether the generator is a separately derived system and make the generator neutral bond, the ATS pole configuration (solid neutral versus switched neutral) and the riser key notes all consistent with that determination.
- basis: Two reviews found a key note saying "not separately derived" with an ATS schedule showing 3-pole and 4-pole variants, and a note contradicting the grounding detail.
- source_reference: NEC 250.30, 250.34 (portable and vehicle-mounted generators), 250.35 (permanently installed generators)
- source_chat: 01Nw9XUU, 017DBq95, Osceola review (019Q2Jzm), 01Viq5XL (generator wye vs delta, general background)
- confidence: medium
- verify_note: Principle (consistency) is sound. The 250.34/250.35 citations are from Claude and should be checked; they changed in 2020. Generic wye-versus-delta comparison chat is background only.

### E15 Grounding electrode system shown complete, GEC sized from the service conductors
- discipline: Electrical
- system: Grounding
- standard_text: Show the building grounding electrode system with all electrodes that exist at the building bonded together (metal water pipe, building steel, concrete-encased electrode where present, rods as needed). Size the grounding electrode conductor from the largest service-entrance conductor for this service, not from a fixed size repeated on a standard detail.
- basis: FIRM-A 5.3 checklist; a detail review caught a fixed GEC size on a repeated standard detail and a missing concrete-encased electrode bond.
- source_reference: FIRM-A v1.1 5.3; FIRM-B v3.0 Section H; NEC 250.50, 250.52(A), 250.66
- source_chat: 018eLq5W (Sep 7), 014wkk5u, 01EE2o1Y
- confidence: high
- verify_note: Section numbers are stable in 2017/2020; confirm for 2023/2026. Concrete-encased electrode length and rebar size appear in one chat; not carried.

### E16 Equipment grounding conductor sizes shown on every feeder, sized from the overcurrent device
- discipline: Electrical
- system: Grounding
- standard_text: Show an equipment grounding conductor size on every feeder on the riser and size it from the rating of the overcurrent device ahead of the feeder per the NEC equipment grounding conductor table.
- basis: FIRM-A 5.3 ("equipment grounding conductors sized") and 5.4 ("missing equipment grounding conductor sizes").
- source_reference: FIRM-A v1.1 5.3, 5.4; NEC 250.122, Table 250.122
- source_chat: 014wkk5u, 017DBq95, 01XvYcGD
- confidence: high
- verify_note: See flagged item F1 below: one chat applied this standard and got the table value wrong. The standard itself is correct; do not store any EGC size. Partial overlap with active standard (a), which does not list EGC explicitly.

### E17 Ground-fault protection of equipment for large solidly grounded services
- discipline: Electrical
- system: Grounding / protection
- standard_text: Provide ground-fault protection of equipment where the NEC requires it (solidly grounded wye services over 150V to ground and not over 1000V phase-to-phase, with each service disconnect rated at or above the code trigger). Note the setting basis or reference the specification on the drawings.
- basis: FIRM-B Section H checklist; NEC 2020 text for 230.95 is visible in a chat.
- source_reference: NEC 230.95; FIRM-B v3.0 Section H "Ground fault protection"
- source_chat: 011jjxRX (knowledge result text), 01Lyc8xF context
- confidence: high
- verify_note: Verified against the NEC 2020 230.95 text visible in a chat. The 1000A trigger and maximum setting values are code numbers but I did not write them in the standard_text. Feeder ground-fault protection (215.10) and emergency system rules (700.6) are separate and not covered here.

================================================================
## 4. Emergency and standby power
================================================================

### E18 ATS schedule completeness and transfer time
- discipline: Electrical
- system: Emergency power
- standard_text: Give every automatic transfer switch a schedule entry with ampere rating, voltage, number of poles, service-entrance rating (yes/no), short-circuit withstand rating, transfer type and the transfer time. Provide emergency system power within the time the NEC requires and state it on the schedule.
- basis: FIRM-B Section G ATS checklist (ratings, transfer time "10 seconds or less" for life safety). Several reviews flagged ATS schedules missing ratings or transfer type.
- source_reference: FIRM-B v3.0 Section G; NEC 700.12 (emergency source within 10 seconds), NEC 700.5 (transfer equipment); NFPA 110
- source_chat: 01Nw9XUU, 01Qo7v1i, 01LNSaCH, 01AzBW7p, 014wkk5u
- confidence: high
- verify_note: The 10 second figure is the NEC 700.12 requirement; verify the paragraph reference. One chat cited 700.5(D) for "emergency transfer equipment supplies only emergency loads"; that sub-paragraph letter varies by edition. The chat that called a 9 second transfer "marginal" is a project judgment, not a standard.

### E19 Generator sized from an evaluated load including motor starting
- discipline: Electrical
- system: Emergency power
- standard_text: Size the generator from a documented emergency and standby load summary that evaluates motor starting (inrush) demand for the largest motors, not only running kW. Show the load summary or reference it on the drawings.
- basis: FIRM-B Section G generator checklist; flagged in several reviews as "no load calculation comparing emergency loads to generator rating".
- source_reference: FIRM-B v3.0 Section G; NEC 700.4 (capacity), 700.12; NFPA 110
- source_chat: 01Qo7v1i, 01LNSaCH, 016E5eiW (older Project, Gilroy), 01MNmAY8
- confidence: high
- verify_note: Fuel tank runtime requirement from FIRM-B is flagged separately (F3). Do not store generator kW numbers.

### E20 Emergency feeder fire protection method identified on the riser
- discipline: Electrical
- system: Emergency power
- standard_text: Where the adopted NEC requires fire protection of emergency feeder circuits (certain occupancies and building heights), identify on the riser which feeders need it and which protection method is used (fully sprinklered space, listed 2-hour circuit protective system or cable, 2-hour assembly, or concrete encasement). Show the construction detail for the method chosen.
- basis: Cedar Tree-type reviews flagged "two-hour rated feeders not identified"; a construction-phase chat walked through the encased-bank option.
- source_reference: NEC 700.10(D)
- source_chat: 012emy7Q, 01LNSaCH, 01Nw9XUU, 01QiMEu5 (Sep 30)
- confidence: medium
- verify_note: The occupancy triggers and item numbering inside 700.10(D) differ by edition; the chat listed specific triggers and a "2 in. of concrete" minimum that I could not verify. Do not store those. The concrete-encasement ampacity comments in that chat (Annex B tables not applicable) were not verified.

### E21 Surge protective device at emergency system switchboards and panelboards
- discipline: Electrical
- system: Emergency power / SPD
- standard_text: Provide a listed surge protective device at emergency system switchboards and panelboards where the adopted NEC requires it, and show it on the riser.
- basis: A review cited a code requirement for SPDs at emergency switchboards and panelboards; none were shown.
- source_reference: NEC 700.8
- source_chat: 012emy7Q (Mar 5)
- confidence: medium
- verify_note: The 700.8 requirement entered the NEC in the 2020 edition and is not in 2017. Confirm against the adopted edition before storing as a firm rule.

### E22 Emergency lighting design basis stated
- discipline: Electrical
- system: Emergency lighting
- standard_text: State the emergency lighting design basis on the drawings (unit equipment with integral battery versus a central emergency source) so a normal-power panel serving only unit-equipment chargers is not mistaken for an Article 700 branch. Show egress illumination coverage and the required battery duration per the adopted life safety code.
- basis: One review noted a panel labeled EM with no generator or ATS and asked for the basis to be documented; FIRM-B Section E lists the egress lighting checks.
- source_reference: NEC 700.12(F) (unit equipment); NFPA 101 7.9 (emergency lighting); FIRM-B v3.0 Section E
- source_chat: 01E59RNZ, 01SXF82P context
- confidence: medium
- verify_note: FIRM-B quotes average and minimum foot-candle values and a 90 minute duration from NFPA 101; those numbers are not carried and must be verified in the adopted NFPA 101 edition.

### E23 Emergency lighting inverter load carried without diversity reduction
- discipline: Electrical
- system: Emergency lighting
- standard_text: Carry the emergency lighting load served by a central inverter at 100 percent of connected load with no general-lighting diversity reduction.
- basis: One chat reasoned that all emergency lighting operates at once during an outage.
- source_reference: NEC 220.42 (general lighting demand factors), 700.12
- source_chat: 01PftBx7 (Aug 6)
- confidence: low
- verify_note: The conclusion is reasonable, but the chat also asserted egress lighting is a "continuous load" that needs 125 percent sizing and said Table 220.42 has a footnote excluding loads "where entire lighting is used at once". The footnote applies to specific occupancies. Do not store the 125 percent claim.

### E24 Fire pump power and interface shown on the electrical drawings
- discipline: Electrical
- system: Fire pump
- standard_text: Show the electrical power for any fire pump on the riser, including dedicated service or connection ahead of the main disconnect, a service-rated disconnect at the pump, dual power sources where required, and the pump controller and jockey pump connections.
- basis: FIRM-B Part 6.3; two reviews flagged a fire pump room with no feeder or ATS reference.
- source_reference: FIRM-B v3.0 Part 6.3; NEC Article 695; NFPA 20
- source_chat: 01Lyc8xF, 01AzBW7p, 01EE2o1Y
- confidence: medium
- verify_note: One chat cited 695.3 for a missing feeder; the paragraph-level citations were not checked. Also see the Mechanical run for the fire protection side.

================================================================
## 5. Power quality: SPD and UPS
================================================================

### E25 SPDs shown on the riser with ratings
- discipline: Electrical
- system: Surge protection
- standard_text: Show surge protective devices on the power riser with type (1, 2 or 3), voltage protection rating, nominal discharge current and UL 1449 listing. Locate them at the service entrance and at panels serving sensitive electronic equipment.
- basis: FIRM-A 10.3 and FIRM-B 9.2 state SPDs must be clearly shown on the riser. One review found an SPD shown without any ratings.
- source_reference: FIRM-A v1.1 10.3; FIRM-B v3.0 9.2; NEC Article 285 (SPDs in 2020), UL 1449
- source_chat: 017DBq95, 01SUqB3T, Osceola review (019Q2Jzm)
- confidence: medium
- verify_note: The firm's "mandatory for data centers and healthcare, recommended for laboratories and commercial" table is firm policy, not an NEC rule. Do not state it as a code requirement. NEC Article numbering for SPDs (280 versus 285) differs by edition. See F10.

### E26 UPS review items on drawings
- discipline: Electrical
- system: UPS / critical power
- standard_text: For UPS systems serving critical loads, show topology, redundancy level, battery runtime, a maintenance bypass and monitoring interface, and size the UPS with documented growth capacity above the calculated load.
- basis: FIRM-A 10.2 and FIRM-B 9.3 list these checks. One review of a mission-critical facility flagged the UPS as heavily utilized against the firm growth guidance.
- source_reference: FIRM-A v1.1 10.2; FIRM-B v3.0 9.3
- source_chat: 016E5eiW (older Project)
- confidence: medium
- verify_note: The two firm documents disagree on the growth number (FIRM-A: 20 to 25 percent for data centers, 10 to 15 percent for office IT; FIRM-B: minimum 20 percent). Do not store a percentage until the firm picks one. Runtime and redundancy figures are also firm text with no code source.

================================================================
## 6. Panelboards, branch circuits and equipment connections
================================================================

### E27 Riser, panel schedules and panel designations must match
- discipline: Electrical
- system: Panelboards / schedules
- standard_text: Cross-check every panel on the riser against its schedule for designation, voltage, bus rating, main breaker rating and feeder breaker rating, and confirm connected load does not exceed bus rating.
- basis: FIRM-A 5.4 common errors ("panel designations do not match schedules", "feeder breaker size does not match panel main") and FIRM-B severity examples. Many reviews found a feeder breaker versus panel main mismatch.
- source_reference: FIRM-A v1.1 5.3, 5.4; FIRM-B v3.0 severity table; NEC 408.36 (panelboard overcurrent protection)
- source_chat: 014wkk5u, 01AoRNVN, 01Lyc8xF, 012emy7Q, 01SUqB3T
- confidence: high
- verify_note: Partial overlap with active standard (a), which covers conduit, conductor type and fire rating on feeders but does not list designations or main versus breaker. Merge or keep separate at your discretion. Do not store the "phase imbalance exceeding 10 percent" severity trigger in FIRM-B.

### E28 GFCI designation on panel schedules and plans for non-dwelling locations
- discipline: Electrical
- system: Branch circuits / GFCI
- standard_text: Show GFCI protection on the plans or panel schedules for receptacles in locations where the adopted NEC requires it for non-dwelling occupancies (for example kitchens, bathrooms, sinks, rooftops, outdoors, damp and wet locations, garages). Show weatherproof designation for outdoor receptacles.
- basis: Repeated in about 8 reviews as "GFCI not clearly designated". The location list is from the NEC 2020 text visible in knowledge results.
- source_reference: NEC 210.8(B) (non-dwelling), 406.9(B) (weatherproof receptacles); FIRM-B Part 0 cross-reference
- source_chat: 01XU2SQB (Feb 23), 01GDZMuH, 01Lyc8xF, 016yRE34, 01LN3gtC
- confidence: medium
- verify_note: Subsection numbers for the same location varied between chats (210.8(A)(7), 210.8(B)(2), (B)(5)). The 2023 NEC expands GFCI to more locations. Verify the list per adopted edition. One chat said NEC 210.8(D) removes branch-circuit GFCI for appliances with integral GFCI; I believe 210.8(D) in 2020 relates to dwelling dishwashers, so that statement is doubtful (see F7).

### E29 Automatic receptacle (plug load) control: energy code and NEC marking
- discipline: Electrical
- system: Receptacle control / energy code
- standard_text: Confirm the adopted energy code edition and its automatic receptacle control requirement (space types, percentage of receptacles, control method and timeout) on every project and show the controlled receptacles on the plans. Mark controlled receptacles with the symbol and word required by the NEC receptacle marking rule and cite the correct NEC section.
- basis: Four chats covered it. The requirement originates in the energy code; the NEC governs marking. A cover-sheet review caught the wrong NEC section cited on a symbol list.
- source_reference: NEC 406.3(E) (controlled receptacle marking); ASHRAE 90.1 automatic receptacle control (Section 8.4.2 in 90.1-2013/2016, confirm); IECC commercial automatic receptacle control (C405.10 in 2018, renumbered in later editions)
- source_chat: 015eJgoF (Jul 20), 0129iwfn (older Project, Sep 25), 018eLq5W, 016PTyzm
- confidence: medium
- verify_note: IECC and ASHRAE section numbers conflict between chats (C405.10, C405.11) and I could not verify either; check against the adopted energy code edition. The 50 percent, 12 inch and override figures are edition and amendment dependent. The chat that called it "50 percent" and one that said "at least one circuit" give different pictures; see F6.

### E30 Systems furniture feeds: multiwire handle ties and circuit count versus energy code
- discipline: Electrical
- system: Systems furniture
- standard_text: When systems furniture is wired as a multiwire branch circuit, provide a common-trip or handle-tied breaker for the ungrounded conductors. Check the energy code automatic receptacle control percentage against the number of furniture circuits that are controlled, not just that one circuit is controlled.
- basis: Chats stated 240.15(B)(1) and 210.4(B) for handle ties, and gave a "control one of three circuits" approach to meet a local energy code.
- source_reference: NEC 210.4(B), 240.15(B)(1), Article 605 (office furnishings)
- source_chat: 01GAcZ3S (Jul 14), 016PTyzm (Jul 17), 01GC16LJ (Jul 27)
- confidence: low
- verify_note: Handle ties (210.4(B), 240.15(B)(1)) look right. The Article 605 subsection numbers and the statement about multiwire circuits are inconsistent across chats (one says multiwire is allowed for hardwired furniture, another says never). Controlling 1 of 3 circuits is about 33 percent; ASHRAE/IECC versions typically use percentages of receptacles and of furniture feeders, so the approach may not comply. See F5.

### E31 "Motor rated switch" is a disconnect, not a starter
- discipline: Electrical
- system: Motor circuits
- standard_text: Treat a motor-rated or horsepower-rated switch on a connection schedule as a disconnecting means only. Confirm that a controller with overload protection and the branch-circuit protection are specified elsewhere, and place the disconnect in sight of the motor unless the code exception applies.
- basis: The chat used NEC 2020 text for 430.102, 430.109 and 430.83 that is visible in the knowledge results.
- source_reference: NEC 430.102, 430.109(A)(1), 430.83; also 430.81 (controllers)
- source_chat: 01RKCT94 (Sep 1), 011B7y3V (Aug 12)
- confidence: high
- verify_note: Verified against NEC 2020 text visible in a chat. The same chat's claim that a fractional horsepower circulation fan "classically" falls under 430.81(A) (continuously operated motors of 1/8 hp or less that cannot be damaged by overload) is an over-reach and is not carried.

### E32 Electrical versus mechanical connection reconciliation
- discipline: Electrical
- system: Interdiscipline coordination
- standard_text: Reconcile the electrical equipment connection schedule against the mechanical schedules for every piece of equipment: voltage and phase, motor horsepower, MCA and MOCP, disconnect and starter type, connection method (hardwired versus cord and plug), tag uniqueness and VFD location. Remove blank or duplicate rows.
- basis: FIRM-B Part 6.1 lists these checks. A roof replacement review found duplicated fan tags and a schedule with blanked rows; a fan showed both cord-and-plug and a disconnect and starter.
- source_reference: FIRM-B v3.0 Part 6.1 and 6.2
- source_chat: 01UaoDQd (Sep 1), 011B7y3V, 01RKCT94, 01VxKKU9
- confidence: high
- verify_note: Process and coordination rule, no code citation needed. Aligns with the Mechanical run's controls coordination items.

### E33 Elevator feeds not sized on assumed motor data
- discipline: Electrical
- system: Elevators
- standard_text: Do not finalize elevator disconnect, fuse and feeder sizing on an assumed motor horsepower. Track it as an open coordination item until the elevator contractor submittal gives the actual current data, and coordinate shunt-trip and fire alarm recall interfaces.
- basis: One review found an elevator feeder and shunt-trip disconnect sized on an assumed 20 hp motor.
- source_reference: NEC 620.13, 620.53, 620.51; ASME A17.1 (recall); FIRM-B Section F interfaces
- source_chat: 01E59RNZ (Jul 27)
- confidence: low
- verify_note: Single chat, paragraph citations unverified (620.13, 620.53). Elevator shunt-trip requirements are jurisdiction and edition dependent.

================================================================
## 7. Lighting and controls
================================================================

### E34 Confirm the adopted energy code path and check both until confirmed
- discipline: Electrical
- system: Lighting / energy code
- standard_text: Confirm which energy code governs (ASHRAE 90.1 or IECC) and which edition. Until it is confirmed, review lighting power density and controls against both, document which standard each finding used, and flag the unconfirmed path as an item for the engineer of record.
- basis: FIRM-B Part 0, 2.1 and Section E state this directly.
- source_reference: FIRM-B v3.0 Part 0, 2.1, Section E; ASHRAE 90.1; IECC commercial
- source_chat: 016yRE34, 01E59RNZ, 01XsUWj5, 01REmFJ5, 01VpYJTu
- confidence: high
- verify_note: Process rule from firm text. Edition lists in FIRM-B (NEC 2017/2020/2023, ASHRAE 2016/2019/2022) are out of date relative to what one chat said is current (NEC 2026, ASHRAE 90.1-2025); I could not verify this claim.

### E35 Lighting controls: required control types shown and specified correctly
- discipline: Electrical
- system: Lighting controls
- standard_text: Show occupancy or vacancy sensors in the space types the adopted energy code requires, daylight-responsive controls where required, automatic shutoff and independent area controls, and specify an astronomical or programmable time switch with photocell for exterior lighting rather than a plain timer.
- basis: FIRM-B Section E; one review flagged a generic "time clock" for exterior lighting.
- source_reference: FIRM-B v3.0 Section E; ASHRAE 90.1 Section 9.4 and IECC C405.2 (section numbers as given in FIRM-B)
- source_chat: 01E59RNZ, 01GDZMuH, 01VpYJTu, 01REmFJ5
- confidence: medium
- verify_note: FIRM-B section numbers (9.4.1.1(g), C405.2.1 to C405.2.4, C405.4) and the claim "IECC C405.2.5.1" in a review are edition dependent. A 90.1 "multilevel at least two steps between 10 and 100 percent" statement appears in FIRM-B and was not verified.

### E36 Site lighting backlight, uplight and glare versus the credit or ordinance
- discipline: Electrical
- system: Site lighting
- standard_text: When a project pursues a light pollution credit or has a lighting ordinance, check each luminaire's specified backlight, uplight and glare rating against the maximum for the lighting zone for every fixture, using the manufacturer's rating or a TM-15 calculation from the photometric file, not an assumed value.
- basis: Chats covered LEED LZ3 compliance and a computed rating from an IES file.
- source_reference: IES TM-15 (BUG rating), LEED light pollution reduction
- source_chat: 01MAUxTw (Jul 17), 012pLVXq (Sep 2), 01WGqa4R (Aug 12)
- confidence: low
- verify_note: One chat said wall-mounted LED fixtures do not publish a BUG rating because they are not area lights. That is probably wrong, since many wall packs list one. LEED version and table values were read by OCR in one chat and are not trustworthy.

### E37 Illuminance verification against IES criteria
- discipline: Electrical
- system: Lighting design
- standard_text: Provide illuminance calculations for primary spaces and compare against the IES criteria, flagging spaces that are under target and spaces that are overlit as well as the effect on lighting power density.
- basis: One review iterated a redesign that fixed under-lit offices but over-lit a corridor and electrical room.
- source_reference: IES Lighting Handbook; FIRM-B v3.0 Section E ("illuminance levels meet IES criteria")
- source_chat: 01XsUWj5 (May 11)
- confidence: low
- verify_note: Benchmarks quoted in FIRM-B (for example office, corridor and stair foot-candle values) were not verified and are not carried.

================================================================
## 8. Fire alarm coordination (electrical drawings)
================================================================

### E38 Fire alarm power and interface coordination shown on the electrical drawings
- discipline: Electrical
- system: Fire alarm coordination
- standard_text: Show a dedicated, labeled circuit for the fire alarm control panel on the panel schedule and show the panel location consistently across the electrical plan, panel schedule and fire alarm drawings. Coordinate AHU shutdown, elevator recall and door holder interfaces between the electrical and fire alarm sheets.
- basis: FIRM-B Section F "Fire alarm coordination (electrical drawings)".
- source_reference: FIRM-B v3.0 Section F; NFPA 72; NEC Article 760
- source_chat: 018Q5m4K (Jul 9), 01P637US (Sep 23), 01K4gsNh
- confidence: medium
- verify_note: The chat that said "NFPA 72 requires the fire alarm panel near the main entrance" was relying on a FIRM-B checklist line and misattributed it to NFPA 72 (see F4). The 10.6.7 battery paragraph and Chapter 17/18 paragraph numbers in FIRM-B are edition dependent.

================================================================
## 9. Raceways, clearances and equipment support
================================================================

### E39 Pull box and junction box sizing
- discipline: Electrical
- system: Raceways / pull boxes
- standard_text: Size pull and junction boxes for conductors 4 AWG and larger by the NEC rules: straight pulls at least eight times the largest trade size; angle and U pulls at six times the largest raceway in a row plus the sum of the other entries in the same row on the same wall, calculating each row separately. Use a listed manufacturer size at or above the calculated size.
- basis: NEC 2020 314.28 text is visible in the chat and the calculation was applied correctly for a 4 inch conduit bank.
- source_reference: NEC 314.28(A)(1), 314.28(A)(2)
- source_chat: 01CaGYMH (Sep 22)
- confidence: high
- verify_note: Verified against NEC 2020 314.28 text in the chat. Chat's "12 to 16 inch minimum depth" for stacked conduits is an unsourced estimate and is not carried. Systems over 1000V use 314.71 (different multiples).

### E40 Working space at electrical equipment; UPS and inverter clearances
- discipline: Electrical
- system: Clearances
- standard_text: Provide working space at equipment likely to be serviced energized per the NEC depth, width and height rules, and the 90 degree door swing. For UPS and inverters, apply working space at the front, and add the manufacturer's listed ventilation clearances on the sides, rear and top, plus battery or energy storage spacing where batteries are present.
- basis: A chat correctly corrected the idea that the NEC requires clearance on all four sides of a UPS and showed the real basis (listing and battery rules).
- source_reference: NEC 110.26(A)(1), (A)(2), (A)(3), 110.3(B), 480.10(C), 706.20(C); FIRM-B Section B ("NEC 110.26 working clearances indicated")
- source_chat: 011jjxRX (Sep 9), 01VxKKU9, 01Lyc8xF
- confidence: high
- verify_note: Verified against the NEC 2020 Table 110.26(A)(1) text in the chat: for 151 to 600V to ground the depths are 3 ft, 3 ft 6 in and 4 ft for Conditions 1, 2 and 3. Do not store those values in the standard (kept out). See F2 for a chat that quoted the wrong table.

### E41 No foreign systems in the dedicated space above switchboards and panelboards
- discipline: Electrical
- system: Clearances
- standard_text: Keep piping, ducts and other equipment foreign to the electrical installation out of the dedicated space above switchboards, switchgear, panelboards and motor control centers. Where replacement mechanical equipment is installed near existing electrical equipment, identify whether the electrical equipment is one of these four types before accepting the location.
- basis: Construction-phase chat on an air curtain replacement reasoned that dedicated space applies only to those four equipment types and receptacles, junction boxes or small disconnects only need working space and access.
- source_reference: NEC 110.26(E), 314.29 (boxes accessible)
- source_chat: 01VxKKU9 (Aug 4)
- confidence: medium
- verify_note: 110.26(E)(1) and 314.29 are real and match what I know of the code; the NEC text itself for (E) was not shown in the chat. Check the 6 ft height and the suspended ceiling exception for the adopted edition.

### E42 Support exit signs and luminaires from structure, not from EMT, conduit or gypsum board
- discipline: Electrical
- system: Raceway and device support
- standard_text: Support exit signs and luminaires from building structure or the manufacturer's listed pendant mounting, not from EMT or conduit and not from gypsum board anchors. Fasten conduit to structure at each termination and at the code maximum intervals.
- basis: A construction-phase review rejected a field-proposed aircraft cable hanger anchored to drywall and clamped to the conduit, and drafted an RFI response.
- source_reference: NEC 300.11(A), 314.23, 358.12 (EMT uses not permitted, including support of luminaires), 358.30(A) (EMT support)
- source_chat: 01RdbC4m (Oct 1)
- confidence: medium
- verify_note: The prohibition on supporting luminaires from EMT is real, but the paragraph number (358.12(2)) as given in the chat is probably wrong; it is a different list item in 2017/2020. The 3 ft and 10 ft EMT support intervals are NEC values, verify in the adopted edition. The 314.23(H)(2) pendant-box items were not verified.

================================================================
## 10. Renovation work (general notes)
================================================================

### E43 Required general notes on renovation drawings
- discipline: Electrical
- system: Renovation / existing conditions
- standard_text: On renovation drawings add a general note stating the basis of the existing information (record drawings, field survey or owner data) and that the contractor must field verify and report discrepancies. If existing service information is not shown, add a note requiring a load survey of the existing service submitted to the engineer before new loads are connected.
- basis: Exact general note wording is given in FIRM-A 8.2/8.3 and FIRM-B 7.2/7.3.
- source_reference: FIRM-A v1.1 8.2, 8.3; FIRM-B v3.0 7.2, 7.3
- source_chat: 01MMsCQa (Sep 8, knowledge text), 01EE2o1Y context, 01Jgrq21
- confidence: high
- verify_note: Partial overlap with active standard (b) (field-verify existing panel feeders, breaker ratings and abandoned utilities). This adds the required general-note wording; consider merging with (b).

================================================================
## 11. PV, storage and microgrid interconnection
================================================================

### E44 PV and storage interconnection: directory, disconnect marking, busbar rule
- discipline: Electrical
- system: PV / energy storage
- standard_text: Where PV or battery storage connects to a building, show the directory or plaque at the service disconnects for all sources, mark PV disconnects and rapid shutdown labels, check the panelboard busbar connection rule for supply-side versus load-side connection, and bond rooftop PV to the lightning protection system where one exists.
- basis: Residential and commercial package reviews flagged a missing source directory at service disconnects, unmarked PV disconnects on roof plans and a PV to lightning protection bonding gap.
- source_reference: NEC 705.10 (directory), 690.13, 690.56(C), 705.12 (interconnection and busbar rules), NFPA 780
- source_chat: 01LN3gtC (Sep 23), 012emy7Q (Mar 5), 01GDZMuH
- confidence: medium
- verify_note: Articles 690 and 705 were substantially renumbered between 2017, 2020 and 2023. Every section number here needs verification per adopted edition. Chat noted the busbar rule could not be checked because the PV schedule was not legible in the conversion.

================================================================
## 12. Communications and lightning protection scope
================================================================

### E45 Telecom scope boundary: power to cabinets and bonding tie-in
- discipline: Electrical
- system: Special systems / telecom coordination
- standard_text: Show on the electrical drawings the dedicated circuit to each telecom rack or cabinet and the tie-in of the telecom secondary bonding busbar to the building grounding system. Keep telecom pathway content on the telecom drawings and coordinate shared conduit routes.
- basis: FIRM-B Section I and Part 6.6 (TR/IDF rooms with dedicated 20A circuits, cooling, UPS) and a chat that separated Division 26 from Division 27 scope.
- source_reference: FIRM-B v3.0 Section I, 6.6; TIA-607, TIA-942, TIA-569
- source_chat: 01PY3Av9 (Aug 20)
- confidence: medium
- verify_note: Scope boundary is common practice; the firm text is a checklist, not a code rule. Do not store the 20A figure as a standard without confirmation.

### E46 Lightning protection drawing content
- discipline: Electrical
- system: Lightning protection
- standard_text: Include a system narrative for lightning protection covering demolition of any existing system and the new work, and a requirement that the system be installed by a qualified listed contractor under the applicable standard.
- basis: A chat explained client review comments asking for a narrative, listed and certified installer requirements and NFPA 780 compliance.
- source_reference: NFPA 780, UL listing, LPI certification (as stated in the client comment)
- source_chat: 01ED5qnH (Sep 24)
- confidence: low
- verify_note: This is an owner or reviewer comment explained by Claude, not a firm position. The Master Electrician note was said to be a requirement "in many jurisdictions", which is jurisdiction dependent.

================================================================
## 13. QC process rules (not design standards)
================================================================

### E47 Review the power riser first; hold the review if it is missing
- discipline: Electrical
- system: QC process
- standard_text: Start every electrical drawing review with the power riser. If it is not in the package, request it and treat other findings as provisional or place the review on hold.
- basis: FIRM-A 5.1 and FIRM-B 2.2 state this as a critical rule; applied in at least 8 reviews.
- source_reference: FIRM-A v1.1 5.1; FIRM-B v3.0 2.2
- source_chat: 01A2rRLa, 01Lyc8xF, 016yRE34, 01UaoDQd, 01BkajcbN
- confidence: high
- verify_note: Process rule, firm text. One limited-scope package (roof equipment reconnects) legitimately had no riser; the chat recorded this as a FOR INFO item instead of a hold.

### E48 Record the adopted code editions and AHJ; do not assume
- discipline: Electrical
- system: QC process
- standard_text: Record the adopted NEC edition, energy code and edition, AHJ, available fault current, service voltage and occupancy at the start of each review and state any assumption in the review output. Drawing sets should state the adopted editions in the general notes.
- basis: FIRM-B 2.1 startup protocol. Several reviews found the NEC edition, energy path, AHJ and fault current missing from the cover sheet.
- source_reference: FIRM-B v3.0 2.1, 11.2; FIRM-A v1.1 1.3
- source_chat: 01E59RNZ, 016yRE34, 018eLq5W, 01UaoDQd
- confidence: high
- verify_note: Process rule, firm text.

### E49 Complete or remove placeholder keynotes and tables before issue
- discipline: Electrical
- system: Drawing hygiene
- standard_text: Remove or complete placeholder keynotes (for example "XX"), blank calculation tables and leftover boilerplate from other project types before issue.
- basis: Repeated minor findings (unfilled keynote text, blank voltage drop tables, residential boilerplate on a commercial sheet).
- source_reference: General drafting practice; FIRM-B v3.0 Section A
- source_chat: 01Lyc8xF, 01E59RNZ, 01LN3gtC, 01AzBW7p
- confidence: low
- verify_note: Obvious but it is a checklist item, not a design-basis standard. Consider leaving it out.

================================================================
## FLAGGED AS DOUBTFUL (do not store; or store only after correction)
================================================================

- F1. EGC size error. A review (chat 017DBq95, finding E-006) said an 800 A overcurrent device needs a 3/0 AWG copper EGC and called #2/0 undersized. Table 250.122 gives a smaller conductor for an 800 A device (my recollection: 1/0 copper; verify against Table 250.122). Do not use. E16 stores only the method.
- F2. Wrong working-space table. A DC plenum chat (01SpSCtz, older Project, Aug 12) gave 3.5, 4 and 5 ft for Conditions 1 to 3 at 151 to 600V. The NEC 2020 table visible in another chat gives 3 ft, 3 ft 6 in and 4 ft. The same chat said the limited-access provision of 110.26(A)(4) was "added in 2017" and that DC adopted the 2014 NEC; neither claim could be verified and the NEC 2020 text shown in another chat contains a 110.26(A)(4) Limited Access heading. Do not store any plenum working-space standard from that chat.
- F3. NFPA 110 fuel supply. FIRM-B (Section G) and a review say NFPA 110 Level 1 needs a 96 hour fuel supply (some AHJs 72). NFPA 110 defines classes of defined operating time (for example 2, 6 and 48 hours and others); a blanket 96 hour requirement is not something I can confirm. This may be an IBC, NFPA 99 or AHJ/owner requirement instead. Verify before any fuel runtime standard is stored. Possible firm-text error.
- F4. Fire alarm panel location. A chat said NFPA 72 requires the fire alarm control panel near the main entrance. The source was a FIRM-B checklist line ("FACP location shown near main entrance within rated enclosure"), not NFPA 72. The chat also treated a terminal cabinet as the FACP.
- F5. Systems furniture and Article 605. Chats cite 605.7, 605.8, 605.9(C) and (D) inconsistently and one says multiwire circuits are not permitted while another says they are allowed for hardwired furniture. "Control one of three circuits" for an energy code may fall short of the percentage-based rule.
- F6. Energy code section numbers for automatic receptacle control (C405.10, C405.11, ASHRAE 90.1 Section 8.4.2) conflict or cannot be verified. Local amendments quoted (72 inch separation, 5000 sq ft schedule areas) are not firm.
- F7. GFCI citations. 210.8(A)(7) cited for a sump pump room, 210.8(B)(2) for garages, 210.8(D) said to waive branch-circuit GFCI for appliances with integral GFCI. The 2020 subsection letters and items differ from these. A vending machine finding was downgraded within the chat after the reviewer challenged it, so that chat is not a stable source.
- F8. EMT support prohibition numbered 358.12(2) in one chat; the support-of-luminaires item has a different number in 2017/2020.
- F9. Emergency lighting "continuous load, size at 125 percent" claim (chat 01PftBx7). Emergency lighting only operates on loss of normal power; classification as continuous for conductor and overcurrent sizing is not established and the Table 220.42 footnote was described incorrectly.
- F10. Firm UPS and SPD guidance conflicts and is partly policy. UPS growth 20 to 25 percent and 10 to 15 percent (FIRM-A) versus minimum 20 percent (FIRM-B). "SPD mandatory" for data centers and healthcare is firm policy, not an NEC requirement as written. Do not state these as code.
- F11. Wall pack BUG ratings. A chat said BUG ratings are only published for area and flood luminaires. Unverified and probably wrong.
- F12. 700.10(D) occupancy triggers and "2 inches of concrete" detail in chat 01QiMEu5 not verified. NEC 700.8 SPD requirement is 2020 or later only.
- F13. Aug 19 review chat in the older Project (0165wqhJ) and the City Springs / UMD chat (01SUqB3T, Haiku, older Project) are model-generated with no firm text and several unsupported numerical claims (for example transformer primary OCPD examples "125 A maximum primary" and a "3 percent to secondary, 5 percent total" voltage drop requirement). Not used as a source for any standard above.
- F14. Numeric thresholds seen and NOT stored: AIC minimums by frame (Sizing Charts), phase imbalance 10 percent (FIRM-B severity), UPS growth percentages, arc-flash cal/cm2 values, spare capacity margins, conduit fill 40 percent (this one is NEC Chapter 9 Table 1 and correct, but not stored), the pull box 12 to 16 inch depth, transformer sizing examples.

================================================================
## ALREADY COVERED by the three active production standards
================================================================

(a) Feeder schedule, plan keynotes and one-line reconciliation (conduit, conductor type, PVC schedule, fire rating):
- Missing feeder or conductor sizes on homeruns and riser feeders: 01Nw9XUU (Mar 16), 01Lyc8xF (Apr 9), 01U2cCVv, 01Jgrq21.
- Feeder ampacity versus breaker mismatches and conduit size or fill discrepancies: 017DBq95 (Apr 9), 01AoRNVN (Apr 12), 018wW7xh (Mar 5), 01Qo7v1i (Mar 6), 01AzBW7p (Mar 20).
- Two-hour rated feeders not tagged on the riser: 012emy7Q, 01LNSaCH (see also candidate E20 which adds the NEC 700.10 method).
- Monument sign feeder with conduit size but no conductor or source: 01E59RNZ.

(b) Renovation field verification of existing panels, breakers, abandoned services and feasibility of directed device changes:
- Existing switchboard capacity and condition not documented: 01LNSaCH, 018wW7xh, Osceola review (019Q2Jzm), 01SUqB3T (UMD-type chat), 016yRE34 (nine demolished panels, no landing of loads).
- Reuse of an existing disconnect for a different load; verify rating and type before reuse: 01WGqa4R (Aug 12).
- Retrofit of 120V occupancy sensors on existing wiring: neutral at switch box, LED driver compatibility, shared lighting and receptacle circuits, box fill (NEC 314.16): 01VpYJTu (Jul 23).
- Existing panel schedules to be updated and verified in the field: 01SUqB3T, 01MMsCQa.

(c) Campus projects: resolve service basis with campus utility, existing primary conditions, splice availability, temporary power:
- Campus 13.2 kV loop splice work with no detail drawing: 018wW7xh (Mar 5).
- Project connected to a campus 3000 A service with no capacity validation: 01SUqB3T (UMD-type chat).
- Utility data sheet resolving a "single 500 kcmil utility conductor" concern from 300 kVA transformer: 01MNmAY8 (a worked example of confirming service basis with the utility; closes the finding).

================================================================
## CHATS REVIEWED / SKIPPED (per Project)
================================================================

### Project "Eng - Electrical Quality Control Reviewer" (claude_proj_011CXttUQLwaDD3uYGhhrRhK), 12 chats since 2026-02-01
Read in full or in part:
- 019Q2Jzm File location review (Apr 6): large Osceola-type draft CD review (artifact), used for E02, E04, E14.
- 016E5eiW Gilroy 911 Call Center electrical QC (Jun 11): mission-critical review (UPS, generator, riser). Used for E19, E26. Tool-use input truncated by the connector; the Excel content was not fully readable.
- 01SpSCtz HVAC equipment clearance in ceiling plenums (Aug 12): used only for flag F2.
- 0165wqhJ Review request (Aug 19): model summary only, flagged F13.
- 01SUqB3T Electrical quality control review (Aug 26 to 27, Haiku): two reviews and a symbol explanation; low quality; flagged F13.
- 01CAx77o Utility bill energy consumption analysis (Sep 15): not fetched, not a standards chat.
- 01PLTBhu Photo feedback for punch list (Sep 15): field photo, support spacing and temporary cord comments; no reusable standard beyond E42.
- 0129iwfn Plug load control under NEC standards (Sep 25): used for E29.
Skipped, not standards-bearing:
- 01SEaUG3 Download apple project PDF (Feb 12): file-access failure.
- 01EP7mqn Quality control check (Jul 20): image unreadable, no findings.
- 01QHbtXJ Qmark equipment specs (Aug 18): no plans, spec request.
- 014So19T AutoCAD Excel linking error (Jul 27): CAD tooling, not fetched.

### Project "Electrical QAQC Reviewer" (claude_proj_011CYDymRgvzjZkUXP6x3Uzc), about 96 chats since 2026-02-01
Used (read answer text, many with full knowledge excerpts): 01EE2o1Y, 01Bdnfop, 014wkk5u, 01XU2SQB, 018wW7xh, 012emy7Q, 01Qo7v1i, 01LNSaCH, 01Nw9XUU, 011HaT7M, 01Uv7FzU, 01GDZMuH, 01KJ81G9, 01PkpRaz, 01YTdZVY, 01AzBW7p, 01A2rRLa, 01XvYcGD, 01Lyc8xF, 01Jgrq21, 017DBq95, 01K4gsNh, 01U2cCVv, 01AoRNVN, 01XsUWj5, 01BkajcbN, 015i6Kbn, 018Q5m4K, 01Viq5XL, 01GAcZ3S, 016PTyzm, 01MAUxTw, 015eJgoF, 01VpYJTu, 01E59RNZ, 01GC16LJ, 012a6BVh, 01VxKKU9, 01PftBx7, 011pzvAX, 011B7y3V, 01WGqa4R, 0194Xmjr, 01VVH5HR, 016yRE34, 01REmFJ5, 01H36HUn, 01PY3Av9, 0169RWrU, 019X6nJi, 01RCdTMr, 01PvGKcd, 01BoYu2L, 01UaoDQd, 01RKCT94, 012pLVXq, 014TAxXR, 017w8KGZ, 018eLq5W, 01MMsCQa, 01PWnX1p, 011jjxRX, 01C2T1Yw, 01Na1YZb, 01TPtUD8, 01FamQxH, 01MNmAY8, 016Z91Sn, 01CaGYMH, 01PxJZXT, 01P637US, 01LN3gtC, 01ED5qnH, 01XekZWe, 01SfRMJ7, 01DVEKCu, 01QiMEu5, 017HPwgD, 01RJd8K5, 01RdbC4m, 01UJKEnJ, 01H43o9e, 013R3jCd.
Of these, yielded no reusable standard (project-specific, product-selection, scope or drafting help only): 011pzvAX (snubbers explanation), 01H36HUn (dwelling dryer demand factors, NEC 220.54; residential, not firm practice), 0194Xmjr (solar battery flow diagram), 013R3jCd (panel circuit extraction), 01SfRMJ7 (fixture datasheet and pricing), 01PxJZXT (pump timer wiring), 017HPwgD (air curtain cut sheet, mostly equipment-specific; it did flag a missing disconnect and low SCCR as general review points, already captured under E31/E01), 016Z91Sn (utility bill peak demand), 01RJd8K5 and 01ED5qnH (image explanations), 01H43o9e, 01UJKEnJ, 014TAxXR (email drafting), 01DVEKCu (scope versus budget), 01KNFXim and 01PvGKcd (LEED forms), 01PWnX1p and 01C2T1Yw (closeout and warranty), 017w8KGZ (submittal markup), 01RCdTMr (narrative), 01BoYu2L (fire alarm device count), 01Na1YZb/019X6nJi/01UaoDQd/01TPtUD8 (generic review runs with no new position beyond items above).
Skipped without extracting:
- 01HUQuQX, 01KCZELr, 018xdFLv: PDF or MSG to markdown conversion.
- 01Jcrs4N: PDF data to spreadsheet.
- 01Eab8bM: performance review (not technical).
- 01RoNyRe: microgrid bar graph.
- 01WYzgjW, 012rTcsQ: mechanical tag and mechanical schedule work.
- 01Rwz12v: review against Indian design standards (not US practice).
- 01Hos9j7, 011KKWx7: deleted chats with no title.
- 01XekZWe was used only to identify the loaded knowledge files.
Ignored as other Projects: cond files for plumbing and mechanical chats that appeared in the shared scratch folder were not used.

Counts of candidates by confidence (49 total): high 20 (E01, E02, E06, E10, E11, E12, E15, E16, E17, E18, E19, E27, E31, E32, E34, E39, E40, E43, E47, E48), medium 21, low 8. 14 items flagged doubtful (F1 to F14).
