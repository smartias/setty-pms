-- QA checklist: point qa-614 and qa-070 at check_space_fit.
--
-- qa-614 (ceiling space, chases and access) is the item the RFI log rewards
-- most: 63 preventable RFIs on 14 projects at 2026-11-24. Read one by one,
-- about a third are congested routes that need a person. The rest are sums:
-- a ceiling drawn higher than the duct, pipe and light under the beam allow
-- (nine RFIs on one project, asked room by room), a closet too shallow for
-- the equipment and its working space, a shaft too small for its risers.
--
-- The connector now does those sums (check_space_fit, spaceCheck.js): the
-- reviewer reads the dimensions and passes them as drawn. Both items stay
-- 'assisted': choosing the locations and reading the sheets is still the
-- reviewer's, and the congested routes are not something a sum finds.
--
-- Only the hint is changed, and only by adding to it, so a hint an admin has
-- edited keeps its text. Running this twice adds the sentence once.

update public.pms_qa_checklist
   set automation_hint = coalesce(nullif(automation_hint, '') || '; ', '') ||
       'pass each location''s dimensions as drawn to check_space_fit (kind plenum for the depth sum, kind fit for shafts, pits and rooms), which converts and adds and returns the locations that do not fit; view_drawing again on a flagged location before recording it'
 where item_id = 'qa-614'
   and coalesce(automation_hint, '') not like '%check_space_fit%';

update public.pms_qa_checklist
   set automation_hint = coalesce(nullif(automation_hint, '') || '; ', '') ||
       'view_drawing (direct mode) on each electrical room and closet and at every panel, transformer, disconnect and VFD drawn elsewhere; pass the clear depth, width and headroom as dimensioned, with the system voltage, to check_space_fit (kind workingSpace), and the room dimension against equipment depth plus working space as kind fit'
 where item_id = 'qa-070'
   and coalesce(automation_hint, '') not like '%check_space_fit%';
