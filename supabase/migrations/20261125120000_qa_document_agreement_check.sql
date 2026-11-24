-- QA checklist: qa-632 becomes an automatic comparison.
--
-- qa-632 (plan, schedule, detail and specification agree on the small items)
-- has 25 preventable RFIs behind it. None was subtle once the two statements
-- sat side by side: a detail with an aluminum jacket against a spec calling
-- for stainless, a note limiting strobes to 110 cd with 177 cd devices drawn,
-- a plan circuit the panel schedule gives to another room. Until now the
-- reviewer both collected the statements and judged whether they agreed. The
-- judging is mechanical, so the connector does it (check_document_agreement,
-- documentAgreement.js): the reviewer passes what each document says and gets
-- back only the disagreements. Collecting the statements still takes reading
-- the documents; that part is unchanged.

update public.pms_qa_checklist
   set automation = 'auto',
       automation_hint = 'read_drawing_schedule on panel schedules and on the air device, duct and pipe material schedules; view_drawing on the plans for the homerun circuit numbers; search_drawings for the material words (STAINLESS, ALUMINUM, GALVANIZED, DOUBLE WALL, LINED) and for MOUNTING HEIGHT, A.F.F., CANDELA; read_document on the matching spec sections, parts 2 and 3. Pass what each document says to check_document_agreement (statements for materials, ratings and heights; circuits for each panel), which does the comparing and returns only the disagreements. Confirm each at both places before recording it.',
       details = details || '["The comparing is automatic: collect what each document says and pass it to check_document_agreement. It returns the disagreements, each naming both documents, and does not say which one is right. A subject only one document states is reported as not compared."]'::jsonb
 where item_id = 'qa-632'
   and automation <> 'auto';
