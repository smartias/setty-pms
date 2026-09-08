-- Ripple rules as CONTENT (schedule item 4) + the code-compliance checklist
-- section (schedule item 7). Same posture as pms_qa_checklist: read for all
-- authenticated, writes admin-only, lessons learned extend the rules without
-- a deploy. get_qa_checklist serves the ripple rules alongside the checklist
-- so every review runs the current set of rules, not the skill's seed copy.

create table if not exists public.pms_qa_ripple_rules (
  id         bigserial primary key,
  parameter  text not null,   -- what changed, e.g. 'Motor HP / kW, MCA, MOCP'
  ripples_to text not null,   -- disciplines + what to verify
  sort       int  not null default 0,
  enabled    boolean not null default true,
  source     text not null default 'seed',
  added_by   text,
  added_at   timestamptz not null default now()
);
alter table public.pms_qa_ripple_rules enable row level security;
drop policy if exists qa_ripple_read on public.pms_qa_ripple_rules;
create policy qa_ripple_read on public.pms_qa_ripple_rules for select to authenticated using (true);
drop policy if exists qa_ripple_admin_all on public.pms_qa_ripple_rules;
create policy qa_ripple_admin_all on public.pms_qa_ripple_rules for all
  using (is_pms_admin()) with check (is_pms_admin());

insert into public.pms_qa_ripple_rules (parameter, ripples_to, sort) values
('Motor HP / kW, MCA, MOCP', 'E: breaker/feeder size, panel schedule row, disconnect rating; starter/VFD', 10),
('Voltage / phase', 'E: panel assignment (no 120V load on a 480V panel), wiring, disconnect', 20),
('Airflow (CFM)', 'M: duct mains/branches, diffuser selection, outside-air balance; sound', 30),
('Water flow (GPM) / head', 'M/P: pipe sizes, pump selection, balancing valves', 40),
('Heating/cooling capacity', 'M: coil connections, condensate; E: electric-heat circuits', 50),
('Physical size / configuration', 'A: clearances, access, ceiling/shaft space; M: duct/pipe connections', 60),
('Operating weight', 'S: pad, dunnage, roof framing, housekeeping pad note', 70),
('Equipment added or deleted', 'ALL: power, controls, condensate/drain, structural support, and the schedule row itself (qa-201/202)', 80),
('Gas-fired equipment', 'P: gas load/pipe size; M: venting/combustion air', 90),
('Fire/smoke rating of a wall', 'M: fire/smoke dampers (qa-211); FP: head layout', 100)
on conflict do nothing;

-- Code-compliance checklist section (assisted flags for engineer judgment,
-- never a compliance certification). Ids qa-400+.
insert into public.pms_qa_checklist (item_id, template_id, section, sort, text, details, automation, automation_hint, source, added_by) values
('qa-400','deliverable-qa','Code Compliance',1330,'Verify ventilation/exhaust rates on the schedules against the code minimums the drawings cite (mechanical code / ASHRAE 62.1 basis).','["Read the DOAS/fan schedules for OA and exhaust CFM.","Find the ventilation basis cited on the 001-series or in the narrative.","Flag rates below the cited basis - with both numbers."]'::jsonb,'assisted','read_drawing_schedule for OA/exhaust CFM; search_drawings for the cited ventilation basis; compare and cite both','lesson','sara.arias@setty.com'),
('qa-401','deliverable-qa','Code Compliance',1340,'Verify fire/smoke damper types match the wall/shaft ratings the drawings show, per the cited code.','["Where rated assemblies are marked, check the damper type called out (FD/SD/FSD).","Cross-reference qa-211 findings - a late wall-rating change is the classic miss."]'::jsonb,'assisted','search_drawings for rated-wall callouts + damper tags near them; view_drawing to confirm placement','lesson','sara.arias@setty.com'),
('qa-402','deliverable-qa','Code Compliance',1350,'Verify egress and emergency lighting coverage matches the code basis cited (spacing/coverage in corridors, stairs, egress paths).','["qa-221 checks presence; this checks the COVERAGE claim against the cited basis."]'::jsonb,'assisted','search_drawings for EM/exit fixtures on egress paths; view_drawing for corridor/stair coverage; flag gaps for the engineer','lesson','sara.arias@setty.com'),
('qa-403','deliverable-qa','Code Compliance',1360,'Verify the energy code compliance path is stated and consistent (prescriptive vs COMcheck/performance), and matches what the schedules show.','["Common issue: compliance forms cite one path, equipment efficiencies imply another."]'::jsonb,'assisted','search_drawings for COMcheck / NYSECC / ECCCNYS statements; compare scheduled efficiencies where cited','lesson','sara.arias@setty.com'),
('qa-404','deliverable-qa','Code Compliance',1370,'Verify A2L refrigerant requirements are addressed where A2L refrigerants (R-454B, R-32) are the basis of design: detection, ventilation/machine-room provisions, charge limits per ASHRAE 15/34 as adopted.','["Tabler example: R-454B basis of design with refrigerant monitor + EF interlock - verify the chain is complete on plans, schedules, and sequences."]'::jsonb,'assisted','search_drawings for refrigerant type, leak detection, monitor/exhaust interlocks; read the sequence sheets','lesson','sara.arias@setty.com')
on conflict (item_id) do nothing;
