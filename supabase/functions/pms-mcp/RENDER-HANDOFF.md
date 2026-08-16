# Document render handoff

How a document Claude drafts becomes a real file on Setty letterhead, without
the connector ever writing to SharePoint.

Status: **spec, not built.** The renderer itself is done and merged
(`docxRender.ts`, `tools/docx-templates/`). This is the plumbing around it.

## The shape

```
Claude                        Supabase                    PMS (browser)
  |                              |                             |
  |  get_document_template  ---> |  (read-only, as today)      |
  |  <--- tokens + prefill       |                             |
  |                              |                             |
  |  create_document_draft  ---> |  INSERT pms_document_drafts |
  |  <--- draft id               |         (service-role)      |
  |                              |                             |
  |                              | <---- poll / badge -------- |
  |                              |                             |
  |                              |   PM reviews the fields, clicks Generate
  |                              |                             |
  |                              |   render in the browser (docxRender.ts)
  |                              |   PUT :/content with the PM's OWN
  |                              |   delegated Graph token
```

Graph stays read-only from the connector. The only thing the connector gains is
the ability to append a row to one table.

## Why not just let the connector write the file

Three reasons, in order of weight:

1. **Audit trail.** An app-only write means SharePoint records the service
   principal as the author of every add service and subagreement. "Who wrote
   this fee letter" stops having an answer.
2. **Phase 5.** Connector reads already use service-role and bypass role
   permissions, which was tolerable while it could only read. Writes would
   bypass them too, undoing the enforcement completed 2026-08-05.
3. **No checkpoint.** Claude would pick a fee and the file would land in the
   client folder with nobody having looked at it.

The new app-only Graph permission it would need is a fourth reason, and the
weakest: the first three hold even if the permission were free.

## 1. The table

Follows the `pms_proposal_clauses` conventions already in use (uuid pk, integer
`version`, `updated_at`/`updated_by`, jsonb payload, text `status`).

```sql
create table pms_document_drafts (
  id             uuid        primary key default gen_random_uuid(),
  template_id    text        not null,          -- 'addservice', 'cad-release', ...
  project_number text        not null,
  requested_by   text        not null,          -- lowercased UPN from the Entra token
  fields         jsonb       not null default '{}'::jsonb,
  unfilled       text[]      not null default '{}',  -- tokens the model could not fill
  notes          text,                          -- Claude's own caveats to the PM
  status         text        not null default 'pending',  -- pending|generated|discarded
  result_url     text,                          -- SharePoint webUrl once generated
  version        integer     not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text,
  expires_at     timestamptz not null default now() + interval '14 days'
);

create index on pms_document_drafts (lower(requested_by), status);
create index on pms_document_drafts (project_number);
```

`unfilled` matters: the renderer already reports tokens it could not fill, and
carrying that to the PM is the whole point of the checkpoint. A draft with a
missing `{{FEE}}` should be visibly incomplete before anyone generates it.

`expires_at` keeps abandoned drafts from accumulating; a nightly sweep deletes
expired `pending` rows.

## 2. RLS

The connector writes with service-role and bypasses RLS entirely, so these
policies govern the **app** side. The connector's own restraint is enforced in
the tool handler, not here.

```sql
alter table pms_document_drafts enable row level security;

-- You see your own drafts. Admins see all.
create policy pms_document_drafts_select on pms_document_drafts
  for select to authenticated
  using (lower(requested_by) = lower(coalesce(auth.jwt() ->> 'email', ''))
         or is_pms_admin());

-- Acting on a draft (generate / discard). NOT capability-gated: admin staff
-- routinely help assemble these documents, and gating generation would block
-- exactly the people who do the work. Sara, 2026-08-16.
create policy pms_document_drafts_write on pms_document_drafts
  for update to authenticated
  using (lower(requested_by) = lower(coalesce(auth.jwt() ->> 'email', ''))
         or is_pms_admin())
  with check (lower(requested_by) = lower(coalesce(auth.jwt() ->> 'email', ''))
              or is_pms_admin());

create policy pms_document_drafts_delete on pms_document_drafts
  for delete to authenticated
  using (lower(requested_by) = lower(coalesce(auth.jwt() ->> 'email', ''))
         or is_pms_admin());
```

No INSERT policy for `authenticated`: drafts come from the connector only.

**No capability gate, deliberately.** An earlier draft of this spec proposed a
`documents.generate` capability. That was wrong: admin staff often help put
these documents together, and gating generation would block exactly the people
doing the work. Anyone signed in can act on a draft addressed to them.

The real protection is downstream and does not need a capability: the file is
written with the person's **own delegated Graph token**, so if SharePoint would
not let them write to that project folder, the save fails. Per-project locks
still apply, they are just enforced by SharePoint rather than duplicated here.

Drafts remain scoped to the requester so people are not wading through each
other's queues; that is routing, not permission. `is_pms_admin()` sees all,
which is how the other tables behave.

## 3. Connector changes

### 3a. Recover the caller identity (prerequisite)

`verifyEntraToken` currently returns a **boolean and discards the payload**, so
the connector has no idea who is asking. Drafts cannot route to a person until
that changes.

```ts
// was: Promise<boolean>
async function verifyEntraToken(token: string): Promise<{ email: string } | null> {
  ...
  if (payload.tid && payload.tid !== ENTRA_TENANT_ID) return null;
  const email = String(payload.preferred_username ?? payload.email ?? "").toLowerCase();
  return email ? { email } : null;
}
```

`preferred_username` carries the UPN on work accounts; `email` is the fallback.

**The `SHARED_SECRET` path is anonymous** (used for health checks and keep-warm)
and must not be able to create drafts. `create_document_draft` returns an error
telling the caller to sign in rather than writing an unattributable row.

This is the only change to existing behaviour, and it is additive: every read
tool keeps working exactly as now.

### 3b. `get_document_template` (read-only, new tool)

Returns the token inventory for a template, the per-token guidance from its
config, and PMS-derived prefill for the project. Read-only and safe to call
speculatively.

It must be a **new tool**, not a parameter on `get_template`: clients cache tool
schemas at connect and silently strip unknown params, so older sessions would
quietly keep using the text path and drift would continue with no error.

### 3c. `create_document_draft` (the one write)

```
create_document_draft(templateId, projectNumber, fields, notes?) -> { draftId, unfilled[], openUrl }
```

Handler responsibilities, in order:

1. Reject if the caller is not Entra-authenticated (no anonymous drafts).
2. Reject an unknown `templateId`; the set is closed.
3. Validate `fields` keys against that template's token inventory. Unknown keys
   are an error, not a silent no-op: a typo'd key would otherwise render as an
   unfilled token with no explanation.
4. Compute `unfilled` from the inventory, and store it.
5. Insert. Return the draft id and a deep link into the PMS.

It writes to one table, and cannot read drafts back. Write-only is a tighter
boundary than read-write and costs nothing here.

## 4. The PMS panel

Feasibility is already settled:

- `SettyPMS.html` **already loads pako**, so deflate is available. A `.docx` is
  a zip, so this needs a small central-directory reader and writer on top of
  pako (roughly 100 lines) or a switch to fflate, which the connector already
  uses. Either way, no new vendor in the page beyond that choice.
- The PMS **already PUTs files to SharePoint** via `:/content` at four call
  sites, so the upload path is proven, not new.
- `docxRender.ts` is import-free precisely so it drops into the browser
  unchanged. Do not fork it; import the same file.

Surface:

- A badge wherever the project header already shows counts: "1 document draft".
- The panel lists drafts for the signed-in person, showing template, project,
  every field value, and `unfilled` called out in red.
- Fields are editable before generating. Reuse `CommitInput` for the text
  inputs; it exists to stop per-keystroke re-renders, and **never give it an
  object-rest param** (the Babel `_excluded` trap).
- **Generate** renders in the browser, PUTs to the project's Project Management
  folder, sets `status='generated'` and `result_url`, and links the file.
- **Discard** sets `status='discarded'`.
- Generate is disabled while `unfilled` is non-empty, unless the PM explicitly
  overrides. The renderer's default is to leave `{{TOKEN}}` visible rather than
  blank it, and the UI should not quietly undo that.

Filing conventions are already specified by the template configs and should be
reused verbatim: file name starts with the project number, save to the project's
Project Management folder, then the Word add-in's Print to OneNote step.

## 5. What the security story becomes

The System Guide currently says the connector "cannot write PMS data". After
this it needs to be precise rather than absolute:

> The connector cannot write project data and cannot write files. It can append
> a row to one drafts table, which only proposes a document; producing the file
> requires a signed-in person with the `documents.generate` capability, and the
> file is written with that person's own Microsoft credentials.

That is a materially smaller claim to defend than "it can write files into
client project folders", and it stays true.

Update `SettyAdmin.html` guide sections 2 (Security) and 7 (Document templates)
together when this ships.

## 6. Open decisions

1. ~~Capability audience.~~ **Settled: no gate.** See RLS above.
2. **Notify or not.** A draft could be silent (badge only) or send the Monday
   digest a line. Silent is the safer default given the digest's history.
3. **zip layer in the browser:** hand-rolled on the pako already present, or add
   fflate to match the connector. Fflate costs a vendor addition to a 1.7 MB
   single-file app; pako costs about 100 lines of zip container code.
4. **Add-in parity.** The Word add-in could render too, which is arguably the
   more natural place since the PM ends up in Word regardless. That is a second
   phase, not a blocker.

## 7. Build order

1. Identity fix in `verifyEntraToken` (small, independent, no behaviour change).
2. Table + RLS + `documents.generate` capability seed.
3. `get_document_template`, then `create_document_draft`.
4. PMS panel and browser render.
5. Guide update, then a **remove-and-re-add** of the connector so the new tools
   enumerate. Editing a connector does not re-enumerate its tools.
