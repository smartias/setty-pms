# Experiment: does semantic ranking help email search? Scoring sheet

Status: QUESTIONS WRITTEN 2026-10-29, BEFORE ANY SEARCH. Everything the run
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
  Administration"), as of the project list read on 2026-10-29. Four of the
  threads are from April to October, six from the last week.

## The ten questions

| # | A. Question, in the asker's words | B. Expected thread (project, subject), written before searching | Phase | Kind | C. Keyword top-5 hit? | D. Hybrid top-5 hit? | E. Repeated thread in hybrid top 5? | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | evacuation simulation passes with no reaction time | `SAPX256014.00` PANYNJ EWR AirTrain CFD: "Status of the egress modelling v the current required egress times." (e.g. `addin-mvtp2n2gubugv`) | design | gap | | | | Thread says "egress", "pre-movement", "sensitivity study"; never "evacuation" or "reaction". |
| 2 | what longer occupied hours do to energy use | `SIPX262004.00` DGS Bunker Hill ES: "Bunker Hill - New Set Points" (e.g. `addin-mvslgr6lkc10t`) | design | gap | | | | Owner's team changed setpoints and occupied hours; thread discusses EUI, Zepi, extra model scenarios. |
| 3 | how we sized cooling for a packed gym | `SIPX268012.00` CDA Sacred Heart HVAC Renovation: "Trace Load Calculation Request" (e.g. `addin-mvtnbtgvlshwy`) | design | gap | | | | Thread: bleacher seating vs athletics heat gain per person, cooling down to about 50 tons. Says "gymnasium", "occupant", never "packed". |
| 4 | client wants zero billed for construction phase | `SAPX216011.00` SUNY Albany Rehab PE: "UAlbany PE: Vault Connection to PE building - SAPX216011.01 - SUNY Albany PE Bldg. Ad1" (e.g. `addin-mqjx28ypfi0d5`) | design | gap | | | | April 2026 accounting thread: voided invoice, client asks 100% CA payment corrected to 0%. The subject says nothing about billing. |
| 5 | commissioning as special inspection in NYC | `SAPQ236914.01` CUNY Brooklyn Campus Wide BMS: "CUNY BMS Brooklyn College - PAC & Library packaged in one set" (e.g. `addin-ms9e3gcoe8wug`) | design | control | | | | July 2026. Shares "commissioning", "special inspection", "NYC" with the body; keyword should hit. |
| 6 | energy model savings QC before certification | `SAPX249006.00` JMU Johnston Hall Renovation and Addition: "JMU Johnston Hall LEED certification/energy model" (e.g. `addin-mvjs484urh3xp`) | design | control | | | | Shares "energy model", "savings", "QC", "certification"; keyword should hit. |
| 7 | large breakers adjustable trip so downstream trips first | `SAPX208037.00` NVCC Bisdorf Bldg. Renov: "Submittal Forwarded: ... Panelboard and Accessories - Submittal:262416-001-0" (e.g. `addin-mvtq1vxfzbevh`) | CA | gap | | | | Review note: breakers 225 A and up get electronic trip units for selective coordination. Says "selective coordination", never "downstream trips first". |
| 8 | air outlets and lights clash above theater ceiling | `SAPX188032.00` NVCC Howsmon & Colgan: "RFI Forwarded: ... R1 Colgan Theater Diffuser vs Light Layout - RFI:381.1" (e.g. `addin-mvtgqxngqey5u`) | CA | gap | | | | Thread says "diffusers", "light fixtures", "sprinkler", "cavities". |
| 9 | city rejected permit request over wrong job number | `SAPX236012.00` BPL New Lots: "665 New Lots Ave - BPL - Filing Update 10.22.2026 - MRC 77602" (e.g. `addin-mvtovf35ofbmc`) | CA | gap | | | | Request to pull the permit was denied, reason "Variance Form - incorrect job #"; many replies in the thread. |
| 10 | about forty submittal reviews owed on science lab | `SAPQ236917.01` Q126 Reso A Science Lab: "Follow-up for Pending AEoR Action - Q126 (Reso A Science Lab Upgrade - Path of Travel ...)" (e.g. `addin-mvtotcb6i6znv`) | CA | gap | | | | Thread says "~ 40 submittals response", "pending"; also an RFI sketch due 11/4 and a PW1 amendment. |

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

Filled in after the run.

## Tally

Filled in after the run.

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

Filled in by the person who decides, after the run.
