# Mechanical QC candidate engineering standards (READ-ONLY extraction, not verified firm positions)

Source: claude.ai Project "Eng - Mechanical Quality Control Reviewer" (claude_proj_011CXBhzSv81hiXkpJ7kYEa5), chats updated since 2026-08-01.
Caveat: assistant answers in the chats are Claude output. Confidence reflects (a) whether a cited code section or the firm's own QC guidance supports it and (b) my independent sanity check. FLAG marks items that look wrong, overspecific, or unsupported.
Firm sources named in chats: "HVAC Design Review Guide 2012" (Steve Miller, in the Project as "mechanical QC check guidance.pdf"), Arthur Bell "HVAC Equations, Data and Rules of Thumb" 2007, "SETTY Mechanical Controls QC Instructions" v19/v20/v21 (Directives 26-1..26-7, Lessons Learned LL-xx), ASHRAE Controls reference (Guideline 36 style), McQuay AG 31-003.

Ordering: grouped by system; within each group ordered by confidence.

================================================================
## A. Refrigerant safety / equipment selection (A2L)
================================================================

### A1. Electric resistance heat in A2L refrigerant airstream
- discipline: Mechanical
- system: Packaged DX / heat pump units with A2L refrigerant (R-454B, R-32)
- standard_text: Where a unit uses an A2L refrigerant, do not put electric resistance heating elements in the same airstream as the refrigerant coil unless the manufacturer's listing to UL/IEC 60335-2-40 explicitly permits that arrangement. Otherwise relocate supplemental heat outside the unit airstream (duct heater downstream of a listed separation, unit heaters, hydronic reheat). Show refrigerant type on the equipment schedule.
- basis: A2L mild flammability; ignition-source limits in the product safety standard and ASHRAE 15; firm Directive 26-7.
- source_reference: SETTY Mechanical Controls QC Instructions Directive 26-7 (v19/v20); ASHRAE 15-2022; UL/IEC 60335-2-40
- source_chat: claude_chat_01AWqhtaJ9H3fF3WYX81ysjV (RTU-1), claude_chat_01MgR8XLEE9gJKdxdhzAPamU (BWI 134), claude_chat_01Nfwjq9fK3K5FLXfRoHTKmZ (RTU-1 schedule lacks refrigerant column), claude_chat_01KKnHYbwE8GpMpnByaV6B3t (A2L status), claude_chat_01Rf3xevpdFdxNdV4HBe6fo5 (A2L chiller)
- confidence: medium
- verify_note: FLAG (overbroad as phrased in chats). The chats say the standards "prohibit" resistance heat in an A2L airstream. UL 60335-2-40 and ASHRAE 15 limit ignition sources (surface temperature, enclosure/separation, leak mitigation) and factory-listed A2L units with integral electric heat do exist. I reworded to "unless the listing permits". Confirm the Directive 26-7 wording with the firm owner before storing as an absolute prohibition. The chat also noted that a leak-triggered shutdown sequence is a compensating control, not removal of the hazard; that is a reasonable position but a firm call.

### A2. A2L refrigerant: charge vs room volume, leak detection, ventilation
- discipline: Mechanical
- system: Indoor refrigeration equipment / mechanical rooms (A2L)
- standard_text: For indoor equipment using A2L refrigerant, show refrigerant type, a charge-versus-room-volume check, refrigerant detection, and interlocked ventilation or mitigation sequence where the charge exceeds the allowable room limit.
- basis: ASHRAE 15 and 34 classification; mitigation requirements in the product standard.
- source_reference: ASHRAE 15 (chat cites 2022 and "2024 current"); ASHRAE 34; SETTY QC v21 refrigerant items
- source_chat: claude_chat_01Rf3xevpdFdxNdV4HBe6fo5, claude_chat_01KKnHYbwE8GpMpnByaV6B3t
- confidence: medium
- verify_note: Substance is sound. Edition claims in chats ("2024 is current", "2022") are unverified; cite the AHJ-adopted edition instead.

================================================================
## B. Toilet exhaust / ventilation
================================================================

### B1. DOAS toilet exhaust: six conditions (Directive 26-2)
- discipline: Mechanical
- system: DOAS toilet exhaust
- standard_text: When toilet exhaust is served by a DOAS, the toilet branch must not be the last take-off on the exhaust riser, branch duct is oversized one nominal size, a CAR or CAV terminal is sized for total code-required toilet exhaust CFM, device selection covers the full inlet static range from minimum turndown to full load, the device and setpoint CFM appear on drawings and balance schedule, and inlet velocity/acoustics are verified per manufacturer data.
- basis: Firm directive; keeps toilet exhaust above code minimum at all DOAS turndown conditions.
- source_reference: SETTY Mechanical Controls QC Instructions v20 Directive 26-2; IMC Chapter 4
- source_chat: claude_chat_01Y9iw1wUkAJNqoJdq4JKQ7Q (quoted from project knowledge)
- confidence: high
- verify_note: Quoted from the firm's own document, so reliable as a firm position. Confirm it is unchanged in v21.

### B2. Toilet exhaust through a DOAS energy recovery wheel
- discipline: Mechanical
- system: Toilet exhaust / energy recovery
- standard_text: Do not route toilet (Class 2) exhaust through an energy recovery device that can carry exhaust-side air into supply to Class 1 spaces unless the device and its leakage (EATR) meet ASHRAE 62.1 limits for Class 2 air. Prefer separate toilet exhaust fans or connect toilet exhaust downstream of the wheel.
- basis: ASHRAE 62.1 air classification and energy recovery leakage provisions.
- source_reference: ASHRAE 62.1 (chat cites "5.18, Table 6-1" and "IMC 514")
- source_chat: claude_chat_01Y9iw1wUkAJNqoJdq4JKQ7Q
- confidence: low
- verify_note: FLAG (wrong as stated in chat). The chat calls rotary-wheel recovery of restroom exhaust a flat "code violation" and says a run-around coil is "the only compliant type". ASHRAE 62.1 permits energy recovery from Class 2 exhaust within leakage limits (and 90.1 has no exhaust-class exception). Section numbers cited (5.18, IMC 514) are not verified. Do not store the "violation" wording. The practical preference (separate toilet exhaust or post-wheel connection) is a common design position but a firm decision.

### B3. Single-occupant toilet room: exhaust only, transfer air, no dedicated supply
- discipline: Mechanical
- system: Toilet exhaust
- standard_text: Single-occupant toilet rooms are exhaust-only, negative to adjacent space, with transfer air through a door undercut or transfer grille. Do not schedule a supply diffuser. Confirm the door undercut or grille can pass the exhaust airflow at acceptable velocity.
- basis: ASHRAE 62.1 Class 2 air classification; common practice.
- source_reference: ASHRAE 62.1 Table 6-4 (private toilet 25 cfm continuous / 50 cfm intermittent); Arthur Bell Part 8
- source_chat: claude_chat_01Fe3GZHrNmrA1ejLFEjTrPe
- confidence: medium
- verify_note: FLAG on numbers. The chat blends 62.1 private-toilet rates (25/50 cfm per fixture) with Bell rules of thumb (2.0 cfm/sf, 10 ACH, "100 cfm per water closet or urinal" for public toilets). Those are different bases; the 100 cfm/fixture figure is a Bell public-toilet rule of thumb, not a 62.1 or IMC single-occupant minimum. A 3/4"-1" undercut passing the full exhaust is also optimistic (a 3 ft door with 1 in undercut is about 0.25 sf; at 25-50 cfm that is fine, at 100 cfm it is not). Door undercut on rated or corridor doors is limited by the architect and code. Store only the exhaust-only/transfer-air principle.

================================================================
## C. Hydronic piping / insulation
================================================================

### C1. Insulate indoor condenser water piping that sees chilled-water temperatures
- discipline: Mechanical
- system: Condenser water / heat pump loop
- standard_text: Where a condenser or heat pump loop runs below roughly 60 F in any operating mode, or is used for waterside economizer chilled water, insulate it to chilled-water thickness with a continuous closed-cell vapor barrier and insulation shields at hangers. A loop that stays between 60 F and 105 F year-round needs no insulation for code purposes.
- basis: Energy code pipe insulation table (exempt 60-105 F); condensation control when pipe surface is below room dew point.
- source_reference: Arthur Bell Part 35.02 notes 2 and 9, Part 19.14(E); ASHRAE 90.1 pipe insulation table; ASHRAE Fundamentals Ch. 4
- source_chat: claude_chat_01HagFV1f1rGwxEDUSkx6vSy
- confidence: high
- verify_note: Sound and well supported. Minor: the chat's dew point table gives about 56 F for 75 F/55% RH; actual is about 58 F (immaterial to the conclusion). Thickness table values should be re-pulled from the adopted energy code edition, not from Bell 2007.

### C2. Chilled water building connection: P&T plugs, flow meter straight run, bypass spool, ΔT basis
- discipline: Mechanical
- system: Chilled water / CUP building connection
- standard_text: Chilled water connection details show P&T test plugs at the entering and leaving points of major devices, manufacturer-required straight pipe at flow meters, a meter bypass or isolation arrangement for service, and a design ΔT that traces to the owner/plant basis of design. Show a BAS points cross-reference where building and plant BAS exchange signals.
- basis: HVAC Design Review Guide checklist items (coil piping detail, flow meter straight length, bypass provisions, primary/secondary arrangement).
- source_reference: HVAC Design Review Guide 2012 s3.10-3.11, s3.14, s3.29, s4.7b
- source_chat: claude_chat_016xGmniiXJ1dXGeCruQNCBj
- confidence: medium
- verify_note: Checklist items come from the firm's guidance PDF, so reasonable. FLAG: the P&T plug locations in the follow-up answer (four locations) and the meter bypass spool are the chat's elaboration, not cited guidance. Treat as suggestions.

### C3. Waterside design temperatures and pressures on the plans
- discipline: Mechanical
- system: Hydronic piping documentation
- standard_text: Show waterside design temperatures and operating and test pressures on the flow diagrams or plans, not only on equipment schedules.
- basis: Firm lessons-learned item; contractors size expansion tanks, relief valves and pipe class from it.
- source_reference: SETTY QC v19-v21 Section 6 lessons learned (waterside temps/pressures)
- source_chat: claude_chat_011ybGWRwfW4kw5MFNHFjTnw, claude_chat_01Rf3xevpdFdxNdV4HBe6fo5, claude_chat_01PgZeAu2aZ3qLuv5PumkzVY, claude_chat_01S5RhKcuPdApmuXMinFNXMP
- confidence: high
- verify_note: Firm lessons-learned item named repeatedly. Safe.

### C4. Tie chiller/coil flow to ΔT with Q = 500 x GPM x ΔT
- discipline: Mechanical
- system: Chilled water
- standard_text: Verify scheduled tons, GPM and ΔT agree (tons = 500 x GPM x ΔT / 12,000). Scheduled ΔT should match the printed temperatures (e.g. 7/12 C is 5 K = 9 F, not 10 F).
- basis: Water sensible heat equation.
- source_reference: ASHRAE Fundamentals; HVAC Design Review Guide s3
- source_chat: claude_chat_01Rf3xevpdFdxNdV4HBe6fo5, claude_chat_011ybGWRwfW4kw5MFNHFjTnw, claude_chat_01PgZeAu2aZ3qLuv5PumkzVY
- confidence: high
- verify_note: Arithmetic checked: 87.12 gpm x 10 F x 500 / 12,000 = 36.3 tons, matches chat. 7/12 C = 5 K = 9 F, correct.

================================================================
## D. Controls / sequences
================================================================

### D1. Freeze protection for 100% outdoor air units
- discipline: Mechanical
- system: DOAS / 100% OA AHU controls
- standard_text: Units handling 100% outdoor air in a heating climate need an air-side low-limit (freezestat) independent of refrigerant-circuit protection, a preheat or heating coil upstream of the cooling coil, a freeze recirculation or glycol strategy for hydronic coils, and the 99.6% winter design temperature stated on the narrative or schedule.
- basis: Firm lessons learned (heating coil upstream of cooling coil; freeze protection on OA AHUs); coil freeze physics.
- source_reference: SETTY QC v21 Section 6 lessons learned; chat also cites "IMC 607.5"
- source_chat: claude_chat_01KKnHYbwE8GpMpnByaV6B3t, claude_chat_01XuhDfdWMzwVX9ghC48Ygk5, claude_chat_01PgZeAu2aZ3qLuv5PumkzVY, claude_chat_011ybGWRwfW4kw5MFNHFjTnw
- confidence: high
- verify_note: FLAG on the citation only. One chat cites IMC 607.5 for freeze protection; IMC 607.5 is fire/smoke damper installation, not freeze protection. Drop that citation; keep the firm lessons-learned reference. The note that a heat pump RTU uses one reversible coil, so the coil-order rule does not apply, is correct.

### D2. Sequence staging needs hysteresis and minimum on/off time
- discipline: Mechanical
- system: Controls / sequences of operation (CO and NO2 garage ventilation; general staging)
- standard_text: Stage-up and stage-down setpoints must differ (adjustable deadband), and staged outputs should carry an adjustable minimum time in stage to prevent short-cycling. For dual-gas garage logic, step the fan down only when ALL monitored gases are below their stage-down values (AND), not when any one is.
- basis: Control stability; sensor noise; ASHRAE Controls reference staging conventions.
- source_reference: ASHRAE Controls reference (deadband and anti-short-cycle timers)
- source_chat: claude_chat_012kQyYJhQcY47uw3vLGfa8j
- confidence: high
- verify_note: The OR vs AND point is correct logic. FLAG: the chat's 0.5 ppm NO2 off-point and 5 minute hold are project suggestions, not standards; do not store specific numbers. Also FLAG the claim that NO2 sensors are commonly mounted 12-18 in AFF: NO2 is heavier than air but the chat's reasoning was garbled and no source was cited. Do not store a sensor mounting height without a code/manufacturer basis.

### D3. Sequence completeness: setpoints, points list, frost control, defrost, safety modes
- discipline: Mechanical
- system: Controls / sequences of operation
- standard_text: Each unit sequence needs numeric setpoints, a complete BAS points list, defined smoke/safety modes, ERV frost control with setpoint and action, heat pump defrost handling, and logic for every heat source shown on the schedule (e.g. electric heat stages). Sequence, control diagram, schedule and submittal must describe the same hardware.
- basis: HVAC Design Review Guide controls checklist; Guideline 36 style sequences.
- source_reference: HVAC Design Review Guide 2012 s4; ASHRAE Guideline 36; SETTY QC v21 Section 4E
- source_chat: claude_chat_01AWqhtaJ9H3fF3WYX81ysjV, claude_chat_01KKnHYbwE8GpMpnByaV6B3t
- confidence: medium
- verify_note: Good checklist-style position. Project findings (hot gas reheat not on schedule, electric heat missing from sequence) are project specific, not standards.

### D4. VAV with DCV: check zone minimum airflow against sensible load and reheat
- discipline: Mechanical
- system: VAV / DCV
- standard_text: When DCV or occupancy logic can reduce VAV box minimum airflow, check that the minimum still offsets the zone sensible load (CFM = Btu/h / (1.08 x ΔT)) and that diffuser throw holds at minimum flow. On changeover multi-zone systems with no zone reheat, confirm zone diversity so one warm zone cannot be locked into heating-mode supply air.
- basis: Sensible heat balance; air distribution at turndown.
- source_reference: ASHRAE 62.1 s6.2 (air distribution), ASHRAE Fundamentals Ch. 20
- source_chat: claude_chat_01QYeWS35KSxiCdm5rKkByBy
- confidence: low
- verify_note: FLAG. Analysis was project specific and the chat later admitted its heat-gain values were its own placeholders (the user then supplied TRACE loads and the corridor-gain assumption reversed). The reasoning is physically fine but is design-engineering judgment, not a firm standard. The "30% of box max per 90.1" statement is loose. Store only as a review prompt, if at all.

================================================================
## E. Ductwork / drawing conventions
================================================================

### E1. Preferred duct fittings and sheet organization (Directives 26-4 and 26-3)
- discipline: Mechanical
- system: Ductwork
- standard_text: Confirm preferred duct fittings (B, D, F, H) are the project default in details, plans, risers and flow diagrams, and flag square-throat turning-vane elbows without a documented field constraint. Check sheet organization per the firm directive.
- basis: Firm directives.
- source_reference: SETTY QC v19-v21 Directive 26-4 (fittings), Directive 26-3 (sheet organization)
- source_chat: claude_chat_01Y9iw1wUkAJNqoJdq4JKQ7Q (quote), claude_chat_01Nfwjq9fK3K5FLXfRoHTKmZ, claude_chat_01MgR8XLEE9gJKdxdhzAPamU
- confidence: high
- verify_note: Firm directive text; fitting letters not independently checkable. Safe to store as firm QC practice.

### E2. Single line vs double line duct by phase and scale
- discipline: Mechanical
- system: Drawing conventions
- standard_text: Show rectangular duct double-line at 1/8 in scale or larger in DD final and CD and in all mechanical rooms and sections; single line is acceptable at SD, for round duct, flex runouts, and schematic diagrams. Show flow and riser diagrams at SD for multi-story buildings so shaft space is allocated.
- basis: Drawing maturity vs implied precision; shaft coordination.
- source_reference: None cited (chat mentions SMACNA / Architectural Graphic Standards generally)
- source_chat: claude_chat_01EMaegKacXdL7bm8Lbu28RQ
- confidence: low
- verify_note: FLAG. No firm or code source. SMACNA does not define this; it is a drafting convention. The chat's table is plausible common practice but should be a firm decision. Also chat says no controls schematics at SD; many firms differ.

### E3. Duct size notation and congruence
- discipline: Mechanical
- system: Ductwork
- standard_text: Duct sizes noted on plans are inside clear dimensions excluding insulation or liner. Labeled velocities must match CFM and size; recompute rather than reusing placeholder values.
- basis: Design Review Guide ductwork checklist; arithmetic.
- source_reference: HVAC Design Review Guide 2012 (duct notes); SMACNA
- source_chat: claude_chat_01PgZeAu2aZ3qLuv5PumkzVY
- confidence: medium
- verify_note: Check: 850x300 mm at 3230 cfm gives 3230 cfm = 1.524 m3/s over 0.255 m2 = 5.98 m/s = 1177 fpm, matches chat.

================================================================
## F. Outdoor air intakes / exhaust separation
================================================================

### F1. Intake and exhaust separation (10 ft)
- discipline: Mechanical
- system: Outdoor air intakes, kitchen/toilet exhaust discharge
- standard_text: Keep outdoor air intakes at least 10 ft horizontally from exhaust discharges and other contaminant sources unless the adopted code allows less; treat the 10 ft as a minimum and note the actual dimension on the plans.
- basis: IMC outdoor air intake location requirement.
- source_reference: IMC 401.4 (chat sometimes calls it "Table 401.4"); ASHRAE 62.1 Table 5-1
- source_chat: claude_chat_017jj8YW1jJ9iaDZrFQpUZ7p, claude_chat_011WvjbmfnbWJ6VmKxLdicED
- confidence: medium
- verify_note: FLAG on citation: 401.4 is a section, not a table in IMC. Confirm adopted edition. Kitchen grease exhaust separation under NFPA 96 and IMC 506 may differ.

### F2. Driveway / carport as a contaminant source
- discipline: Mechanical
- system: Outdoor air intakes
- standard_text: Measure intake separation from the vehicle parking footprint (including carport), not only the paved driveway; upgrade the separation category if the carport is partly enclosed or the intake is near a garage entry.
- basis: ASHRAE 62.1 Table 5-1 separation categories (driveway/street/parking 5 ft; garage entry/loading/drive-in 15 ft; truck dock/bus 25 ft; high-traffic thoroughfare 25 ft).
- source_reference: ASHRAE 62.1 Table 5-1; Maryland mechanical code 401.4 (10 ft)
- source_chat: claude_chat_011WvjbmfnbWJ6VmKxLdicED
- confidence: low
- verify_note: FLAG. The chat concludes a single-family driveway does not trigger the code 10 ft rule because 62.1 lists 5 ft for driveways. The adopted code (10 ft from streets, alleys, parking lots) is the legal minimum; 62.1 is a different document and 5 ft is less than 10 ft. This is an interpretation that needs AHJ confirmation and is not a firm position. 62.1 table values appear correct from memory. Do not store the conclusion.

================================================================
## G. Equipment installation (candidates from the 3 previously read chats)
================================================================

### G1. Air-cooled chiller on outdoor pad on grade
- discipline: Mechanical
- system: Chiller installation / vibration isolation
- standard_text: Provide vibration isolation (neoprene or spring) between chiller base and pad. Detail seismic anchorage with structural engineer sign-off. Use non-shrink grout under base rails only. Slope the pad away from the unit, show manufacturer clearances, use flexible pipe connections, use air-entrained concrete for freeze-thaw per ACI 318, and coordinate pad reinforcement with operating weight.
- basis: Firm QC guidance PDF, ASHRAE 15, IBC seismic provisions, ACI 318.
- source_reference: "mechanical QC check guidance" (HVAC Design Review Guide 2012); ASHRAE 15; IBC; ACI 318
- source_chat: claude_chat_01EECHDdeCAq2wT8hFG3BMaQ (provided in digest)
- confidence: medium
- verify_note: Not re-read; from the digest. Bolting/anchor information on rubber-pad mounted equipment is confirmed in the guidance excerpt seen in another chat. One tension: "non-shrink grout under base rails" combined with "vibration isolation between base and pad" needs checking against the isolator type; grout under rails is for rigid-mounted bases.

### G2. Rooftop DOAS on steel dunnage
- discipline: Mechanical
- system: Rooftop unit vibration isolation
- standard_text: Use restrained (housed, snubbed) spring isolators at all corners with seismic design by a licensed structural engineer. Provide flexible duct connections at every duct connection, flexible pipe connections with the first rigid support off the isolated equipment, and schedule operating (not shipping) weight.
- basis: Seismic/vibration practice; structural coordination.
- source_reference: HVAC Design Review Guide 2012 s5-s8; chat did not cite a code section
- source_chat: claude_chat_01Qz3BgPbeqiaADJuPueToPu (provided in digest)
- confidence: low
- verify_note: FLAG. The chat claimed 2.0-2.5 in static deflection on steel dunnage; this is an unverified rule of thumb (deflection depends on supporting-structure stiffness; ASHRAE Applications vibration chapter ties deflection to span and equipment RPM). "Flexible duct connections min 18-24 in" is also not a standard (typical flex connection length is 3-6 in for fan connections). Store only the restrained spring/SE sign-off and operating weight points.

### G3. 460/3/60 heat pump in a ceiling plenum
- discipline: Mechanical
- system: Equipment clearance / electrical coordination
- standard_text: Provide NEC 110.26 working space (151-600 V: 3 ft depth for condition 1, 30 in width, 6.5 ft headroom), locate the disconnect outside the plenum in sight and lockable, use plenum-rated wiring, show a dimensioned clearance diagram, provide 24 in service clearance, pipe condensate to a drain, and run an ASHRAE 15 analysis for refrigerant in a return plenum.
- basis: NEC, firm QC v19 D-2, Arthur Bell.
- source_reference: NEC 110.26; NEC 440.14; NEC 300.22; SETTY QC v19 D-2; Arthur Bell 43.05.D; ASHRAE 15
- source_chat: claude_chat_018Meo2gi129vNdUoaRzXWqW (provided in digest)
- confidence: medium
- verify_note: NEC 110.26 voltage band is 151-600 V; wording corrected. NEC 110.26(A)(3) minimum headroom is 6.5 ft or equipment height if greater (correct), and (A)(1) depth for condition 1 is 3 ft (correct). Condensate and ASHRAE 15 return plenum items are good practice; plenum use of A2L equipment needs separate review (see A1/A2).

================================================================
## H. Equipment selection / project record checks
================================================================

### H1. Compare scheduled zone airflow to load-calc airflow and ventilation requirement
- discipline: Mechanical
- system: VAV / unit ventilator / ERV schedules
- standard_text: Cross-check each zone's scheduled supply airflow against the load-calc cooling airflow and each unit's scheduled minimum OA against the 62.1 zone outdoor airflow (Voz/Vpz); flag zones where scheduled OA is below required. Also confirm system primary airflow (Vps) does not exceed the unit's rated supply CFM.
- basis: ASHRAE 62.1 ventilation rate procedure; load calc coordination.
- source_reference: ASHRAE 62.1; SETTY QC v20/v21 schedule cross-checks
- source_chat: claude_chat_01Nfwjq9fK3K5FLXfRoHTKmZ, claude_chat_01QXoAuESgAmHfawquw3mAbk, claude_chat_01AWqhtaJ9H3fF3WYX81ysjV
- confidence: medium
- verify_note: Method is sound. FLAG: one chat noted M011 ventilation calc was run in heating mode, so lower Vpz than cooling CFM was expected; do not flag a mismatch without checking the mode. Specific shortfalls are project facts.

### H2. Cite adopted code and standard editions
- discipline: Mechanical
- system: General notes / code list
- standard_text: The general notes list the AHJ-adopted edition of IMC, IBC, IECC, ASHRAE 62.1, 90.1, 55 and SMACNA, and drop inapplicable standards (e.g. 62.2 for non-residential).
- basis: Firm QC instruction on code compliance; code currency.
- source_reference: SETTY QC v21 Section 2; ASHRAE 62.1 / 90.1 edition notes
- source_chat: claude_chat_01WG741f1jg7VJ28EvyRS8zL, claude_chat_01XuhDfdWMzwVX9ghC48Ygk5, claude_chat_01PgZeAu2aZ3qLuv5PumkzVY
- confidence: high
- verify_note: FLAG on specifics: chats asserted "DC has adopted 62.1-2022 and at least 90.1-2019" and that 62.1-2025 / 90.1-2025 are current. I could not verify adopted editions; store only the instruction to cite the adopted edition.

### H3. Kitchen hood makeup air and exhaust discharge coordination
- discipline: Mechanical
- system: Commercial kitchen exhaust / makeup air
- standard_text: Interlock makeup air with the hood exhaust, state whether makeup air is tempered, coordinate untempered makeup air with space heating, and verify the exhaust discharge separation from intakes.
- basis: Kitchen ventilation practice; IMC 401.4 / Chapter 5; NFPA 96.
- source_reference: IMC Chapter 5; NFPA 96; Arthur Bell Part 15 (makeup air)
- source_chat: claude_chat_017jj8YW1jJ9iaDZrFQpUZ7p
- confidence: low
- verify_note: FLAG. This chat was a manufacturer submittal summary. Statements such as "slope 1/16 in/ft for runs under 75 ft, 3/16 above" for grease duct look wrong against NFPA 96 (2% slope minimum toward hood or reservoir), and "double-wall within 18 in of combustibles" should be checked against NFPA 96 clearance rules. Do not store those.

### H4. Dryer exhaust and residential ventilation moisture diagnosis
- discipline: Mechanical
- system: Multifamily ventilation / dryer exhaust
- standard_text: Provide each dwelling-unit dryer exhaust as a separate duct system, keep within the maximum equivalent length, and provide the whole-unit ventilation required by ASHRAE 62.2 (Q = 0.15 x floor area + 7.5 x (bedrooms + 1)).
- basis: IMC dryer exhaust provisions; ASHRAE 62.2.
- source_reference: IMC 504 (chat cites 504.6, 504.6.1); ASHRAE 62.2
- source_chat: claude_chat_01SMm8Bkg6DLMdf53dMsPPR4
- confidence: low
- verify_note: FLAG. The 62.2 equation is correct. IMC section numbers (504.6.1) and the "1/4 in per foot slope" and "R-4 duct wrap" statements are unverified; IMC does not mandate a dryer duct slope. This was a forensic site-visit diagnosis, not design standards. Several dew-point table entries were slightly off (70F/30% RH is about 36 F, chat says 34 F).

### H5. Energy model plant representation
- discipline: Mechanical
- system: eQuest plant modeling
- standard_text: Model heat exchanger approach, glycol derate, pumping configuration and defrost/standby capacity explicitly or document the simplification; derive performance curves from manufacturer data.
- basis: Modeling fidelity.
- source_reference: None cited (ASHRAE Fundamentals; DOE-2 practice)
- source_chat: claude_chat_013qrAeuSisQXs8EzpZxC1o2
- confidence: low
- verify_note: Arithmetic check passed: 576 kW x 3.412 = 1,965 MBH (not 1,850). Methodology is plausible but is modeler judgment. FLAG: chat claimed "UMD / USM standards prefer water-cooled over air-cooled" with no source (web search returned nothing).

================================================================
## I. Lessons-learned list as stated by the firm (checklist items)
================================================================

### I1. Standing lessons learned (SETTY QC Section 6)
- discipline: Mechanical
- system: General QC
- standard_text: Check heat on exterior walls (perimeter heat), power to all equipment, existing-conditions disclaimer / field verification note, waterside temperatures and pressures on plans, gas booster when utility inlet pressure cannot meet connected load at the appliance, heating coil upstream of cooling coil, and freeze protection on 100% OA units.
- basis: Firm lessons learned.
- source_reference: SETTY Mechanical Controls QC Instructions v19-v21 Section 6 / LL checks
- source_chat: claude_chat_011ybGWRwfW4kw5MFNHFjTnw, claude_chat_01S5RhKcuPdApmuXMinFNXMP, claude_chat_01PgZeAu2aZ3qLuv5PumkzVY
- confidence: high
- verify_note: Taken from the firm's document wording as paraphrased in user prompts. Gas booster text seen in v21 excerpt. Note applicability: chats correctly treat these as not applicable for cooling-only tropical or no-gas projects.

================================================================
## Chats reviewed / skipped
================================================================

Project chats found since 2026-08-01: 37 (pages scanned until has_more=false). Excluded duplicates not touched.

Already read (supplied digest, candidates included as G1-G3): 01EECHDdeCAq2wT8hFG3BMaQ, 01Qz3BgPbeqiaADJuPueToPu, 018Meo2gi129vNdUoaRzXWqW.

Read and mined (fully or via final answers):
01QYeWS35KSxiCdm5rKkByBy (VAV overheating), 01EMaegKacXdL7bm8Lbu28RQ (single/double line), 01Y9iw1wUkAJNqoJdq4JKQ7Q (restroom exhaust DOAS), 01DAGZ1FGGvZmRMyXsVpyVDS (BABAA), 01YV3MoPURL641Rzb7NMHHq6 (IDF ducts, partial read), 012kQyYJhQcY47uw3vLGfa8j (NO2 hysteresis, heat pump backup), 01Fe3GZHrNmrA1ejLFEjTrPe (bathroom ventilation), 01HagFV1f1rGwxEDUSkx6vSy (condenser water insulation), 01UPFiS7r3nWaxFBsByRuLSS (geothermal), 01XuhDfdWMzwVX9ghC48Ygk5 (SD narrative), 01Nfwjq9fK3K5FLXfRoHTKmZ (airflow sufficiency), 01WG741f1jg7VJ28EvyRS8zL (knowledge inventory), 01AWqhtaJ9H3fF3WYX81ysjV (RTU-1 controls), 011aLXtfCEUxnHmGB8J4eTun (DC permit comments), 013qrAeuSisQXs8EzpZxC1o2 (eQuest), 016xGmniiXJ1dXGeCruQNCBj (CUP schematic), 011ybGWRwfW4kw5MFNHFjTnw (CHW system), 017jj8YW1jJ9iaDZrFQpUZ7p (keynotes), 01XTScYY5Eto1gmZ3YKtzLvC (exhaust fan O&M), 017Wjtarp4dLrWmDFSrptDgW (existing conditions checklist), 01S5RhKcuPdApmuXMinFNXMP (checklist comparison), 011WvjbmfnbWJ6VmKxLdicED (intakes near driveway), 01KKnHYbwE8GpMpnByaV6B3t (controls QC), 01SMm8Bkg6DLMdf53dMsPPR4 (condensation), 01QXoAuESgAmHfawquw3mAbk (90% CD, last turn only), 01Ufx6nz3rGX5vD9j8b5dsaD (CD gap analysis, last turn only), 01PL63YFUj5NUy3eBi9HYFLY and 01PgZeAu2aZ3qLuv5PumkzVY (Bengaluru reviews), 01Rf3xevpdFdxNdV4HBe6fo5 (chiller plant QC), 01MgR8XLEE9gJKdxdhzAPamU (BWI 134 drawing review, last turn).

Partially read: 01YV3MoPURL641Rzb7NMHHq6 (IDF routing; output cut at about 6,000 chars). Not stored as a candidate because the answer overreaches: it calls IDF duct routing "effectively prohibited" citing IMC 601.2 (not an IDF section) and dampers vs clean agent room integrity. Reasonable underlying position (ducts not serving an IT room should not pass through it; coordinate with NFPA 75/2001 and the IT consultant) but it needs a firm decision. FLAG as doubtful.

Skipped as not standards-bearing: 01JqU4jbYMMfYN27BDMwmv4r (error patterns, owner rsetty), 01QHT6rcy7RRPpsbnxtrX1J9 (file-access failure only), 01DAGZ1FGGvZmRMyXsVpyVDS (BABAA: project-specific manufacturer origin claims; web searches returned empty so the origin and "FAIL" findings are unsupported; the 55% domestic content threshold and "starting Oct 1 2026" dates are unverified), 01UPFiS7r3nWaxFBsByRuLSS (geothermal layout; DXF editing, borehole 20 ft spacing with "IGSHPA 15-20 ft" cited without a verified source), 011aLXtfCEUxnHmGB8J4eTun (project permit responses; DC code section references unverified, and the chat could not render the drawings), 01XTScYY5Eto1gmZ3YKtzLvC (O&M note drafting), 017Wjtarp4dLrWmDFSrptDgW (checklist HTML for a specific SOW).

Not read (deleted chats, metadata only): 01QVRJqAnvvNmRE6HRMiScxN, 0181viTgEqnCj7f44ccpsfgF.

Reading limits: several large chats were read via final-turn or condensed text only; get_qc_chat_messages with a small tool_result_max_chars was used for inline results.
