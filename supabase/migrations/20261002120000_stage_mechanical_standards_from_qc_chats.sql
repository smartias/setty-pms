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
   'firm', 'SETTY QC v21 Section 2')
) as v(discipline, system, standard_text, basis, source_reference)
where not exists (
  select 1 from public.pms_engineering_standards e where e.standard_text = v.standard_text
);
