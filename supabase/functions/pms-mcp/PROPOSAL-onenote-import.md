# Proposal: OneNote page import into PMS notes

Status: scoping only. Nothing here is built.

## Problem

`search_notes` / `read_note` (pms-mcp) read only `project.notes[]` on the
`pms_projects` row. Notes reach that array when someone saves them in the PMS
Notes tab (PMS -> OneNote push). Nothing reads OneNote back. Pages written
directly in OneNote, or copied in from elsewhere, are invisible to the
connector and to Claude.

Motivating case: SAPX256014.00 (PANYNJ EWR AirTrain CFD). Varun copied a past
employee's meeting notes into a OneNote section. `search_notes` returns 0 for the
project. SharePoint search shows page titles and the first ~250 characters
only, and a direct read of a page returns NOT_FOUND.

The existing code comment (index.ts, "Meeting minutes -> structured items")
records this as a deliberately deferred follow-up: no code in the repo reads
OneNote page content from Graph.

## Key constraint: app-only Graph cannot read OneNote

The connector authenticates with client credentials (`graphToken()`,
`GRAPH_CLIENT_ID/SECRET`). Microsoft retired app-only auth for the OneNote
API (March 2025), so a server-side sweep in the edge function is not a viable
design. VERIFY against current Microsoft docs and with a live call before
committing to either path.

The PMS browser sign-in is delegated and already requests
`Notes.ReadWrite.All` (SettyPMS.html GRAPH_SCOPES, ~line 700). So the import
runs in the browser as the signed-in user. No new consent, no admin ask.

## Recommended design (browser-side, user-triggered)

An "Import from OneNote" action on the project Notes tab.

1. **Pick the source.** Use the project's linked notebook
   (`teamsOneNoteNotebookId` / `oneNoteNotebookId`). Many existing projects,
   including SAPX256014.00, have a notebook the PMS did not create (it lives
   under the NYCProjects site's Notebooks folder). Allow pasting a OneNote
   notebook/section link and resolve it with
   `GET /sites/{siteId}/onenote/notebooks?$filter=...` or
   `GET /sites/{siteId}/onenote/sections`. Store the resolved ids back on the
   project so the next import is one click.
2. **List pages.** `GET .../sections/{id}/pages?$select=id,title,createdDateTime,lastModifiedDateTime,createdByAppId,links,contentUrl`
   (paged). Show a checklist: title, created, last modified, "already
   imported" badge. Default-select new/changed pages.
3. **Fetch content.** `GET .../pages/{id}/content`. Convert HTML to the
   project's note body (see "Mapping"). Strip OneNote chrome, keep text,
   lists, tables. Images and ink/attachments are out of scope for v1: record
   "N images not imported" in the note.
4. **Write notes.** Append to `project.notes[]` through the normal
   `onChange` path (optimistic concurrency / `version` already handled by the
   PMS save flow). No direct SQL, so no version-bump pitfall.
5. **Re-import is idempotent.** Key each imported note by OneNote page id
   (`oneNotePageId`) plus `lastModifiedDateTime`. Unchanged page: skip.
   Changed page: update the note body and flag it "updated from OneNote",
   keeping any edits made in PMS visible in the diff prompt rather than
   silently overwriting.

### Mapping to the note shape

Existing shape (SettyPMS.html `addNote`): `id, body, category, actionItem,
actionOwner, actionDueDate, actionStatus, author, createdAt, updatedAt,
oneNoteUrl, links`.

| OneNote | PMS note |
|---|---|
| page id | new field `oneNotePageId` (dedupe key) |
| page title | first line of `body` and used for category guess |
| `createdDateTime` | `createdAt` (meeting date stays the real date, not import date) |
| page `links.oneNoteWebUrl.href` | `oneNoteUrl` |
| author | OneNote `createdBy` is often missing. Use `author: "Imported from OneNote"` plus the user who ran the import in `importedBy`. Do NOT attribute to the person who ran it. |
| category | guess from section/title ("Meeting", "Site Visit", "Call"), user can edit in the checklist |
| provenance | `importedFrom: "onenote"`, `importedAt`, optional `originalAuthor` free-text field the importer can fill ("Don, copied by Varun") |

Provenance matters here: the SAPX256014.00 pages are older notes by someone
who has left, copied in by a second person. The note should say so, so nobody
mistakes them for current-meeting minutes.

## Connector side (small)

- `search_notes` / `read_note` need no change: imported notes live in
  `project.notes[]`, so they appear automatically. Add `importedFrom` and
  `originalAuthor` to their returned fields so Claude can cite provenance.
- Optional follow-up: feed imported meeting pages into the existing minutes
  pipeline. `pms_meetings.source` already allows `'onenote'`, with
  `source_ref` = OneNote page id and the unique `(project_number, source_ref)`
  constraint giving idempotency. That extraction writes `suggested` decisions,
  actions and open questions for human review (`meeting_items.review`). Do
  this as a second change, after plain note import is proven.

## Out of scope for v1

- Scheduled / background sync (not possible app-only; a delegated refresh
  token job is new infrastructure).
- Images, ink, attachments, embedded files (record a count only).
- Two-way sync (OneNote edits flow in on re-import; PMS edits never flow out).
- Importing every project's notebook at once. Per-project, user-triggered.
- Notebooks the signed-in user cannot open. Graph returns 403/404; show a
  clear "you don't have access to this notebook" message, never an empty
  catch (CLAUDE.md Graph rule).

## Risks and open questions

1. **Graph OneNote on SharePoint-site notebooks.** Confirm `/sites/{siteId}/onenote`
   works with delegated `Notes.ReadWrite.All` for the NYCProjects notebook
   (large notebooks can hit Graph OneNote throttling/timeouts; page content
   calls are the slow part). Needs one live test with a real signed-in
   session. This is the main unknown and the first task.
2. **Page content fidelity.** Pages copied by pasting often arrive as one
   outline blob. HTML-to-text must preserve line breaks and bullets. Needs
   test fixtures from real pages (anonymize first).
3. **Throttling.** Fetch content sequentially or 3-way parallel, with 429
   `Retry-After` handling. A 200-page section should complete in minutes and
   show progress.
4. **Size.** `project.notes[]` lives in the `pms_projects` JSONB row. Cap per
   note (e.g. 20k chars, with a "see OneNote page" link) so a 100-page
   import cannot bloat the row. Consider a cap on pages per import run.
5. **Confidentiality.** Imported text becomes readable by everyone who can read
   the project. Confirm confidential-project handling is unchanged (notes
   already inherit it).
6. **Who may run it.** Reuse whatever capability gates adding notes today; no
   new capability needed.

## Work breakdown

1. Spike (0.5 day): from a signed-in browser, list pages and fetch content for
   the SAPX256014.00 section. Settles risk 1. Go/no-go.
2. Graph helpers in SettyPMS.html: resolve notebook/section, list pages,
   fetch content, HTML-to-text with tests (extract to a `.js` module so it is
   unit-testable with `node --test`).
3. Import panel on the Notes tab: source resolution, page checklist,
   progress, dedupe by `oneNotePageId`, provenance fields.
4. Connector: surface provenance fields in `search_notes` / `read_note`; tests
   in `supabase/functions/pms-mcp/`. The edge function needs
   `deploy_edge_function` to ship; a repo merge alone does not.
5. SettyPMS.html rules: bump `window.__appVersion`, keep CRLF, no object-rest
   params, babel-parse both blocks before pushing.
6. (Follow-up) run imported meeting pages through the minutes extraction.

Rough size: 2 to 3 days after a successful spike, one PR for the PMS import
and a separate small PR for the connector fields.

## Interim answer for SAPX256014.00

Until this ships: export the section from OneNote to Word/PDF (the connector
and Claude can read those), or paste the pages into the project Notes tab.
