-- Stage Mechanical engineering standards mined from the QC-reviewer Project
-- chats. status='suggested' = review queue: search_engineering_standards does
-- not serve these until a person flips them to 'active' (and sets
-- date_verified). Idempotent: skips a row whose standard_text already exists.
insert into public.pms_engineering_standards
  (discipline, system, standard_text, basis, source_reference, status)
select v.discipline, v.system, v.standard_text, v.basis, v.source_reference, 'suggested'
from (values
  ('Mechanical', 'DOAS toilet exhaust',
   'When toilet exhaust is served by a DOAS, the toilet branch must not be the last take-off on the exhaust riser, the branch duct is oversized one nominal size, a CAR or CAV terminal is sized for total code-required toilet exhaust CFM, device selection covers the full inlet static range from minimum turndown to full load, the device and setpoint CFM appear on the drawings and balance schedule, and inlet velocity and acoustics are verified per manufacturer data.',
   'firm', 'SETTY Mechanical Controls QC Instructions Directive 26-2 (v20); IMC Chapter 4'),
  ('Mechanical', 'Condenser water / heat pump loop',
   'Where a condenser or heat pump loop runs below roughly 60 F in any operating mode, or is used for waterside economizer chilled water, insulate it to chilled-water thickness with a continuous closed-cell vapor barrier and insulation shields at hangers. A loop that stays between 60 F and 105 F year-round needs no insulation for code purposes. Take thickness from the adopted energy code edition.',
   'firm', 'Arthur Bell Part 35.02 notes 2 and 9, Part 19.14(E); ASHRAE 90.1 pipe insulation table'),
  ('Mechanical', 'Hydronic piping documentation',
   'Show waterside design temperatures and operating and test pressures on the flow diagrams or plans, not only on equipment schedules.',
   'firm', 'SETTY QC v19-v21 Section 6 lessons learned (waterside temps/pressures)'),
  ('Mechanical', 'Chilled water',
   'Verify scheduled tons, GPM and delta-T agree (tons = 500 x GPM x delta-T / 12,000), and that the scheduled delta-T matches the printed temperatures (for example 7/12 C is 5 K = 9 F, not 10 F).',
   'firm', 'ASHRAE Fundamentals (water sensible heat equation); HVAC Design Review Guide 2012 Section 3'),
  ('Mechanical', 'DOAS / 100% OA AHU controls',
   'Units handling 100% outdoor air in a heating climate need an air-side low-limit (freezestat) independent of refrigerant-circuit protection, a preheat or heating coil upstream of the cooling coil, a freeze recirculation or glycol strategy for hydronic coils, and the 99.6% winter design temperature stated on the narrative or schedule.',
   'firm', 'SETTY QC v21 Section 6 lessons learned'),
  ('Mechanical', 'Controls / sequences of operation',
   'Stage-up and stage-down setpoints must differ (adjustable deadband), and staged outputs should carry an adjustable minimum time in stage to prevent short-cycling. For dual-gas garage ventilation logic, step the fan down only when ALL monitored gases are below their stage-down values (AND), not when any one is.',
   'firm', 'ASHRAE controls reference (deadband and anti-short-cycle timers)'),
  ('Mechanical', 'Ductwork',
   'Confirm the preferred duct fittings (B, D, F, H) are the project default in details, plans, risers and flow diagrams, and flag square-throat turning-vane elbows without a documented field constraint. Check sheet organization per the firm directive.',
   'firm', 'SETTY QC v19-v21 Directive 26-4 (fittings) and Directive 26-3 (sheet organization)'),
  ('Mechanical', 'General notes / code list',
   'The general notes list the AHJ-adopted edition of the IMC, IBC, IECC, ASHRAE 62.1, 90.1, 55 and SMACNA, and drop inapplicable standards (for example 62.2 on non-residential work).',
   'firm', 'SETTY QC v21 Section 2'),
  ('Mechanical', 'Indoor refrigeration equipment / mechanical rooms (A2L)',
   'For indoor equipment using A2L refrigerant, show the refrigerant type, a charge-versus-room-volume check, refrigerant detection, and an interlocked ventilation or mitigation sequence where the charge exceeds the allowable room limit. Cite the AHJ-adopted edition of ASHRAE 15 and 34.',
   'firm', 'ASHRAE 15; ASHRAE 34; SETTY QC v21 refrigerant items'),
  ('Mechanical', 'Chilled water / CUP building connection',
   'Chilled water connection details show P&T test plugs at the entering and leaving points of major devices, manufacturer-required straight pipe at flow meters, and a design delta-T that traces to the owner or plant basis of design. Show a BAS points cross-reference where building and plant BAS exchange signals.',
   'firm', 'HVAC Design Review Guide 2012 Sections 3 and 4'),
  ('Mechanical', 'Controls / sequences of operation',
   'Each unit sequence needs numeric setpoints, a complete BAS points list, defined smoke and safety modes, ERV frost control with a setpoint and action, heat pump defrost handling, and logic for every heat source shown on the schedule (for example electric heat stages). The sequence, control diagram, schedule and submittal must describe the same hardware.',
   'firm', 'HVAC Design Review Guide 2012 Section 4; ASHRAE Guideline 36; SETTY QC v21 Section 4E'),
  ('Mechanical', 'Ductwork',
   'Duct sizes noted on plans are inside clear dimensions, excluding insulation or liner. Labeled velocities must match CFM and size; recompute rather than reusing placeholder values.',
   'firm', 'HVAC Design Review Guide 2012 (duct notes); SMACNA'),
  ('Mechanical', 'Outdoor air intakes, kitchen and toilet exhaust discharge',
   'Keep outdoor air intakes at least 10 ft horizontally from exhaust discharges and other contaminant sources unless the adopted code allows less. Treat 10 ft as a minimum and note the actual dimension on the plans. Kitchen grease exhaust separation under NFPA 96 and IMC 506 may differ.',
   'firm', 'IMC Section 401.4; ASHRAE 62.1 Table 5-1'),
  ('Mechanical', 'Equipment clearance / electrical coordination',
   'For a 460/3/60 heat pump above a ceiling, provide NEC 110.26 working space (151-600 V: 3 ft depth for condition 1, 30 in width, 6.5 ft headroom), locate the disconnect outside the plenum in sight and lockable, use plenum-rated wiring, show a dimensioned clearance diagram, provide 24 in service clearance, pipe condensate to a drain, and run an ASHRAE 15 analysis for refrigerant in a return plenum.',
   'firm', 'NEC 110.26, 440.14, 300.22; SETTY QC v19 D-2; Arthur Bell 43.05.D; ASHRAE 15'),
  ('Mechanical', 'VAV / unit ventilator / ERV schedules',
   'Cross-check each zone''s scheduled supply airflow against the load-calc cooling airflow, and each unit''s scheduled minimum outdoor air against the ASHRAE 62.1 zone outdoor airflow (Voz/Vpz); flag zones where scheduled outdoor air is below required. Confirm system primary airflow (Vps) does not exceed the unit''s rated supply CFM. Check which mode the ventilation calc was run in before flagging a mismatch.',
   'firm', 'ASHRAE 62.1 ventilation rate procedure; SETTY QC v20/v21 schedule cross-checks'),
  ('Mechanical', 'Toilet exhaust',
   'Single-occupant toilet rooms are exhaust-only and negative to the adjacent space, with transfer air through a door undercut or transfer grille. Do not schedule a supply diffuser. Confirm the transfer path can pass the exhaust airflow at acceptable velocity.',
   'firm', 'ASHRAE 62.1 Class 2 air classification; Arthur Bell Part 8'),
  ('Mechanical', 'Chiller installation / vibration isolation',
   'For an air-cooled chiller on an outdoor pad on grade, provide vibration isolation (neoprene or spring) between the chiller base and the pad. Detail seismic anchorage with structural engineer sign-off. Slope the pad away from the unit, show manufacturer clearances, use flexible pipe connections, use air-entrained concrete for freeze-thaw per ACI 318, and coordinate pad reinforcement with the operating weight.',
   'firm', 'HVAC Design Review Guide 2012 (mechanical QC check guidance); ASHRAE 15; IBC; ACI 318')
) as v(discipline, system, standard_text, basis, source_reference)
where not exists (
  select 1 from public.pms_engineering_standards e where e.standard_text = v.standard_text
);
