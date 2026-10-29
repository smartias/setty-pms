# Experiment: does semantic ranking help email search? Scoring sheet

Status: RUN 2026-10-29 16:13-16:20 UTC; RE-RUN of the hybrid legs after the
thread-collapse fix later the same day (see "Re-run after the collapse fix"). The questions were committed and pushed
(16:12 UTC) before the first search. Result against the written rule: see the
tally; the hit clauses are met exactly at their threshold and the one-thread-
one-row clause is not met on two rows. Everything the run
needs is live: migrations `20261020100000` to `20261020120000` applied, the
embed job finished (22,101 of 22,101 filed emails embedded, none queued, on
2026-10-29), connector build `2026-10-20-emails-embed` deployed, and
`search_emails` takes the experiment-only `semantic` argument. The pass rule
is the one written in `PROPOSAL-emails-embeddings.md` before anything was
built, plus the one-thread-one-row check from the same proposal.

## Before you start

1. **Coverage is complete.** Done: `emails` 22,101, `embedded` 22,101,
   `still_queued` 0, newest embedding 2026-10-29 16:00 UTC (new mail keeps
   being picked up).
2. **Hybrid mode answers.** Done: a `search_emails` call with `semantic: true`
   returned `searchMode: "hybrid"` with a `similarity` on the rows that came
   from the vector side. That probe used the words "chiller disconnect", which
   are NOT among the ten questions below.
3. **Latency** (still to do, needs the Supabase SQL editor): section 5 of
   `supabase/emails-verify.sql`. Add an HNSW index only if the scan takes more
   than about 300 ms. Not part of the pass rule.

## Rules that keep the result honest

- **The questions and the expected threads below were written BEFORE any
  search for them, and committed before the first one was run.** The expected
  threads were found by BROWSING: the project list, then each sampled
  project's newest filed emails with no query, and the firm-wide newest-first
  list, then reading one message of each thread in full. No question text was
  ever typed into a search.
- **Questions are in an engineer's words, not the thread's words**, four to
  eight words (keyword mode needs every word to appear, so long questions
  return nothing and prove nothing). Two rows are CONTROLS: they share most
  of their words with the thread, so keyword search should hit them and hybrid
  must not lose them.
- **Each question runs twice**, same wording, `limit: 5`, firm-wide (no
  project filter), through `search_emails` with `semantic: false` then
  `semantic: true`.
- **A hit means the expected thread is in the five rows shown**: any message
  of that conversation counts (same project, same subject once RE:/FW:
  prefixes are ignored), because hybrid mode shows a thread as its newest
  matching message. Do not open messages or search again to "find" it.
- **One thread, one row** is checked separately: in any hybrid top five, the
  same thread must not appear twice. Keyword mode is expected to repeat
  threads; that is the problem hybrid mode collapses.
- **Spread**: six questions come from design-phase projects (PMS status "In
  Progress") and four from construction-phase projects ("In Construction
  Administration"), as of the project list read on 2026-10-29. Two of the
  threads are older (April and July); the other eight are from 22 to 29
  October.

## The ten questions

| # | A. Question, in the asker's words | B. Expected thread (project, subject), written before searching | Phase | Kind | C. Keyword top-5 hit? | D. Hybrid top-5 hit? | E. Repeated thread in hybrid top 5? | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | evacuation simulation passes with no reaction time | `SAPX256014.00` PANYNJ EWR AirTrain CFD: "Status of the egress modelling v the current required egress times." (e.g. `addin-mvtp2n2gubugv`) | design | gap | N | N | N | Keyword returned nothing. Hybrid top five were five OTHER threads of the same project (station simulation, egress results, an internal fire/hazard thread, NEC station, RailLink smoke exhaust); the expected thread was not among them. The newest text of the message I read is a short meeting request; the egress findings are in the quoted history below it, which the embedding drops. |
| 2 | what longer occupied hours do to energy use | `SIPX262004.00` DGS Bunker Hill ES: "Bunker Hill - New Set Points" (e.g. `addin-mvslgr6lkc10t`) | design | gap | Y | Y | N | Not really a gap row: every word of the question occurs somewhere in the thread, so keyword hit it (#2). Hybrid #3 with a count of 3. Neither lost. |
| 3 | how we sized cooling for a packed gym | `SIPX268012.00` CDA Sacred Heart HVAC Renovation: "Trace Load Calculation Request" (e.g. `addin-mvtnbtgvlshwy`) | design | gap | N | N | N | Keyword returned nothing. Hybrid top five were temporary-cooling, cooling-tower and envelope threads plus a different Bunker Hill message; the expected thread was absent. The newest text of the message I read is a short note about attached spreadsheets; the gym assumptions are further down the thread. |
| 4 | client wants zero billed for construction phase | `SAPX216011.00` SUNY Albany Rehab PE: "UAlbany PE: Vault Connection to PE building - SAPX216011.01 - SUNY Albany PE Bldg. Ad1" (e.g. `addin-mqjx28ypfi0d5`) | design | gap | N | N | N | Keyword returned one unrelated thread. Hybrid top five were billing or construction-phase-services threads from other projects; the expected thread was absent. The newest text of the message I read is a short reminder; the 0% request is in the quoted history. |
| 5 | commissioning as special inspection in NYC | `SAPQ236914.01` CUNY Brooklyn Campus Wide BMS: "CUNY BMS Brooklyn College - PAC & Library packaged in one set" (e.g. `addin-ms9e3gcoe8wug`) | design | control | Y | Y | Y | Control. Keyword #2 and #3 (two messages of the thread); hybrid #1 with a count of 3. Hybrid rows 3 and 4 are one subject twice: an 'Inspection Approved' notice for one address, filed 03-27 (3 messages) and 03-31. Two conversation ids with one subject, or a gap in the thread collapse; see the note under the tally. |
| 6 | energy model savings QC before certification | `SAPX249006.00` JMU Johnston Hall Renovation and Addition: "JMU Johnston Hall LEED certification/energy model" (e.g. `addin-mvjs484urh3xp`) | design | control | N | Y | Y | Control, and keyword MISSED it: all five keyword rows were one unrelated thread ('DGS Bunker Hill ES - Energy Model', five messages), which crowded out the expected thread. Hybrid #1 (similarity 0.894). Hybrid rows 2 and 3 are that same Bunker Hill subject twice (10-29 with a count of 4, and 10-26). |
| 7 | large breakers adjustable trip so downstream trips first | `SAPX208037.00` NVCC Bisdorf Bldg. Renov: "Submittal Forwarded: ... Panelboard and Accessories - Submittal:262416-001-0" (e.g. `addin-mvtq1vxfzbevh`) | CA | gap | N | N | N | Keyword returned nothing. Hybrid top five were other breaker and panel threads; the expected thread was absent. The sentence about electronic trip units and selective coordination starts at about character 1,415 of the 1,500 that are embedded, so the part that carries the meaning is cut off. |
| 8 | air outlets and lights clash above theater ceiling | `SAPX188032.00` NVCC Howsmon & Colgan: "RFI Forwarded: ... R1 Colgan Theater Diffuser vs Light Layout - RFI:381.1" (e.g. `addin-mvtgqxngqey5u`) | CA | gap | N | Y | N | Keyword returned nothing. Hybrid #5 (similarity 0.858). Hybrid #3 is a neighbouring thread of the same project ('Ceiling Coordination above Colgan Theater'), which an engineer would likely count as useful. |
| 9 | city rejected permit request over wrong job number | `SAPX236012.00` BPL New Lots: "665 New Lots Ave - BPL - Filing Update 10.22.2026 - MRC 77602" (e.g. `addin-mvtovf35ofbmc`) | CA | gap | N | Y | N | Keyword returned nothing. Hybrid #1 with a count of 2 (similarity 0.862). The other four were unrelated (three declined-meeting notices and a permit-application thread). |
| 10 | about forty submittal reviews owed on science lab | `SAPQ236917.01` Q126 Reso A Science Lab: "Follow-up for Pending AEoR Action - Q126 (Reso A Science Lab Upgrade - Path of Travel ...)" (e.g. `addin-mvtotcb6i6znv`) | CA | gap | N | N | N | Keyword returned nothing. Hybrid top five were submittal notices; two are the same project's laboratory-equipment submittal (a neighbour, not the expected thread). The '40 submittals' sentence is in a quoted message below the newest text. |

Why these ten: eight pair everyday wording with a thread that says the same
thing in different words (reaction time vs pre-movement, packed vs full of 826
people, zero billing vs "correct this down to 0%", downstream trips first vs
selective coordination, clash vs "occupy the same spaces", rejected vs
denied). That is the gap semantic ranking is supposed to close. Rows 5 and 6
are controls. Rows 7 to 10 are construction-phase mail, the kind the CA search
was already built for, so a pass here is not only a result about design-phase
chatter.

Limits to keep in mind when reading the result: every expected thread is on a
project that HAS filed mail. In a sample of sixteen active projects browsed
on 2026-10-29, ten had no filed email at all (four of nine in design, six of
seven in construction), so a search that finds nothing for a project says
nothing about that project. And ten questions written by one author, with one
thread each, is a small test; it can show that hybrid finds things keyword
cannot, not how often.

### What each search returned (for the judge)

Run 2026-10-29 16:13-16:20 UTC through the PMS connector from a Claude Code
session, `search_emails` with the exact question, `limit: 5`, no project
filter, `semantic: false` then `semantic: true`; every hybrid answer reported
`searchMode: "hybrid"`. The expected thread is marked with an asterisk; a
number in brackets is the thread count the hybrid answer showed. Project names
are shown where a project is the expected one or a neighbour of it.

| # | Keyword top-5 (semantic off) | Hybrid top-5 (semantic on) |
|---|---|---|
| 1 | none | PANYNJ Station 1 - 100% Simulation [3]; CFD Egress simulation results for EWRRAT NRL station and Station 1; Fire and Hazard Simulations using CFD, AirTrain Station (internal thread) [4]; CFD NEC station; RailLink Station - Smoke Exhaust-CFD results review. All five on the expected project; the expected thread ("Status of the egress modelling ...") absent |
| 2 | Tabler Quad Energy Modelling Building Schedule; *Bunker Hill - New Set Points; Site Visit & Documentation Exist. Mechanical Unit (three messages, rank 0) | Q578 New Bldg 100PCT GSG peer review [2]; Tabler Quad Energy Modelling Building Schedule; *Bunker Hill - New Set Points [3]; BATWorks CD phase energy analysis [2]; Site Visit & Documentation Exist. Mechanical Unit [7] |
| 3 | none | Bunker Hill - New Set Points [2] (another message of that thread); K292 Clerestories 1 and 5 Temp Cooling; LaGuardia CC BECC Cooling Towers meeting notes; X138 Electrification Building Envelope Thermal Values; K292 Temporary Cooling Product Data and Calculation Information |
| 4 | Stony Brook Quantum Hub Labs - Scope & Fee (1 result) | same Quantum Hub thread; DDC PRB Transition to Construction Phase - Billing Updates (Pay Req 7) [2]; Setty's Proposal (CHCR Grove); Construction Phase Services for HomePort II; Setty Invoice #A2560080/7, SUNY Cobleskill Masterplan |
| 5 | More Dampers More Problems; *CUNY BMS PAC & Library packaged in one set (two messages); SAPX206004.01 Homeport II (two messages) | *CUNY BMS PAC & Library packaged in one set [3]; More Dampers More Problems; "Inspection Approved" 43073683, 66-60 Kissena Blvd (03-31); the same subject (03-27) [3]; SAPX206004.01 Homeport II [12] |
| 6 | DGS Bunker Hill ES - Energy Model (five messages); the expected JMU thread absent | *JMU Johnston Hall LEED certification/energy model; DGS Bunker Hill ES - Energy Model [4]; DGS Bunker Hill ES - Energy Model (10-26); 60% CD Energy Model and LEED points [4]; Tabler Quad Energy model QAQC Request [2] |
| 7 | none | 363330 CSI Campuswide Sidewalk Phase II - Water Feature Coordination; Load Center Breaker Type [3]; Boat Slip Circuit Breakers PD (Homeport II); Remsen Hall Room 022 Panel Tie In (RFI 090); DDC PRB - Trans S Disconnect/Meter Combination |
| 8 | none | Sleepy Hollow Strand Theater RFP; Tabler Quad RFI 047 Ground floor corridor clashes; NVCC HCR - Ceiling Coordination above Colgan Theater; NCC TV Studio - NCC Comments; *RFI Forwarded ... R1 Colgan Theater Diffuser vs Light Layout RFI 381.1 |
| 9 | none | *665 New Lots Ave - BPL - Filing Update 10.22.2026 [2]; Declined: 280 Broadway Site Visit; Declined: 280 Broadway Kick Off Meeting; Declined: 280 Broadway Building I SD Stage; #363250 Sprinkler/Plumbing permit applications [2] |
| 10 | none | Submittal Reviewer Response, CUNY Queens Science Building 270544-001-0; Submittal Forwarded, VAV Science Building 230900-001-0; Submittal Forwarded, SCA IS 126 Reso A Comp Laboratory Equipment 11600-044-1; Submittal Responded to and Closed, same submittal; Submittal Forwarded, Balancing Report Science Building 230593-004-0 |

What the lists show beyond the hit counts:

- **Keyword mode returned nothing for seven of ten questions**, as in the CA
  experiment, and in row 6 a single unrelated thread filled all five rows. That
  is the thread-crowding problem the proposal set out to fix, seen live.
- **Hybrid found the right thread in five rows and first in three** (rows 5,
  6, 9). In the five misses it still returned plausible neighbours (the same
  project in rows 1, 8 and 10, the same topic in rows 3, 4 and 7), but not the
  thread that was written down.
- **Row 7 has a measured cause.** The key sentence starts at about character
  1,415 of the 1,500 embedded and is cut off. Rows 1, 3, 4 and 10 share a
  likely cause, not yet measured: the newest text of the message I read is a
  short note and the content is in the quoted history, which the cleaning rule
  drops on purpose. Other messages of those threads may carry it; that depends
  on who filed what.
- **The same subject repeats in two hybrid lists** (rows 5 and 6), described
  below.

## Tally

| Measure | Count |
|---|---|
| Rows where keyword hit (C = Y) | 2 (rows 2, 5) |
| Rows where hybrid hit (D = Y) | 5 (rows 2, 5, 6, 8, 9) |
| **Gained**: hybrid hit and keyword missed | **3** (rows 6, 8, 9) |
| **Lost**: keyword hit and hybrid missed | **0** |
| Rows where a hybrid top five repeats a subject (E = Y) | **2** (rows 5, 6) |
| Of the 8 gap rows (rows 1-4, 7-10): hybrid hit / gained | 3 of 8 (rows 2, 8, 9) / 2 of 8 (rows 8, 9) |
| Of the 2 control rows (5, 6): hybrid hit | 2 of 2 (row 6 was a gain: keyword missed it) |

Against the rule below: Gained is exactly 3 and Lost is 0, so the hit clauses
are met, with no margin. The no-repeat clause is not met as measured, which
by the rule as written makes this a fail. Two cautions on how to read that.

**The repeat check was measured by subject; the SQL collapses by conversation
id.** Two messages with one subject and different conversation ids are two
threads to the function and one thread to a reader. This is likely how it
happened: the add-in files from each person's mailbox, and an Outlook
conversation id is per mailbox, so one email exchange filed by two people can
carry two ids. One query settles it for the four messages concerned:

```sql
select record_id, project_id, conversation_id, subject, email_date
from public.pms_project_emails
where record_id in ('addin-mqjw3tda4ey8f', 'addin-mqsoydlhwug9g',
                    'addin-mvtp7gz35nyyg', 'addin-mvsuocxqywdd0');
```

Different ids means the function is doing what it says and the key is too
narrow. The same id would be a bug in the collapse.

**The gain is thin.** Only two of the eight gap rows were gained (8 and 9),
against seven of eight in the CA experiment. The third gained row (6) is a
control that keyword missed only because another thread filled its five
rows. Ten questions with one expected thread each can show that hybrid finds
things keyword cannot, not how often.

## Re-run after the collapse fix (2026-10-29, after PR #378 was applied)

The first run failed the one-thread-one-row clause on rows 5 and 6. The
production query on those messages (record ids `addin-mqjw3tda4ey8f`,
`addin-mqsoydlhwug9g`, `addin-mvtp7gz35nyyg`, `addin-mvsuocxqywdd0`) showed
why: the two Kissena messages carry different conversation ids that decode to
a per-mailbox GUID followed by an identical 16-byte tail (one conversation
filed from two mailboxes), and one Bunker Hill message has no conversation id
at all. Migration `20261029120000` adds a second collapse pass on project and
subject. After it was applied in production the ten hybrid legs were run again,
same wording, `limit: 5`, firm-wide, `semantic: true`. Keyword mode is
unchanged by the migration and was not re-run.

| Row | Before the fix | After the fix |
|---|---|---|
| 5 | CUNY BMS thread [3] first; the Kissena "Inspection Approved" subject in rows 3 and 4 (03-31, and 03-27 [3]) | CUNY BMS thread [3] still first; Kissena once, as one row with a count of 5; a fifth distinct result ("Commissioning Services", similarity 0.884) moves up |
| 6 | JMU thread first; "DGS Bunker Hill ES - Energy Model" in rows 2 and 3 (10-29 [4], 10-26) | JMU thread still first; Bunker Hill Energy Model once, with a count of 5; a fifth distinct result (PS 138X Energy Modeler meeting [3]) moves up |
| 1-4, 7-10 | | Identical lists, same order, same hits and misses |

Tally after the fix: keyword hits 2, hybrid hits 5 (rows 2, 5, 6, 8, 9), Gained
3, Lost 0, repeated subject in 0 of 10 lists. By the rule as written, all
three clauses are now met.

What this does and does not show:

- **The hit clauses did not change.** The fix touches grouping, not ranking, and
  the re-run confirms every hit and every miss is where it was. The result is
  at the threshold (Gained exactly 3), as before.
- **The repeat clause was re-measured on the same ten questions after the
  failure was seen and fixed.** That is fair for a grouping bug with a known
  cause, and the new SQL tests cover the cases directly, but it is not an
  independent confirmation.
- **Two things are still visible in the lists.** Two notifications for one
  submittal ("Submittal Forwarded" and "Submittal Responded to and Closed", row
  10) are not merged because their subjects differ. And similarity does not
  separate right from wrong: the expected threads scored 0.858 (row 8) and
  0.862 (row 9), while wrong neighbours scored up to 0.875 (row 7), so raising
  the 0.75 floor would not clean the lists up.
- **Where hybrid misses, it shows five plausible-looking wrong results.** Keyword
  mode would have shown none. Nothing in the answer says how confident the
  match is.

## The rule, written before the experiment

**Pass**: Gained is 3 or more AND Lost is 0, AND no hybrid top five repeats a
thread (column E is N on every row).
**Fail**: anything else.

Gained = rows where hybrid hit and keyword missed. Lost = rows where keyword
hit and hybrid missed. The controls (rows 5 and 6) are the rows where Lost
could happen.

A pass means: flip the default of `EMAILS_SEMANTIC` in a small PR (set the
function secret `EMAILS_SEMANTIC=0` to turn it off without a redeploy), remove
the experiment-only `semantic` tool argument, keep the embed job. A fail means
one PR that removes the column, the helpers, the new parameters of
`search_project_emails`, the embed route and the cron entry. Either way the
decision and this sheet go into the repo.

## Decision

| | |
|---|---|
| Date run | 2026-10-29; questions committed first (16:12 UTC) |
| Questions written by | Claude, from threads found by browsing; not endorsed by an engineer |
| Judged by | Not judged; columns C, D, E from the lists above |
| Result against the written rule | Gained 3 and Lost 0 (hit clauses met, no margin); repeated subject in 2 of 10 hybrid lists (clause not met as measured) |
| Decision | For the person who decides. |
| Recommendation (Claude's, not a decision) | Do not switch it on yet. Run the query above first. Then, in this order of effort: widen the thread key to project plus subject if the ids differ, which fixes the repeat; raise or restructure what is embedded (the 1,500-character cap cut row 7's key sentence, and replies whose meaning sits in quoted history embed as almost nothing); and re-test on ten NEW threads, not these, since these have now been seen. `EMAILS_SEMANTIC` stays off meanwhile, so nothing changes for users. |
