# Experiment: does semantic ranking help email search? Scoring sheet

Status: RUN 2026-10-21. Questions were written before any search; results below. Verdict: FAILS the written rule on its third condition (one thread shown twice), see Decision.

Rule (from `PROPOSAL-emails-embeddings.md`, same as the CA experiment): **Pass = Gained >= 3 AND Lost = 0, and no thread appears twice in any hybrid top five.** Mix: at least three design-phase and three CA questions.

## How the questions were chosen

- Written 2026-10-21 from emails found by BROWSING a deterministic sample (`md5(record_id)` order) of already-embedded mail in ten projects. No question was tuned by searching.
- Every expected email already had an embedding when the question was written, so a miss cannot be blamed on the backfill (8,128 of 21,464 rows embedded at the time; the run reports coverage again).
- Each question is in a colleague's words, 4 to 8 words, and avoids the record's own wording. Rows 4 and 8 are controls that share words with their record; hybrid must not lose them.
- Run: `search_emails` with the exact question, `limit: 5`, no project filter, `semantic: false` then `semantic: true`.

## The ten questions

| # | Phase | Question (asker's words) | Expected record_id (project, subject) |
|---|---|---|---|
| 1 | Design | what standby power should the owner consider | `addin-mqfn1dx1zq67w` (SAPX266014.00, "Philly WNBA TF - Generator") |
| 2 | Design | where is the rainwater storage going | `addin-mvgx4uq04f1d6` (SAPX266013.00, "PS 9R Stormwater Tank Location") |
| 3 | Design | when will the thirty percent set go out | `addin-muws2vvdcxjsi` (SAPX266013.00, "Fw: PS 9R Updated Floor plans & Schedule") |
| 4 | Design (control) | where does the steam come into the building | `addin-mqsodpfc82n1n` (SAPX256018.00, "Re: 280 Broadway - showing the incoming steam and PRV station OPTION") |
| 5 | Design | air balancing report markups for Queens College | `addin-mpecbykll9kz7` (SAPX256011.00, "RE: 223468 Queens College ADA Upgrade Phase 3--Standing Project Meeting", TAB report markup) |
| 6 | Design | did the client send a formal complaint | `addin-mur2vypivy79e` (SAPX256014.00, a client letter to Setty, 2026-10-02) |
| 7 | CA | safety wash station for the chemical tank | `addin-mqsg7wo1zxqlp` (SAPX176006.00, "FW: 326640 ... Request for the Emergency Eyew...") |
| 8 | CA (control) | when will the hood monitors be installed | `addin-muvewri559cm1` (SAPX176006.00, "Science Building & Remsen Hall Airflow Monitors") |
| 9 | CA | university wants a letter about the campus heating connection | `addin-mroy8hm7fnds4` (SAPX196006.00, "SBU Tabler Letter Request?", HTHW line) |
| 10 | CA | county comments on the water protection device applications | `addin-mv76ikejxq3ml` (SAPX186034.00, "SUNY Old Westbury Back Flow Preventor Applications") |

## Results

Run 2026-10-21 through the PMS connector: `search_emails`, exact question, `limit: 5`, no project filter, `semantic: false` then `semantic: true`. Every `true` call reported `searchMode: "hybrid"`.

Two scorings, because hybrid collapses a thread to its newest matched message, so the expected message can be represented without being listed:

- **Strict**: the expected record_id is one of the five rows listed.
- **Thread**: the expected record's conversation is represented by a listed row (checked by `conversation_id`).

| # | Keyword strict | Hybrid strict | Hybrid thread | Notes |
|---|---|---|---|---|
| 1 | N | N | N | Keyword returned an unrelated RFP thread. Hybrid #4 is "Philly WNBA TF - Backup Power / Generator Capacity", right project and topic, but a different conversation from the expected record. |
| 2 | N (none) | **Y** (#1) | Y | Hybrid #5 is a second message of the same thread, see Thread check. |
| 3 | N (none) | **Y** (#1) | Y | |
| 4 (control) | N | **Y** (#2) | Y | Keyword found four steam-relocation emails from March, not the expected May email. |
| 5 | N | N | Y (#4, same conversation) | Keyword and hybrid both led with TAB Report threads, a different conversation. |
| 6 | N | N | N | Neither found the client letter. |
| 7 | N | N | N | Both surfaced the July eyewash thread (a different conversation from the expected May forward); hybrid also surfaced "DASNY QC SB Mech Rm Chem Tank Safety shower", a valid answer. |
| 8 (control) | N | N | Y (#2, same conversation) | |
| 9 | N | N | N | Keyword returned one old unrelated email. |
| 10 | N (none) | N | Y (#1, same conversation) | |

Keyword returned zero rows for questions 2, 3 and 10.

| Measure | Strict | Thread |
|---|---|---|
| Keyword hits | 0 | 0 |
| Hybrid hits | 3 | 6 |
| Gained | 3 | 6 |
| Lost | 0 | 0 |

### Thread check (third pass condition)

Question 2, hybrid top five: #1 `addin-mvgx4uq04f1d6` ("PS 9R Stormwater Tank Location", `conversation_id` null) and #5 `addin-mvh6c2ra3rt9k` ("Re: PS 9R Stormwater Tank Location", `conversation_id` set) are the same exchange shown as two rows. The collapse falls back to the normalised subject only when `conversation_id` is null, so a null row and a non-null row with the same subject never merge. Checked afterwards: questions 4 and 5 each show two rows with the same subject (steam relocation; TAB Report), but each pair has two different `conversation_id` values, so they are separate conversations and not duplicates. Question 2 is the only breach.

### Observations

- Similarity does not separate good from bad. Correct hits scored 0.84 to 0.87 and unrelated emails (invoices, other projects) scored 0.84 to 0.87 too. The 0.75 floor filters almost nothing; ordering comes from the rank fusion.
- For questions with no good answer (6, 9) hybrid returns five confident-looking unrelated emails where keyword returned two or none.
- Coverage: 8,128 of 21,464 emails embedded at the start of the session. The expected records were chosen from embedded rows.

## Decision

| | |
|---|---|
| Date run | 2026-10-21 |
| Written by | Claude, from browsed records; not endorsed by a CA engineer |
| Judged by | Not judged; counts only |
| Rule | Gained >= 3 AND Lost = 0 AND no thread twice in a hybrid top five |
| Result | Gained 3 (strict) or 6 (thread), Lost 0. **Fails the third condition** on question 2 |
| Next | Fix the collapse so a null-`conversation_id` row and a set one with the same subject merge, then re-run question 2. If clean, switch on as for CA. Decide separately whether to raise the 0.75 floor (the numbers above say it will not help) |
