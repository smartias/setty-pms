-- QA checklist: schedule arithmetic (qa-638).
--
-- About eight preventable RFIs came from a scheduled selection whose own
-- numbers did not agree: a heating capacity that does not follow from the
-- airflow and temperature rise, a panel voltage its source does not have, a
-- flow copied from the riser onto a radiator, two fixtures with one model
-- number. Re-verifying every selection by hand is not realistic, so this item
-- is automatic: the reviewer reads each schedule row and the connector does
-- the sums (check_schedule_arithmetic, scheduleArithmetic.js). A person looks
-- only at the rows that are flagged.
--
-- It checks that a row is consistent with itself. It does not check that the
-- product can be bought as specified; those lessons go in the knowledge layer.

insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, phases, source, added_by) values
('qa-638','deliverable-qa','RFI History',1880,
 'Verify the numbers on each equipment schedule row agree with each other: capacity against flow and temperature difference, kW against MBH, amps against kW and voltage, the breaker against the unit''s MCA and MOCP, and the equipment voltage against the panel that feeds it.',
 '["Air: heating or sensible cooling capacity against 1.08 x cfm x temperature difference; total cooling against 4.5 x cfm x enthalpy difference.", "Hydronic: capacity against 500 x gpm x temperature difference. A flow that belongs to the main or the riser, written on one terminal unit, shows up here.", "Electric heat: kW against MBH. Electrical load: amps against kW (or kVA), volts and phase.", "Overcurrent: the scheduled breaker is not below the unit''s MCA and not above its MOCP.", "Voltage: the equipment''s voltage and phase are available from the panel or board that feeds it (a 208 V panel off a 480/277 V board is a finding).", "Counts against capacity where the documents give both: control zones on a controller, devices in a box, poles in a panel.", "Two tags that describe different things with the same model number.", "A flagged row is a question for the engineer, written with both numbers. The check does not say which number is wrong, and a row that lacks the inputs is reported as not checked, never estimated.", "RFIs: Homeport a makeup air unit whose heat did not follow from its airflow, and a panel called 120/208 V fed from a 480/277 V board; a fin tube radiator scheduled with the floor''s flow; two sinks with one model number."]'::jsonb,
 'auto',
 'read_drawing_schedule on every M, P and E equipment schedule and panel schedule; pass each row''s numbers to check_schedule_arithmetic, which does the arithmetic and returns the rows that do not close; view_drawing on a flagged row to confirm the values were read correctly before recording it',
 '["DD","CD","Permit","Bid","Addendum"]'::jsonb,'rfi-lesson','qa-rfi-review-2026-11-24-schedule-arithmetic')
on conflict (item_id) do nothing;
