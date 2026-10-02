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
- Electrical: dry run not yet saved here.

Staging path: insert as `suggested` (the status check constraint allows it), review,
then flip to `active`.
