# Setty PMS Connector: Capability Roadmap

Goal: make the connector the fastest, most trustworthy front door to project
information, so the SharePoint-backed data beats the N: drive habit on daily,
felt advantages. Every item is something N: structurally cannot do, because N:
is invisible to the connector and to any unattended workflow.

Scope guardrail: documents, PM data, calcs, correspondence, deliverable
tracking. Explicitly NOT live CAD/Revit production files. Those stay on the
file server and Autodesk cloud.

Working rules: one item per branch per PR. Acceptance bullets are the test
checklist. Honor the cross-cutting conventions on every item.

---

## Reality check (verified 2026-08-01, before any code)

Four findings from the live DB and the committed source. They change the
delivery order, so read this before starting P0.

### 1. The transmittal log already exists, and it is richer than the plan assumed

`transmittal.html` (v `2026-07-25-transmittal-v5-ux-wave3`) already writes a
structured record to `pms_filing_log` with `operation = 'transmittal-generated'`.
Per issue it stores:

| Field | Path | Feeds |
| --- | --- | --- |
| Project | `project_id` | P0.1 |
| Transmittal number | `files.transmittalNumber` | P0.1 |
| Issue date | `created_at`, `files.issuedAt` | P0.1, P0.2 |
| Set name (dated) | `files.milestoneName`, e.g. `2025-04-10_Bulletin #1` | P0.1 |
| Folder link | `sp_folder_url` | P0.1 `webUrl` |
| Sheet register | `files.sheets[]` with `sheetNo`, `title`, `revision`, `discipline`, `filename` | P0.2, P2.9 |
| Recipients / delivery | `files.recipientEmail`, `ccEmails`, `distributionKind` | P1.6 |
| Backfill marker | `files.backfilled` | P0.1 honesty |

Consequence: **the Metadata Prerequisites are not blocking for P0.1 or P0.2.**
Revision, discipline and issue date already exist per sheet, captured at issue
time by the tool that does the issuing. Supersession can be DERIVED from this
log rather than read from a SharePoint `Status` column.

That is the better design regardless of effort. The roadmap's own stated
failure mode is that blank metadata makes search return stale or nothing.
Upload-time columns depend on a human setting them on every file forever;
the log is written automatically as a side effect of issuing. Prefer the
derived path and keep the SharePoint columns as a later enrichment, not a
gate.

### 2. The log is sparsely populated, and that is the real P0 risk

11 rows total, 3 distinct projects, first 2025-04-10, last 2026-07-30.
Only 3 rows carry a sheet register, and 2 of those 3 are backfills. The 8
routine `send-email` rows carry zero sheets and an empty set name, because the
sheet snapshot was added to the writer after those sends happened.

So the schema is right and the coverage is thin. `get_current_set` will hit
the inference fallback on almost every project on day one. Treat the fallback
as the primary path at launch, not the exception, and make its `inferred: true`
basis genuinely useful.

### 3. The fixture project is mislabeled, and two acceptance tests cannot pass as written

The roadmap names `SAP186034.18` as "SUNY OW NSB Phase 3". The DB disagrees:

| Project | id | relatedGroup | relatedRole | Transmittals |
| --- | --- | --- | --- | --- |
| `SAP186034.18` | `efeo20py` | SUNY OW | **Phase 1** | 0 |
| `SAPX186034.16` | `cbbgp79p` | SUNY OW | **Phase 3** | 0 |
| `SAPX186034.00` | `oxqfd5ve` | SUNY OW | (null) | 0 |

Three consequences:

- `SAP186034.18` is Phase 1. If the intent was Phase 3, the fixture is
  `SAPX186034.16`.
- There is no Phase 2 row in the SUNY OW group. P2.7's acceptance
  ("returns Phase 1 and Phase 2") cannot pass. Rewrite it against the roles
  that actually exist, or add the missing Phase 2 project.
- No project in the group has a single transmittal record, so P0.1's
  "returns the current set for a project that has a transmittal record"
  acceptance cannot run on this fixture at all.

**Action before writing tests:** confirm which project is the intended fixture,
and pick a second fixture that actually has transmittal rows for the
authoritative path. `SAPX196006.00` is the only project with sheet registers
(3 rows, including a `2026-04-17_Bulletin #13`).

Also note the prefix inconsistency: `SAP186034.18` vs `SAPX186034.16`. Any
sibling matching that keys off the project number prefix will miss. Match on
`relatedGroup`, which is populated correctly on all three.

### 4. Current connector surface

21 tools live at `supabase/functions/pms-mcp/index.ts` (v33). Relevant to this
roadmap: `list_project_documents` and `read_document` already encode the folder
semantics the plan wants to exploit, including OUTGOING as "sets we issued" and
`*COMMENTS*` as high-value review feedback, and `read_document` already does
full-text extraction. P0.3 and P1.4 build on existing behavior rather than
starting cold.

No new Graph scopes are needed for P0 or P1. Flag P3.11 (proactive hooks
posting to Teams) as the one item that may need a scope review, and IT
gatekeeps admin consent.

---

## Revised delivery order

```
P0.1 -> P0.3 -> P0.2 (derived) -> P1.6 -> P1.4 -> P1.5 -> P2.7 -> P2.8 -> P2.9 -> P3.10 -> P3.11 -> P3.12
```

**P0.3 moved ahead of P0.2 (2026-08-01).** The two differ in how their value
arrives. P0.2's answers are only as good as register coverage, and the register
holds 11 rows today, so a P0.2 built now would return `unknown` for essentially
every sheet in the firm. Its worth grows as backfill lands. P0.3 has no such
dependency: it reads the SharePoint tree that already exists for every
provisioned project, so it is fully useful on day one, and it is the adoption
demo (ask for a document, get a link faster than you could navigate to it).
Build P0.3 while the register fills, then land P0.2 into data it can be right
about.

Two further changes from the original:

- **Metadata Prerequisites drop off the critical path.** They are no longer a
  gate on P0.2. Provision them later to sharpen P2.8/P2.9.
- **P1.6 moves ahead of P1.4/P1.5.** Closing the write loop is what populates
  the log, and finding 2 says thin coverage is the top risk to P0.1. The
  expensive part of P1.6 (cover sheet generation, structured write) already
  ships in `transmittal.html`, so this is mostly exposure plus status stamping.

---

## P0: Foundation and the three hero capabilities

### P0.1 `get_current_set`

Authoritative answer to "what is the current issued set?", today a folder-date
archaeology dig in `99-OUTGOING`. Highest-frequency PM question, so a one-call
lookup with working links is the most repeatable win.

Build:
- `get_current_set(projectNumber, discipline?)`.
- Primary source: `pms_filing_log` where `operation = 'transmittal-generated'`,
  newest first. Return set name, issue date, transmittal number, phase, and a
  `webUrl` per file.
- Fallback: infer the latest dated folder under `Outgoing/` and return it with
  `inferred: true` plus the basis. Per finding 2 this is the common case at
  launch, so make the basis specific ("newest dated folder under Outgoing,
  2026-04-17_Bulletin #13, no transmittal record").
- Surface `backfilled: true` when the record was reconstructed after the fact.
  A backfilled record is authoritative but not a live send, and the difference
  matters if anyone audits it.

Acceptance:
- Returns the current set from the log for a project that has one
  (use `SAPX196006.00`, not the SUNY OW fixture).
- For a project with no log record, returns the newest `Outgoing/` set with
  `inferred: true` and a human-readable basis.
- Never returns a superseded set as current.

Effort: M

### P0.2 Supersession and status awareness (derived)

Kills the wrong-revision risk. N: is full of `..._UPDATED_06.09 / _06.11 /
_06.16` and grabbing a stale rev is a real quality and liability fear.

Build:
- Derive status from the sheet registers in the transmittal log rather than a
  SharePoint column: for each sheet, the most recent transmittal containing it
  wins. See the open decision below on the exact rule.
- Default `find` / `search` / `list` results to current only. Include
  superseded when explicitly asked, tagged `superseded: true`.
- Populate `supersededBy` from the transmittal that replaced it, which the log
  gives for free (number and date), so the link is real rather than a column
  someone forgot to fill.
- Where a file has no sheet register coverage, return
  `status: "unknown"` with a reason. Do not silently imply current.

Acceptance:
- A search matching both `_06.09` and `_06.16` returns only the current one by
  default.
- Requesting history returns both, superseded rows clearly flagged with the
  transmittal that superseded them.
- A file the log has never seen reports `unknown`, never `current`.

Effort: M

### P0.3 `find_document`

Reframes adoption from "change where you save" to "here is a faster door."
If a natural-language ask returns a link before the user can navigate the
tree, the connector becomes the retrieval channel and SharePoint just happens
to be where the file lives.

Build:
- `find_document(projectNumber, query, discipline?, docType?)`, returning
  ranked matches with `name`, `library`, `folderPath`, `status`, `webUrl`.
- Rank on filename match, folder semantics (already encoded in
  `list_project_documents`), doc-type and discipline tags, recency, and a
  current-status boost.
- Cache the per-project folder tree. Do not re-walk libraries per call.

Acceptance:
- "current phase 3 fire protection narrative" returns the right PDF as top hit
  with a working link.
- Median resolution faster than a human navigating the equivalent N: path.
  Measure it, this is the demo you stage for the team.

Effort: M

### P0.3 status: built, not deployed

Branch `connector-find-document`. `find_document(projectNumber, query,
discipline?, docType?, limit?)` plus `findDocument.test.mjs` (35 assertions).

Design decisions worth keeping:

- **The tree is walked breadth-first and cached per project** (5 min TTL, 4000
  file / 150 request caps). Depth-first on a project with a deep Outgoing tree
  would spend the whole budget inside one set folder and never reach its
  siblings, so the shallow high-signal folders would be exactly the ones missed.
  Hitting a cap sets `coverageWarning` rather than silently returning less.
- **Recency is scored off the date in the folder NAME**, falling back to
  `lastModifiedDateTime`. Bulk migration flattened the Graph stamps firm-wide,
  so they are weak evidence: worth a tiebreak, never worth outranking a name
  match. This is what lets three identically-named `FP Narrative Phase 3.pdf`
  files in three set folders be ranked correctly.
- **A file matching no query term scores 0 and is dropped.** Without that floor
  a ranked list degrades into "here is the whole folder, good luck".
- **Low-value hits are down-ranked, not hidden.** Superseded folders take -12
  and `.url` shortcuts -10, so they can still appear but cannot win. Hiding
  them would be a silent empty by another name.
- **A bare discipline letter only matches as a sheet-name segment**, never as a
  loose substring, or "E" hits every filename containing an e.
- **`status` is `"unknown"` on every result**, with a note telling the model not
  to call a hit current. Supersession is P0.2. Claiming otherwise here would
  manufacture the exact wrong-revision risk the roadmap exists to remove.
- Doc-type vocabulary encodes the firm's actual naming: "design criteria" maps
  to Narrative, alongside OPR and Basis of Design, because nobody names the file
  "design criteria".

---

## P1: Auto-outputs that seed the folder

People come for the output and stay for the folder.

### P1.6 `create_transmittal` (moved up)

The transmittal is the source of truth for "current set". Generating it and
writing the structured record in one motion is what keeps the log populated,
which is what lets P0.1 stop relying on inference.

Build:
- Most of this exists in `transmittal.html`. The work is exposing it and
  closing gaps, not rebuilding it.
- Optionally stamp issued files `Status = Current` and flip the prior set to
  `Superseded`. With P0.2 derived, this is an enrichment, not a dependency.

**CORRECTION (2026-08-01):** an earlier draft of this item claimed the sheet
register was only written for folder-backed distribution kinds and that
`send-email` needed fixing. That is wrong, and chasing it would waste a day.
`logTransmittalGenerated()` writes `files.sheets[]` unconditionally from the
loaded sheet list, whatever the distribution kind. The rows with no sheets are
all from May 2026 and simply predate the feature, which landed 2026-07-28 in
`b32f5d4`. The only genuine gap is an ad-hoc transmittal sent with no folder
loaded, which has no sheet list to snapshot.

Acceptance:
- After issuing, `get_current_set` returns the new set from the log with no
  inference, and the prior set is marked superseded.

Effort: S (down from L: the tool already does the hard part, and the
parseFilename fix has landed)

### P1.4 `get_review_comments` + `draft_comment_responses`

The connector already recognizes `*COMMENTS*` files as high-value review
feedback. Turn recognition into output: a structured comment log plus
pre-drafted dispositions. Hours saved per review cycle, and the draft lands in
the SharePoint folder.

Build:
- `get_review_comments(projectNumber, phase?)`: parse comment files (Excel
  logs, DrChecks exports, comment PDFs) from the Emails and incoming area into
  structured rows: number, discipline, spec section, comment text, source,
  status.
- `draft_comment_responses(...)`: generate a response-log draft grounded in the
  project docs.

Acceptance:
- Returns structured rows for a known comment set, handling Excel and PDF.
- Draft response log has one row per comment, each linked back to source.

Depends on: consistent comment-file placement and naming.
Effort: L

### P1.5 `build_open_items_log`

Standing deliverable at every milestone and largely mechanical from connector
data plus minutes. If it auto-builds in the folder, the folder becomes where
the team gets it.

Build:
- Assemble open items from unresolved RFIs and submittals, action items,
  minutes-flagged items, and "assumed / awaited / unconfirmed" language in
  recent narratives and emails.
- Shape output for the existing open-items-log format (two-tab structure).

Acceptance:
- Produces a populated log mid-phase, each row citing its source record.
- Empty categories show "none open", never omitted silently.

Effort: M

---

## P2: Context and continuity

Institutional memory N: cannot expose. This is what makes principals and
covering PMs care.

### P2.7 `get_related_projects` + cross-phase briefing

Phase 1's hydraulic issue constrains Phase 3. Today the phase links are just
`.url` shortcuts.

Build:
- Promote the phase links (currently `.url` + `shortcutsFingerprint`) to a
  first-class relation on `get_project`, consumable by `project_briefing`.
- Key sibling lookup on `relatedGroup`, NOT on the project-number prefix.
  See finding 3: `SAP186034.18` and `SAPX186034.16` are siblings with
  different prefixes.
- `project_briefing` optionally pulls linked phases' recent decisions and
  minutes.

Acceptance:
- `get_related_projects` on a SUNY OW project returns its siblings with roles.
  Rewrite the original "returns Phase 1 and Phase 2" bullet: the group
  contains Phase 1 and Phase 3 plus a role-less parent, and no Phase 2.
- A cross-phase question returns content sourced from the linked project.

Effort: M

### P2.8 `search_precedents`

Firm-wide "how did we handle X". "Every project where a hydrant flow test
forced a riser upsize" is impossible on N: without opening files one by one.
Strong pitch to senior staff.

Build: firm-wide content search with discipline, agency, docType and date
filters, returning project, snippet and link. Reuse the existing full-text
extraction path in `read_document`.

Acceptance: a keyword query returns hits across multiple projects with
jump-to-page snippets and working links.

Effort: M

### P2.9 Metadata enrichment surfaced end to end

Precise filtering wants discipline, phase and docType as real fields.

Build: read and expose `Discipline`, `Phase`, `DocType` on all list/find/search
results and accept them as filters. Note that discipline is already available
per sheet from the transmittal log, so prefer the log where it covers, and fall
back to the column.

Acceptance: `find_document(..., discipline="Fire Protection",
docType="Narrative")` filters correctly.

Depends on: Metadata Prerequisites (no longer blocking P0).
Effort: S once columns exist

---

## P3: Robustness and reach

Lower daily frequency, but they remove ceilings.

### P3.10 OCR fallback

Born-digital PDFs read today. Scanned and image-only ones (older drawings,
some incoming markups) return no text.

Build: detect no-text-layer PDFs, route through OCR before extraction, cache
results.

Acceptance: a scanned comment PDF returns usable text on second pass.
Effort: M

### P3.11 Proactive and scheduled hooks

"New review comments landed", "milestone overdue", "set issued". These run in
the cloud with no PC on, which is the cleanest internal one-liner: anything you
want to happen while you are not sitting there requires the file to be in
SharePoint.

Build: event or polling hooks emitting notifications on new comment files,
milestone dates and new transmittals, wired to a scheduled task or Teams post.

Acceptance: dropping a `*COMMENTS*` file triggers a notification within the
poll window.

Depends on: P1.4, P1.6. **Check Graph scopes before committing.** This is the
one item that may need new consent, and IT gatekeeps that.
Effort: L

### P3.12 Telemetry and empty-result tracking

The fastest way to lose a convert is one "the connector didn't find it"
moment. It sends them back to N: for a month. Empty and failed results are a
P0-grade concern even though the dashboard is P3.

Build: log queries (project, tool, hit/miss, latency). Surface "projects with
empty results" and "un-provisioned folders" reports.

Acceptance: a dashboard or query lists top empty-result projects and slowest
calls.

Effort: M

---

## Metadata: DERIVE IT, do not ask people to type it (rewritten 2026-08-05)

**The original plan here was wrong, and it is worth being explicit about why so
it does not come back.** It listed five SharePoint columns to provision:

- `Status` (choice: Current / Superseded / Draft)
- `Revision` (text/number) and `SupersededBy` (link)
- `Discipline` (choice: M / E / P / FP / FA / Multi)
- `Phase` (choice: SD / DD / CD / Bid / CA / Programming / Validation)
- `DocType` (choice: Narrative / Calc / Spec / Comment Log / Transmittal /
  Minutes / Report)

Provisioning columns is an afternoon. **Populating them is a permanent habit
change**: every person, on every upload, forever. That is the part that does not
happen, and a column nobody fills is worse than no column, because search then
returns confidently wrong or nothing at all. The document already said as much
two paragraphs down without following the thought to its conclusion.

**Every one of these is derivable from something that cannot be left blank.**
Shipped 2026-08-05 and measured against real data:

| Field | Derived from | Status |
| --- | --- | --- |
| `Status` / `SupersededBy` | the transmittal register (P0.2) | shipped |
| `Revision` | the register's per-sheet rows | shipped |
| `Phase` | the set folder name, e.g. `2019-11-22_Final CD Submission` | shipped (P2.9) |
| `Discipline` | the sheet-number prefix, e.g. `E211` -> E | shipped, and already
  more reliable than the register's own free-text `discipline` field, which has
  held "Electrical", "STTQ" and "General" on one project |
| `DocType` | filename and folder vocabulary | shipped in `find_document` |

So the columns are not a prerequisite for anything. Do not schedule them.

**If SharePoint's own UI and search are ever wanted to show this**, the answer is
still not data entry: write the DERIVED values into the columns from a job, so
they are populated without anyone typing. That needs Graph write scope on the
site, which IT gatekeeps, so treat it as a separate ask with a real benefit
attached rather than a prerequisite. Read any such column as a TIEBREAK over the
derived value, never as a replacement, or one blank cell reintroduces exactly
the failure this section exists to prevent.

A separate transmittal list is NOT needed either. `pms_filing_log` already
carries Number, IssueDate, SetName, Recipients and Contents.

---

## Deferred housekeeping

Not urgent, not forgotten.

### Retire `pms_data`, the fossil singleton

`pms_data` holds `projects`, `term_contracts`, `staff` and `clients` in one row
and was **last written 2026-05-01**. It carries 81 projects against 151 live, 42
clients against 766, and 8 term contracts against 9. Everything migrated to
per-row tables (`pms_projects`, `pms_clients`) or to `pms_meta.app_meta`, and
nothing appears to read or write it any more.

It is a live trap rather than dead weight: it looks like the authoritative store
for term contracts and staff, and building `list_term_contracts` on it would
have shipped a May snapshot presented as current. That nearly happened on
2026-08-05 and was only caught by adding a record in the app and watching which
table moved.

Before dropping it:

1. Grep the whole suite for `pms_data` (SettyPMS.html, SettyAdmin.html, the
   add-in, every Edge Function) and confirm no reader or writer remains.
2. Check for RLS policies, triggers, views or scheduled jobs referencing it.
3. Rename rather than drop first: `pms_data_legacy_20260501`. A rename breaks a
   forgotten caller loudly and is reversible in seconds; a drop is neither.
4. Leave it renamed for a cycle, watch the logs, then drop.

Owner: unassigned. Raised by Sara 2026-08-06.

---

## Delivered (2026-08-05)

- **P0.1** `get_current_set`, **P0.3** `find_document` — shipped earlier.
- **P0.2 supersession** — `find_document` results carry
  `current` / `superseded` / `ambiguous` / `unknown` plus `supersededBy`.
  Status is about a PHYSICAL FILE, not a sheet: the same filename is issued in
  several sets and a copy sits in each folder, so the verdict is keyed on the
  file's own folder. Every branch fails toward `unknown`.
- **P1.6 `prepare_transmittal`** — prepare-only, no write path. The connector
  runs on the service-role key and Entra sign-in is a boolean gate, so a write
  tool would let anyone issue a transmittal unchecked. Its pre-flight flags
  filenames that yield no sheet number before a set goes out, which is the
  upstream cause of the ~8% of register rows that can never carry a status.
- **P2.9 (derived slice)** — `phase` filter on `find_document`, from the set
  folder name. Columns deliberately not used; see the section above.
- **P3.12 telemetry** — `pms_mcp_telemetry`, one row per tool call. Found the
  latency problem below within minutes of going live.

### The Global Directory (2026-08-06, not previously on this roadmap)

Raised by Sara: "there should be a company retrieval tool... I need a WBE
certified Architect for an SCA project", and "can I get Daniel H from Dattner's
email". Neither was possible: 766 companies, ~2,600 external people, the
86-person staff roster and 9 master agreements were all invisible to the
connector.

- **`search_companies`** — filter by what a firm does and what it is certified
  as, ranked so firms we have worked with come first.
- **`find_contact`** — person lookup across the outside directory and the staff
  roster. Prefix-per-word matching is what makes "Daniel H" resolve.
- **`list_term_contracts`** — the masters and the task orders under each.

**The live store for term contracts and staff is `pms_meta.app_meta`, NOT
`pms_data`.** See the housekeeping note above; this cost an hour and nearly
shipped a stale snapshot.

Also worth recording: `get_project` already returns each project's own
`directory` (92 of 151 projects have one, up to 84 entries), which answers "who
is on this job" and was not documented anywhere.

### Latency, found and fixed the same day

`find_document` was taking **16-30 seconds** per call. Two causes, both fixed:

1. The folder walk was **sequential**, ~150 Graph round trips one after another.
   Now breadth-first a LEVEL at a time with 8 folders in flight, which preserves
   the ordering that matters and overlaps the waiting. 29s -> 13.6s.
2. The tree cache was a module-level `Map`, which does not survive between edge
   isolates, so it missed on nearly every call. Now also written to
   `pms_mcp_tree_cache` and shared. Warm calls **28s -> under 1s**.

Cold calls remain ~12s (first request per project per TTL). If that needs to
come down, raise `TREE_CONCURRENCY` or warm popular projects on a schedule.
Measure with telemetry rather than guessing; that is what it is for.

---

## Cross-cutting conventions (apply to every item)

- **No silent empties.** Every tool that can miss must say why (project not
  provisioned, folder empty, no current rev) and suggest the next step. A
  silent empty is an adoption regression.
- **Always return a clickable `webUrl`**, never a `\\server\` path. Links must
  work off-network, on mobile, and when shared to Teams, email or external
  parties such as BSA and SUCF.
- **Tag every result** with `library`, `status`, and where available
  `discipline` and `phase`.
- **Default to current.** Superseded and draft content is opt-in and always
  flagged.
- **Distinguish unknown from current.** Absence of a supersession record is not
  evidence of currency.
- **Cache the per-project tree.** Retrieval speed is the demo that sells this.

## SETTLED: the supersession rule (Sara, 2026-08-01)

1. **Per-sheet, never per-set.** A partial reissue supersedes only the sheets it
   contains. Everything else stays current at its older revision.
2. **Key on `sheetNo` + `discipline`.**
3. **Same-day ties break on time of day**, with the carve-out below.
4. **Date wins** over a revision-letter disagreement. A later transmittal
   carrying an earlier revision letter still supersedes. Surface the regression
   as a non-blocking anomaly flag rather than silently resolving it, since it
   usually means a filing mistake worth a human look.

### Carve-out on rule 3: time of day is real, except on backfills

Live sends carry genuine sub-second timestamps. Two sends on 2026-05-18 are 11
seconds apart, so time of day resolves real same-day ties.

**Backfilled rows are stamped at a synthetic `12:00:00` UTC.** Both backfills in
the register sit at exactly noon. Two backfills on the same date therefore tie
exactly, and time of day cannot separate them.

Transmittal NUMBER is not a safe fallback either: on `SAPX196006.00` the
register holds `T-002` issued 2025-04-10 and `T-001` issued 2026-04-17, so
numbers are not chronological once backfills are in play.

Cascade to implement: **timestamp, then prefer the live send over a backfill,
then report `ambiguous` and return both.** Guessing at that last step
reintroduces the exact wrong-revision risk P0.2 exists to remove.

## BLOCKER for P0.2: `discipline` in the register is not a discipline

Found while building P0.1, and it defeats rule 2 as written on real data.

`parseFilename()` in `transmittal.html` assumes the filename LEADS with the
discipline (`M-501`, `FP-301`, `P101`). Sheets named with a building series
first do not fit. Bulletin #13 on `SAPX196006.00`:

| filename | sheetNo recorded | discipline recorded |
| --- | --- | --- |
| `STTQ-01-E_Bulletin #13.pdf` | `STTQ-01` | `STTQ` |
| `STTQ-01-M_Bulletin #13.pdf` | `STTQ-01` | `STTQ` |

Two genuinely different sheets, one electrical and one mechanical, collapse to
the same `(sheetNo, discipline)` key. Under rule 2 one would supersede the
other. The other observed value is `General`, also not a discipline.

The real discipline letter survives only in the filename.

Two fixes, and they are not alternatives:

- **P0.1 (done):** `sheetDisciplines()` matches the stored field OR a discipline
  token parsed out of the filename, so `discipline:"E"` finds the E sheet today.
  This makes retrieval work. It does NOT make the key unique.
- **P1.6 (required before P0.2 ships):** fix `parseFilename()` upstream so
  `discipline` is the discipline and `sheetNo` distinguishes the sheets. Until
  then, P0.2 must treat a colliding key as `ambiguous`, never pick a winner.

## P0.1 status: built, not deployed

Branch `connector-get-current-set`. `get_current_set(projectNumber, discipline?)`
added to `index.ts`, with `getCurrentSet.test.mjs` covering 26 assertions against
fixtures pulled verbatim from the live register. Not yet committed, PR'd or
deployed.

Behavior notes worth keeping:

- A `discipline` filter returns the newest set CONTAINING that discipline, not
  the newest set overall. A Bulletin covering only mechanical leaves the current
  electrical set several transmittals back, and answering with the newest set
  would be wrong.
- Ordering is on `created_at`, never on transmittal number, per the carve-out
  above.
- Every miss states its reason and a next step: project not found, project not
  provisioned in SharePoint, no Outgoing folder, no set subfolders, or lookup
  failure. A lookup failure explicitly says it is not proof nothing was issued.
- Inferred answers carry `confidence` and a `basis` naming the folder and the
  date read from its name, so the reader can judge the inference. The tool
  description instructs the model to repeat that it was inferred.
- Folder matching for Outgoing is CONTAINS, not equals, because folder names
  carry numbering and emoji prefixes.
