# Experiment: does semantic ranking help CA search? Scoring sheet

Status: RUN 2026-10-20, PASS ON HIT COUNTS; the judge step was skipped by decision (see the decision box). Switch-on shipped in the PR that carries this line. Originally READY TO RUN (2026-10-17). Everything it needs is deployed: migration
`20261017150000` applied, connector build `2026-10-17-ca-items-semantic`
live, embeddings backfilling on the sync cron. The pass rule below is the one
written in `PROPOSAL-ca-items-embeddings.md` before anything was built; it is
copied here so this sheet stands alone. When the sheet is filled in, open a PR
with it and the decision at the bottom.

## Before you start (two checks, two minutes)

1. **Coverage is complete.** In the Supabase SQL editor run section 7b of
   `supabase/ca-items-verify.sql`. `embedded` must equal `rows` for both
   types (2,879 in total on 2026-10-17) and `queued` must be 0. If not, the
   one-minute `pms-ca-items-embed` cron job (README → CA items table) is
   either not scheduled or not finishing: check `cron.job` and the function
   logs for `admin/ca-items-embed`. One call does about 20 rows, so the full
   backfill is roughly two and a half hours. The first hybrid run of
   question 2 on 2026-10-17 returned nothing for exactly this reason (the
   record had no embedding yet), which is why this check comes first.
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
- **Keep questions short (four to eight words).** Keyword mode needs every
  word to match, so a long sentence returns nothing and proves nothing.
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

Columns A and B were filled on 2026-10-17 from real records found by
BROWSING project listings and reading each one in full. None were found by
searching for the question text, so neither mode has been "tuned" to them.
Each question is in a project engineer's words and avoids the record's own
title. The expected record is deliberately not the only possible answer:
other projects may have a similar item, and a row still scores a hit if
either listed item appears.

If a question does not ring true to someone who works CA, replace it with
one of your own before searching, and write the expected item from memory,
not from a search. Keep ten.

| # | A. Question, in the asker's words | B. Expected item(s), written before searching | C. Keyword top-5 hit? (Y/N) | D. Hybrid top-5 hit? (Y/N) | E. Hybrid-only items the judge calls useful | F. Items in hybrid top-5 the judge calls irrelevant | Notes |
|---|---|---|---|---|---|---|---|
| 1 | roof fan on a curb or a concrete pad | `SAPX256009.03 rfi 014` | N | Y | | | Hybrid #1. Keyword top-5 were concrete-pad items (Remsen Hall pad, pad shop drawings); the expected record was absent. |
| 2 | radiator hookup detail missing | `SAPX246005.00 rfi 003` | N | Y | | | Hybrid #1. Keyword returned nothing ("hookup" is in no record). On 2026-10-17 hybrid also returned nothing because the record had no embedding yet; this run is the valid one. |
| 3 | toilet drain has to go around a beam | `SAPX196006.00 rfi 121.1` | N | Y | | | Hybrid #1. Keyword returned nothing. |
| 4 | smoke damper closed, does the air handler stop | `SAPX219002.00 rfi 024` | N | Y | | | Hybrid #1. Keyword returned nothing. |
| 5 | controls tied to building automation or stand alone | `SAPX256010.01 rfi 009` | Y | Y | | | Both #1 (control row). |
| 6 | no room for the damper in the shaft | `SAPX196006.00 rfi 265` | Y | Y | | | Both #1 (control row). |
| 7 | grease trap pit too small to fit the unit | `SAPX246005.00 rfi 004` | N | Y | | | Hybrid #1. Keyword returned nothing. |
| 8 | pipe pressure test passed with conditions | `SAPX219002.00 submittal 232113-011-0` | N | Y | | | Hybrid #1. Keyword returned nothing. |
| 9 | conduit rejected, brand not approved | `SAPX256010.01 submittal 260553-001-0` | N | Y | | | Hybrid #1. Keyword returned nothing. |
| 10 | temporary cooling during construction | `SAPX236024.00 submittal S01500-01-02` | N | N | | | Neither. Keyword returned nothing; hybrid top-5 were cold-weather concrete, cooling tower, dry cooler, vibration isolation, a chiller. The record is title-only ("Temp AC Units"); re-check after coverage reaches 100%. |

Why these ten: each pairs everyday wording with a record that says the same
thing in different words (radiator vs "FTR", toilet drain vs "water closet
waste line", pressure test vs "hydrostatic", brand vs "manufacturer", temp
AC vs "temporary cooling"). That is the gap semantic ranking is supposed to
close. Rows 1 and 7 share more words with their record and are there as
controls: keyword search should hit them, and hybrid must not lose them.
Row 10's record is thin (title only, no body), which is the hardest case
for both modes.

### What each search returned (for the judge)

Run 2026-10-20 13:00-13:05 UTC through the PMS connector from a Claude Code
session, `search_rfis_submittals` with the exact question, `limit: 5`, no
project filter, `semantic: false` then `semantic: true`; every hybrid answer
reported `searchMode: "hybrid"` and `minSimilarity: 0.75`. The expected record
is marked with an asterisk. The judge fills E and F from these lists.

| # | Keyword top-5 (semantic off) | Hybrid top-5 (semantic on) |
|---|---|---|
| 1 | SAPX176006.00 rfi 070 Concrete Pad for Remsen Hall; SAPX216012.00 sub 032100-001-2 and 032100-001-1 Concrete & Reinforcement for Concrete Pads; SAPX196006.00 sub 221116-003-0 Pump Room And Concrete Pads; SAPX219002.00 sub 232113.33-014-1 Vaults PD | *SAPX256009.03 rfi 014 Exhaust Fan Mounting Detail Clarification; SAPX216012.00 rfi 092 Support for AXF fans (pad vs curb); SAPX176021.01 sub 233423-01 Fans (roof curbs note); SAPX176006.00 rfi 070 Concrete Pad for Remsen Hall; SAPX216012.00 sub 032100-001-2 Concrete Pads |
| 2 | none | *SAPX246005.00 rfi 003 FTR Connection Detail Clarification; SAPX236009.00 sub 238236-001-1 R1 Fin Tube Radiators & Electric Duct Heaters; SAPX236009.00 sub 238236-002-0 Fin Tube Radiators Control Valves; SAPX219002.00 sub 236416-001-1 Water Source Chiller PD; SAPX226013.00 rfi 038 RTU-3 Mixed Air Temp Sensor |
| 3 | none | *SAPX196006.00 rfi 121.1 Bathroom CN 2-314 Water Closet; SAPX236012.00 sub 224200-001-0 Plumbing Fixtures; SAPX226013.00 rfi 031 AD-Area Drain; SAPX226013.00 rfi 011 Janitor's Closet plumbing conflict with foundation wall; SAPX176006.00 rfi 077 Emergency Shower Floor Drain |
| 4 | none | *SAPX219002.00 rfi 024 Fire Alarm - Fire smoke damper-AHU interface; SAPX226013.00 sub 233300-003-0 Dampers-Automatic, Fire, Fire-Smoke; SAPX216012.00 sub 233114-022-0 Fire Dampers; SAPX216022.00 rfi 027 Smoke Dampers & Duct Smoke Detectors Clarification; SAPX226013.00 rfi 116 Smoke Vent - Fire Vent - FA Device Coordination |
| 5 | *SAPX256010.01 rfi 009 HVAC Controls System; SAPX206004.00 rfi 113 Gas Furnace & Heaters (2 results only) | *SAPX256010.01 rfi 009 HVAC Controls System; SAPX206004.00 rfi 113 Gas Furnace & Heaters; SAPX176006.00 sub 230900-003-0 HVAC Controls; SAPX256010.01 rfi 016 HVAC Controls and Sequence; SAPX176021.01 sub 230900-03 HVAC Controls Bldg 10 |
| 6 | *SAPX196006.00 rfi 265 SF Fan ALD location; SAPX226013.00 rfi 207 Electrical Room 502 Shaft Wall Venting; SAPX196006.00 sub 233423-002-0 Fans product data; SAPX226013.00 sub 230719-001-0 HVAC Piping Insulation; SAPX196006.00 sub 233113-005-0 4th Fl Sheet Metal | *SAPX196006.00 rfi 265 SF Fan ALD location; SAPX226013.00 rfi 207 Electrical Room 502 Shaft Wall Venting; SAPX196006.00 rfi 171 Coordination-Recycle Room FD Locations; SAPX216012.00 rfi 136 Existing Damper Confirmation; SAPX216012.00 sub 233114-021-0 Control Dampers |
| 7 | none | *SAPX246005.00 rfi 004 Grease Interceptor Pit; SAPX196006.00 rfi RFI-089 Floor Drain Trap Primer; SAPX226013.00 sub 221323-003-0 Grease Interceptor Support Details; SAPX226013.00 rfi 182 Trap Primers Above Ceiling; SAPX246009.00 sub 15440-005-1 P-Trap |
| 8 | none | *SAPX219002.00 sub 232113-011-0 Hydrostatic Test Results; SAPX246009.00 rfi 032 Failed Hydrostatic Test - DF Domestic Water Piping; SAPX219002.00 sub 331000-002-0 Water Distribution Piping-Testing Procedures; SAPX196006.00 sub 232113-020-0 MOP-Hydrostatic Testing for Carrier Pipe; SAPX219002.00 sub 232113.33-010-0 Geothermal - Pressure Testing |
| 9 | none | *SAPX256010.01 sub 260553-001-0 Raceways & Boxes (GN); SAPX236021.00 rfi 023 Existing Electrical Conduits; SAPX226009.00 rfi 019 Conduit Type; SAPX196006.00 rfi BID-262 E614 Conduit; SAPX236021.00 rfi 005 Existing Conduit Conditions |
| 10 | none | SAPX176021.01 rfi 018 Cold Weather Concrete; SAPX176021.01 sub 236500-02 Cooling Tower; SAPX176021.01 sub 236500-01 Dry Cooler; SAPX176021.01 sub 230548.13-02 Vibration Isolation Equip- Clg Twr; SAPX219002.00 sub 236416-001-0 Water Source Chiller PD (expected record absent) |

Two things the lists show beyond the hit counts. Seven of the ten keyword
legs returned nothing at all: the questions are ordinary length, but keyword
mode needs every word to appear, so a five-word question usually fails. And
in the hybrid lists the expected record is first in nine rows, with the rest
of the top five mostly neighbours of the same kind (other hydrostatic tests,
other damper RFIs), which is what the judge's column E is for.

## Tally

| Measure | Count |
|---|---|
| Rows where keyword hit (C = Y) | 2 |
| Rows where hybrid hit (D = Y) | 9 |
| **Gained**: rows where hybrid hit and keyword missed (D = Y, C = N) | 7 |
| **Lost**: rows where keyword hit and hybrid missed (C = Y, D = N) | 0 |
| Useful hybrid-only items across all rows (column E, total) | judge to fill |
| Irrelevant items in hybrid top-5 across all rows (column F, total) | judge to fill |

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
| Date run | 2026-10-20 (searches); 2026-10-17 questions written, PR #365 |
| Questions written by | Claude, from records found by browsing listings (PR #365); not yet replaced or endorsed by a CA engineer |
| Judged by | Skipped. Sara decided on 2026-10-20 to go on the hit counts alone; columns E and F stay empty |
| Result (pass / fail) | PASS: Gained 7, Lost 0, against the rule Gained >= 3 and Lost = 0. Embedding coverage was not confirmed at 100% before the run (the question 2 record, absent on 10-17, was found first on 10-20, so coverage was far along); the one miss, row 10, is the title-only record |
| Floor used | 0.75 |
| Decision and next PR | Semantic ranking ON for everyone: `CA_ITEMS_SEMANTIC` defaults on (set it to `0` to turn it off without a redeploy), the `semantic` and `minSimilarity` tool arguments are removed, the one-minute embed job stays. Row 10 can be re-run any time with the connector; the similarity floor stays 0.75 |
| Anything surprising | Keyword mode returned zero items for 7 of 10 ordinary questions, so most of the gain is hybrid finding anything at all rather than ranking better. Every hybrid hit was ranked first. The one miss (row 10) is the title-only record, as predicted when the questions were written |
