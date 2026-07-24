# Phase 4 — The RLS Flip (runbook)

Flips every anon-accessible policy on PMS data to `TO authenticated`. After this,
signed-out browsers get empty data and the sign-in pill; signed-in users notice
nothing. Prepared 2026-07-24; **not yet applied**.

**Why generators instead of a frozen script:** new tables land weekly (this week
alone: `pms_ar_invoices`, marketing tables). The queries below emit the DDL from
the *live* policy state at run time, so the flip always covers everything.

---

## Go / no-go checklist (all must be true)

- [x] **Adoption strategy decided** — Sara (7/24): flip first, let it FORCE
      sign-in (one click, no password). The v77 signed-out gate makes the
      forcing function self-explanatory instead of looking like data loss.
- [ ] **SettyPMS v77 sign-in gate is DEPLOYED** (this branch merged + live).
      Do not flip while the live PMS predates v77 — signed-out users would see
      an empty app with no explanation.
- [ ] **Heads-up sent to the team** (a one-liner in Teams the day before:
      "PMS will ask you to sign in with your Setty account starting <day> —
      one click, no password").
- [ ] A **low-activity window** (evening / weekend) and someone watching for
      sign-in trouble reports the next workday. Expect a wave of add-in users
      hitting the 🔐 pill on their first post-flip filing.

Flip-immune (verified 7/24, all use the service-role key internally): every Edge
Function — pms-mcp, pms-user-emails (digests/welcomes), rfi-submittal-autosync,
unsubscribe (external recipients keep working), pms-billing-feed, backups.
All web apps + the Outlook add-in already send `settyAuth.token()` with anon
fallback; RFISubmittalSync_Preview was the last gap, wired in this commit.

## Step 1 — capture the rollback (BEFORE flipping)

Run in the Supabase SQL editor; save the output as `phase4-rollback.sql`:

```sql
select string_agg(format(
  'drop policy if exists %I on %I;%screate policy %I on %I for %s to %s%s%s;',
  policyname, tablename, E'\n', policyname, tablename,
  lower(case cmd when 'ALL' then 'all' else cmd end),
  array_to_string(roles, ', '),
  case when qual is not null then format(' using (%s)', qual) else '' end,
  case when with_check is not null then format(' with check (%s)', with_check) else '' end),
  E'\n\n' order by tablename, policyname)
from pg_policies
where schemaname = 'public' and ('anon' = any(roles) or 'public' = any(roles));
```

## Step 2 — generate and run the flip

Same query with the role list swapped — this emits the flip DDL; run its output:

```sql
select string_agg(format(
  'drop policy if exists %I on %I;%screate policy %I on %I for %s to authenticated%s%s;',
  policyname, tablename, E'\n', policyname, tablename,
  lower(case cmd when 'ALL' then 'all' else cmd end),
  case when qual is not null then format(' using (%s)', qual) else '' end,
  case when with_check is not null then format(' with check (%s)', with_check) else '' end),
  E'\n\n' order by tablename, policyname)
from pg_policies
where schemaname = 'public' and ('anon' = any(roles) or 'public' = any(roles));
```

(7/24 dry run: 63 policies across ~35 tables. Admin-only tables — pms_user_roles,
pms_settyfy_map, pms_user_prefs, permission overrides — are already authenticated
and unaffected.)

## Step 3 — verify (10 min)

1. Incognito (signed out): PMS loads UI but **no data**; sign-in pill shows.
2. Signed in: PMS loads normally; edit + save a scratch field on a test project.
3. Add-in (signed in): file an email; confirm it lands in pms_project_emails.
4. Site Report / Field Photos signed in on a phone: create a test entry.
5. Intelligence, RFI/Submittal Sync, Marketing: load signed-in.
6. Confirm the nightly jobs still write (next morning: backups + autosync logs).

## Rollback

Run the saved `phase4-rollback.sql`. Everything returns to pre-flip behavior.

## Afterwards (Phase 5 enforcement, separate deliberate step)

With authenticated-only in place, write policies can add capability terms, e.g.
`with check (pms_has_cap('projects.edit'))` on pms_projects — turning the console
matrix into database enforcement. Do NOT bundle it into flip day; sequence it
table-by-table once the flip has settled.
