# Proposal: knowledge write-back (`save_knowledge`)

Status: PROPOSAL — nothing here is built. One slice per branch per PR, same
working rules as ROADMAP.md.

## The problem

People ask Claude questions through the connector and get answers that took
real work to assemble — "DASNY bounced the Phase 1 submittal because the cover
sheet lacked X", "the Phase 1 hydraulic constraint still governs Phase 3",
"this agency wants closeout billing split by discipline". Today that answer
lives in one person's chat session and evaporates. The next person re-derives
it or, worse, never learns it.

The connector already has a proven answer for the *read* half of this:
`search_agency_preferences` over `pms_agency_preferences` — curated rows of
firm know-how that every session can query. What's missing is a way for
knowledge to get IN other than someone hand-editing the table.

## Why the "no write tools" rule doesn't block this

The connector's write prohibition (see the `prepare_transmittal` comment in
`index.ts`) rests on two facts that were true when it was written and are no
longer both true:

1. *"Entra sign-in is a boolean gate rather than an identity."* — No longer.
   Phase A resolves a `Caller` (email, name, oid) on every tool call, and
   telemetry writes `caller_email` per call. A knowledge row can name its
   author.
2. *"No permission check."* — No longer. Phase 5 enforcement is live:
   `pms_caps_for(email)` / `pms_has_cap()` gate writes table-by-table today
   (field.report, emails.file, projects.edit slices are LIVE). A
   `knowledge.contribute` capability is one more row in the same matrix.

What DOES survive from that rule, and this proposal keeps: Claude-initiated
writes never become authoritative on their own. `prepare_transmittal` stages
and STOPS; a person issues. `save_knowledge` follows the same posture: rows
land as `pending` and a person promotes them to `active` in the Admin console.
Nothing pending is ever served to other users' sessions as firm knowledge.

## Design

Four pieces, in dependency order.

### 1. Table: `pms_knowledge` (migration)

Modeled on `pms_agency_preferences`, generalized past agencies:

```sql
create table if not exists public.pms_knowledge (
  id               uuid primary key default gen_random_uuid(),
  -- What kind of knowledge this is. Scopes retrieval and review routing.
  kind             text not null check (kind in
                     ('project',        -- true of one job: decisions, constraints, history
                      'agency',         -- how a client agency behaves (candidate for promotion
                                        --   into pms_agency_preferences on review)
                      'firm')),         -- firm-wide convention or process fact
  project_number   text,               -- required when kind='project'; join key used everywhere
  agency           text,               -- required when kind='agency'
  discipline       text,               -- optional filter, free text like agency prefs
  title            text not null,      -- one line, what a teammate scans
  body             text not null,      -- the finding itself, self-contained
  source           text,               -- citations: noteIds, document paths, email subjects,
                                       --   RFI numbers — whatever the session used to derive it
  -- Attribution, from Phase A caller identity. NOT NULL: an unattributed
  -- knowledge row is exactly what the old no-write rule existed to prevent.
  author_email     text not null,
  author_name      text,
  -- Lifecycle. pending → active | rejected; active → archived (superseded).
  status           text not null default 'pending' check (status in
                     ('pending','active','rejected','archived')),
  reviewed_by      text,               -- email of the promoter/rejecter
  reviewed_at      timestamptz,
  review_note      text,               -- why rejected, or edits made on promotion
  superseded_by    uuid references public.pms_knowledge(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists pms_knowledge_project on public.pms_knowledge (project_number);
create index if not exists pms_knowledge_status  on public.pms_knowledge (status);
```

RLS follows the Phase 5 pattern: SELECT open to authenticated (reads are
signed-in-only, not role-scoped, per the Phase 5 posture); INSERT gated on
`pms_has_cap('knowledge.contribute', project_number)`; UPDATE (review actions)
gated on `pms_has_cap('knowledge.review', null)` or `is_pms_admin()`. The
connector itself runs service-role so RLS doesn't bind it — the same checks
are enforced in the tool handler via the already-resolved `ResolvedCaps`,
which is how the Phase 5 rollout says connector-side enforcement works.

The capability rows (`knowledge.contribute`, `knowledge.review`) are added to
the matrix like any Phase 5 slice. Suggested defaults, subject to Sara's
review like Gate B: contribute allowed for all roles including the staff
baseline (capturing knowledge should be frictionless; review is the gate),
review limited to admin + PM-level roles.

### 2. Write tool: `save_knowledge`

One new MCP tool. Sketch of the handler contract, not final code:

```ts
mcp.tool("save_knowledge", {
  description:
    "Save a durable finding to Setty's shared knowledge layer as a PENDING entry for human " +
    "review — it is NOT published until a reviewer promotes it. Use when the user says to " +
    "save / remember / share something the session established: a project decision or " +
    "constraint, how an agency behaved, a firm convention. Always cite sources (noteIds, " +
    "document paths, RFI numbers) so the reviewer can verify. Never save speculation, " +
    "anything the user did not ask to save, or anything already in " +
    "search_agency_preferences / search_knowledge.",
  inputSchema: z.object({
    kind: z.enum(["project", "agency", "firm"]),
    projectNumber: z.string().optional(),  // required when kind=project (runtime check)
    agency: z.string().optional(),         // required when kind=agency
    discipline: z.string().optional(),
    title: z.string().max(200),
    body: z.string().max(4000),
    source: z.string().max(1000).optional(),
  }),
  handler: ...
});
```

Handler rules, each load-bearing:

- **Identity required.** `currentCaller().email` null (UNKNOWN_CALLER, or the
  shared-secret service path) → refuse with a message saying sign-in is
  required to contribute. This is the direct answer to the old objection.
- **Capability required.** `caps` lacks `knowledge.contribute` for the target
  project → refuse, naming the capability, same UX as other Phase 5 denials.
- **Always `status='pending'`.** The tool has no way to write `active`. Not a
  parameter, not for admins — promotion happens where a person is present.
- **Dedup nudge, not gate.** Before insert, a cheap trigram/ILIKE check
  against active + pending rows for the same project/agency; on a near match
  return the existing row and ask the model to confirm it's genuinely new
  (an `allowDuplicate: true` re-call proceeds). Keeps the review queue from
  silting up with restatements.
- **Rate ceiling.** Per caller_email, e.g. 20 pending rows outstanding →
  refuse until reviewed. A runaway session cannot flood the queue.
- **Return** the row id, its `pending` status, and a pointer to where it gets
  reviewed, so the model tells the user "saved for review" and not "saved".

### 3. Retrieval: `search_knowledge` + `project_briefing` fold-in

- `search_knowledge(query?, projectNumber?, agency?, discipline?, includeArchived?)`
  — same shape and in-memory filter style as `search_agency_preferences`.
  Serves ONLY `active` rows (archived on request, same as agency prefs).
  A `mine: true` flag additionally returns the caller's own pending/rejected
  rows with their review notes, so a contributor can check what happened to
  a submission — but never anyone else's pending rows.
- `project_briefing` gains a `knowledge` section: active rows for that
  project (and its linked phases once P2.7 lands), newest first, capped
  small. This is the piece that makes sharing passive — a teammate opening
  the project gets the knowledge without knowing to ask for it.
- `search_agency_preferences` stays untouched. On review, an `agency`-kind
  row can be promoted INTO `pms_agency_preferences` instead (reviewer's
  choice in the console), keeping that curated table the single home for
  agency behavior rather than splitting it across two tables.

### 4. Review surface: SettyAdmin Knowledge tab

A new tab in `SettyAdmin.html`, next to the Claude/MCP usage card, listing
pending rows (author, date, title, body, sources, project) with four actions:

- **Promote** → `status='active'`, stamps `reviewed_by/at`; editable before
  promoting (fix wording, tighten scope) with edits noted in `review_note`.
- **Promote to agency preferences** (agency-kind only) → inserts into
  `pms_agency_preferences`, marks the knowledge row `archived` with
  `review_note` pointing at it.
- **Reject** → `status='rejected'` + required `review_note` (visible to the
  author via `mine: true`, so rejection teaches rather than vanishes).
- Later, on active rows: **Archive / supersede** (link `superseded_by`).

The tab badge shows the pending count. Optionally, a weekly digest of pending
rows to reviewers — but the tab alone is the MVP.

## What this deliberately does not do

- **No auto-publication, ever.** The review gate is the design, not overhead.
  The failure mode it prevents — one session's confident mistake becoming
  every session's "firm knowledge" — is worse than a slow queue.
- **No auto-capture.** The tool fires only when the user asks to save
  something. Mining telemetry for candidate knowledge (Option C in the
  originating discussion) stays a separate, later idea; wiring it in here
  would flood the queue before the review habit exists.
- **No edits to business records.** Notes, emails, transmittals, milestones
  stay read-only. This table is a new, parallel layer that can be truncated
  without losing a business record — same posture as the drawing text index.

## Delivery slices

| Slice | Contents | Acceptance |
| --- | --- | --- |
| K1 | Migration + RLS + matrix capabilities | Table exists; persona-simulation verify per Phase 5 runbook (contributor can INSERT pending, staff-baseline per matrix decision, no-email JWT denied; only reviewer role can flip status) |
| K2 | `save_knowledge` tool | Signed-in user saves a project finding → pending row with their email; unknown caller refused; 21st outstanding pending row refused; near-duplicate returns existing row first |
| K3 | `search_knowledge` + briefing fold-in | Active row surfaces in `search_knowledge` and in `project_briefing` for its project; pending row surfaces in neither; author sees own pending via `mine: true` |
| K4 | SettyAdmin Knowledge tab | Reviewer promotes → row serves to a different user's session; rejects → author sees the note; agency-kind promote lands in `pms_agency_preferences` |

K1→K2 ship together at minimum (a write path with no table is nothing); K3
can precede K4 (rows can be promoted by SQL in the gap, as Phase 5 slices
were verified); K4 completes the loop.

## Open questions for review

1. Matrix defaults: is contribute-for-everyone right, or should qaqc's
   read-only stance (Gate B) extend here?
2. Should `project_briefing` show the *caller's own* pending rows inline
   (marked as unreviewed) or strictly active-only? Strictly active is safer;
   own-pending is more encouraging.
3. Review SLA: is the tab badge enough, or do pending rows older than N days
   need a nudge (digest email / morning-brief line)?
