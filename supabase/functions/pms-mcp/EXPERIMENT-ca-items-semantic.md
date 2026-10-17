# Experiment: does semantic ranking help CA search? Scoring sheet

Status: READY TO RUN (2026-10-17). Everything it needs is deployed: migration
`20261017150000` applied, connector build `2026-10-17-ca-items-semantic`
live, embeddings backfilling on the sync cron. The pass rule below is the one
written in `PROPOSAL-ca-items-embeddings.md` before anything was built; it is
copied here so this sheet stands alone. When the sheet is filled in, open a PR
with it and the decision at the bottom.

## Before you start (two checks, two minutes)

1. **Coverage is complete.** In the Supabase SQL editor run section 7b of
   `supabase/ca-items-verify.sql`. `embedded` must equal `rows` for both
   types (2,879 in total on 2026-10-17) and `queued` must be 0. If not, wait
   for the sync cron (about 200 rows per 15 minutes) or trigger one admin
   call with `{"caItemsEmbed": {"max": 3000}}`.
2. **Semantic mode answers.** In a NEW Claude chat with the PMS connector,
   ask: *search RFIs and submittals for "damper" with semantic ranking on,
   limit 3*. The answer must say `searchMode: "hybrid"`. If it says
   keyword-ranked with a `semanticNote`, the model is not available in the
   deployed runtime; stop and report that instead of scoring.

## Rules that keep the result honest

- **Write the questions and the expected items BEFORE running any search.**
  Fill column A and column B for all ten rows first, then start searching.
  An expected item is a real record you know exists, written as
  `<project number> <type> <number>` (for example `SAPX196006.00 rfi 265`).
  Two expected items on one row are fine; the row scores a hit if either
  appears.
- **Questions are in your own words**, the way you would ask a colleague,
  not the words you remember from the record. If you only know a record by
  its exact title, it is not a good question for this test.
- **Each question runs twice**, same wording, limit 5, firm-wide (no project
  filter): once with semantic off, once with semantic on. In a Claude chat
  with the connector, the two prompts are:
  - *Search RFIs and submittals for "<question>" with semantic ranking OFF,
    limit 5, no project filter. List the five items as project, type,
    number, subject.*
  - *Same search with semantic ranking ON.*
- **Score only what the answer shows.** A hit means the expected item is one
  of the five listed. Do not open items or search again to "find" it.
- **One person writes, one person judges** if you have two; the judge sees
  the lists, not which mode produced them, until the scores are in.

## The ten questions

Starting points from the proposal are in grey; replace every one with a real
question from someone who works CA. Keep ten.

| # | A. Question, in the asker's words | B. Expected item(s), written before searching | C. Keyword top-5 hit? (Y/N) | D. Hybrid top-5 hit? (Y/N) | E. Hybrid-only items the judge calls useful | F. Items in hybrid top-5 the judge calls irrelevant | Notes |
|---|---|---|---|---|---|---|---|
| 1 | *a contractor pushing back on a fire smoke damper rating* | | | | | | |
| 2 | *a manufacturer substitution on scheduled equipment* | | | | | | |
| 3 | *a grease interceptor venting question* | | | | | | |
| 4 | *temporary cooling during construction* | | | | | | |
| 5 | *a failed hydrostatic test* | | | | | | |
| 6 | *controls integrated with a BMS versus stand-alone* | | | | | | |
| 7 | *sleeve locations clashing with structure* | | | | | | |
| 8 | *exterior lighting photometrics* | | | | | | |
| 9 | *lightning protection* | | | | | | |
| 10 | *water hammer* | | | | | | |

## Tally

| Measure | Count |
|---|---|
| Rows where keyword hit (C = Y) | |
| Rows where hybrid hit (D = Y) | |
| **Gained**: rows where hybrid hit and keyword missed (D = Y, C = N) | |
| **Lost**: rows where keyword hit and hybrid missed (C = Y, D = N) | |
| Useful hybrid-only items across all rows (column E, total) | |
| Irrelevant items in hybrid top-5 across all rows (column F, total) | |

## The rule, written before the experiment

**Pass**: Gained is 3 or more AND Lost is 0.
**Fail**: anything else.

A pass means: flip `CA_ITEMS_SEMANTIC=1` in the function secrets, remove the
`semantic` tool argument in a small PR, and keep the embed job. A fail means
one PR that removes the column, the two helpers, the RPC parameters, the
embed step and the flag. Either way the decision and this sheet go into the
repo.

Column F is not part of the rule, but it is the thing to look at if the
result is a pass with a lot of noise: the similarity floor (0.75 in
`search_ca_items`) can be raised in a one-line migration, and the sheet can be
re-run on the same ten questions.

## Decision

| | |
|---|---|
| Date run | |
| Questions written by | |
| Judged by | |
| Result (pass / fail) | |
| Floor used | 0.75 |
| Decision and next PR | |
| Anything surprising | |
