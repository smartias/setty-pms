-- Prime-project coordination tier (Sara, 2026-09-08, prompted by SUNY
-- Upstate TX-1 Fan where Setty is PRIME): "we are responsible for
-- EVERYTHING and coordinating everyone." On a prime job the review's
-- scope model inverts — every discipline's sheets are Setty's to defend,
-- subconsultants' deliverables are Setty's completeness problem, and a
-- coordination gap between firms is Setty's gap, not somebody else's
-- background. These items apply ONLY when Setty is prime; they carry
-- details.primeOnly = true and the qa-coordination-review skill includes
-- or drops them after checking the project's contractual role
-- (get_project). Sub-consultant jobs never see them.
insert into public.pms_qa_checklist (item_id, section, sort, text, details, automation, automation_hint, phases, source) values
('qa-500','prime-coordination',500,
 'PRIME ONLY: Verify every discipline promised by the cover sheet''s drawing index is actually present in the set, at the same issue date and phase.',
 '{"primeOnly": true}','assisted',
 'extract_sheet_index (subfolder mode reads the cover index AND the sheets present) — diff promised vs delivered per discipline; a discipline listed on the cover but missing from the book is a finding, not a note.',
 null,'seed'),
('qa-501','prime-coordination',501,
 'PRIME ONLY: Verify cross-firm title-block consistency — project name/number, phase, and issue date agree across each subconsultant''s sheets.',
 '{"primeOnly": true}','assisted',
 'search_drawings for the project number and issue date per discipline; multi-firm books (arch/structural/MEP from different offices) drift on these first.',
 null,'seed'),
('qa-502','prime-coordination',502,
 'PRIME ONLY: Verify every discipline picked up the current addendum/bulletin — a revision issued by one firm with no corresponding revision (or an explicit no-change) from the disciplines it touches is a coordination gap.',
 '{"primeOnly": true}','assisted',
 'search_drawings history per discipline + ripple rules from get_qa_checklist; on prime jobs run ripples across ALL disciplines, not MEPFP-only.',
 null,'seed'),
('qa-503','prime-coordination',503,
 'PRIME ONLY: Verify every external review comment is routed to a responsible discipline/subconsultant and tracked to closure — the owner holds Setty accountable for all of them, including architectural and civil.',
 '{"primeOnly": true}','assisted',
 'list_qa_findings — on prime jobs non-MEPFP comments are ingested as FULL rows (never ''for reference''), with the responsible discipline named in the action.',
 null,'seed'),
('qa-504','prime-coordination',504,
 'PRIME ONLY: Verify deliverable-package completeness beyond the drawings — specification TOC vs sections actually included, code compliance narrative present, owner-required forms present.',
 '{"primeOnly": true}','assisted',
 'list_project_documents on the set folder + read_document on the TOC; diff TOC entries against the spec files shipped.',
 null,'seed')
on conflict (item_id) do nothing;
