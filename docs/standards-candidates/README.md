# Engineering standards candidates (drafts)

Candidate firm standards mined from the claude.ai QC-reviewer Project chats via the
SETTY-QC-Lessons connector, 2026-10-02. **These are not verified firm positions.** The
chat answers are Claude output; each block carries a confidence rating and a
verify_note flagging citations or numbers that look wrong or unsourced.

- `mechanical.md`: 27 candidates. 17 are staged in `pms_engineering_standards` with
  `status='suggested'` (hidden from `search_engineering_standards` until an engineer sets
  them `active` and fills `date_verified`). The rest were held back or dropped.
- `plumbing.md`: 32 candidates (10 high, 13 medium, 9 low). Nothing staged yet. Its high
  items come from the firm document "Setty_Plumbing_QC_Reviewer_v1.0", which itself
  contains errors (see the file's flags).
- `electrical.md`: 49 candidates (20 high, 21 medium, 8 low), with 14 flagged doubtful items.
  Nothing staged yet. Two firm documents appear verbatim in the chats (Electrical QAQC
  Instructions v1.1 and v3.0); the firm text itself has points that look wrong, and the two
  versions disagree on UPS growth margin. Check every NEC citation against the AHJ-adopted
  edition.

Staging path: insert as `suggested` (the status check constraint allows it), review,
then flip to `active`.
