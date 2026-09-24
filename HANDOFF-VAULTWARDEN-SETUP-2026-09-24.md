# Handoff: self-hosted password manager (Vaultwarden) for NY team shared secrets

**Read this first if picking up on the Setty Claude account.** Written
2026-09-24 from a session on the other account. Nothing has been deployed
yet — this is planning/guidance only, not started. Same reason as
`HANDOFF-STATUS-2026-09-20.md`: committed to the repo so any computer or
Claude account can see it.

## What this is about

Sara asked whether a password manager (1Password vs Bitwarden) needs to be
added "to the code," and whether user passwords are managed in Supabase.

**Answered, not a code change:**
- SettyPMS end users have no password in Supabase at all — auth is
  Microsoft 365 SSO (MSAL/Entra ID) via `setty-auth.js`; Supabase only
  validates the Microsoft-issued JWT (`settyAuth.token()`). Nothing to
  protect there with a vault.
- What actually needs a shared vault: the team's *operational* secrets —
  Supabase `service_role` key, Microsoft Graph app client secret, Vercel/
  GitHub deploy tokens, Anthropic API keys, and logins to the admin
  consoles themselves (Supabase dashboard, Azure/Entra admin, Vercel,
  GitHub org).
- Follow-up: use Bitwarden's **open-source server**, self-hosted on the NY
  team's existing server/NAS, rather than the hosted cloud or 1Password.

## Decision so far

- Self-host, not Bitwarden cloud / not 1Password.
- Run it on the NY team's **existing server/NAS** (not a new VPS) — exact
  platform (Synology? Unraid? bare Linux box?) was not confirmed in this
  session. **First question to ask Sara when picking this up.**
- Use **Vaultwarden** (https://github.com/dani-garcia/vaultwarden), the
  unofficial open-source reimplementation of the Bitwarden server — one
  lightweight Docker container + SQLite, compatible with all official
  Bitwarden apps/extensions/mobile clients. Chosen over the official
  self-hosted Bitwarden stack (heavier: multiple containers + MSSQL, some
  features still gated behind a paid license even self-hosted).

## Setup plan (not yet executed)

1. Confirm the NAS/server platform and its Docker support.
2. Point a domain/subdomain at it (e.g. `vault.settyassociates.com`) — HTTPS
   is required (browser Web Crypto only works over HTTPS or `localhost`).
3. `docker-compose.yml` with two services:
   - `vaultwarden/server:latest` — data volume `./vw-data:/data`,
     `SIGNUPS_ALLOWED=false` by default, `ADMIN_TOKEN` set to a long random
     secret, `DOMAIN` set to the HTTPS URL.
   - `caddy:latest` reverse proxy on ports 80/443, auto Let's Encrypt via a
     one-block `Caddyfile` (`vault.domain { reverse_proxy vaultwarden:80 }`).
4. Temporarily flip `SIGNUPS_ALLOWED=true` (or use the `/admin` panel) to
   invite each NY teammate, then flip back to `false` (invite-only).
5. Inside Vaultwarden: create an **Organization** ("Setty NY"), then
   **Collections** per product so access is scoped — e.g. a
   `Setty PMS – Supabase/Graph/Vercel` collection and a separate `Sheetsa`
   collection, so not everyone sees every product's secrets. (This is the
   "separate vault for Sheetsa" Sara asked about.)
6. **Backups**: everything lives in `./vw-data` (mainly a SQLite file,
   encrypted at rest). Fold it into whatever backup job already covers the
   NAS. No backup = the vault is unrecoverable if that volume is lost.
7. **Ongoing maintenance**: periodic `docker compose pull && docker compose
   up -d` to pick up security patches — flag this as a standing chore, not
   a one-time setup.
8. Clients: normal Bitwarden apps/browser extensions, but choose
   "self-hosted" on first login and enter the `https://vault.domain` URL
   before signing in.

## Not decided / open questions for Sara

- Which server/NAS this actually runs on (blocks step 1–3 above).
- Who owns the ongoing patching/backup responsibility.
- Exact domain/subdomain to use.
- Whether this belongs in its own repo (e.g. `smartias/vaultwarden-infra`)
  for the docker-compose + Caddyfile, since it isn't `setty-pms` application
  code and doesn't deploy via Vercel.

## Checklist

- [ ] Confirm NAS/server platform with Sara
- [ ] Domain/subdomain + DNS pointed at the server
- [ ] docker-compose + Caddyfile written (where? new repo, per above)
- [ ] Vaultwarden deployed, admin panel reachable over HTTPS
- [ ] NY team invited, `SIGNUPS_ALLOWED` flipped back off
- [ ] Organization + per-product collections created (Setty PMS, Sheetsa, …)
- [ ] Backup job covers `vw-data`
- [ ] Operational secrets (Supabase service_role, Graph client secret,
      Vercel/GitHub tokens, Anthropic key) actually moved into it
