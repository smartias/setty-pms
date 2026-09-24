# Vaultwarden — NY team shared secrets

Self-hosted, open-source Bitwarden-compatible server for the team's
*operational* secrets (Supabase `service_role` key, Microsoft Graph app
client secret, Vercel/GitHub tokens, Anthropic API key, and logins to admin
consoles like the Supabase dashboard and Azure/Entra admin). **This does
not replace anything in `setty-pms` itself** — PMS end users authenticate
via Microsoft 365 SSO and never had a password in Supabase to begin with.
This is only for the small number of people who need the raw credentials
behind those systems.

Background and the decision trail live in
`../../HANDOFF-VAULTWARDEN-SETUP-2026-09-24.md` at the repo root.

This lives in its own subfolder rather than a separate repo because the
Claude session that wrote it couldn't create a new GitHub repository
(the connected GitHub App isn't granted repo-creation permission). It's
infra, not application code — treat it that way when deciding who needs
access to this folder vs. the rest of `setty-pms`.

## What you need before starting

- Docker + Docker Compose on the NAS/server (see platform notes below).
- A domain or subdomain pointed at that machine, e.g.
  `vault.settyassociates.com` — an A record to the NAS's public IP, or a
  CNAME if you're proxying through something else. HTTPS is required:
  browsers only allow the crypto APIs Bitwarden clients need over HTTPS
  (or `localhost`), so there's no working around this with plain HTTP.
- Ports **80 and 443** reachable from wherever your team connects from, so
  Caddy can obtain and renew a Let's Encrypt certificate and clients can
  reach the vault.

## Setup

1. **SSH into the NAS/server** and copy this `infra/vaultwarden/` folder
   onto it (e.g. `git clone` a checkout of `setty-pms`, or just copy the
   four files: `docker-compose.yml`, `Caddyfile`, `.env.example`,
   `.gitignore`).
2. `cp .env.example .env` and fill in real values — especially generate a
   real `ADMIN_TOKEN` (`openssl rand -base64 48`). Never commit `.env`.
3. `docker compose up -d` from inside this folder. Caddy will request a
   certificate for `CADDY_HOST` automatically on first request.
4. Visit `https://<your-domain>/admin` and log in with `ADMIN_TOKEN` to
   confirm it's up.
5. **Invite the team**: either flip `SIGNUPS_ALLOWED=true` in `.env`,
   `docker compose up -d` again, have people register, then flip it back
   to `false` and restart — or invite each person from the `/admin` panel
   without ever opening signups. The second is safer; prefer it.
6. **Create an Organization** inside the vault (e.g. "Setty NY"), then
   **Collections** within it scoped per product — e.g. a
   `Setty PMS – Supabase/Graph/Vercel` collection and a separate `Sheetsa`
   collection — so access can be granted per collection instead of
   everyone seeing every product's secrets. This is what "a separate vault
   for Sheetsa" in the original ask maps to.
7. Move the actual operational secrets in: Supabase `service_role` key,
   Microsoft Graph app client secret, Vercel/GitHub deploy tokens,
   Anthropic API key, and the team's admin-console logins.

## Platform notes

- **Synology (DSM 7.2+)**: Container Manager can import a compose project
  directly (Project > Create > point it at this folder), or do it over SSH
  with the plain `docker compose` CLI like any Linux box — DSM 7.2+ ships
  it. Put the folder somewhere under a shared folder (e.g.
  `/volume1/docker/vaultwarden`), not inside `/root`.
- **QNAP**: Container Station supports compose files via its "Create
  Application" import; same environment variables apply. Older Container
  Station versions may need the compose file split into individual
  container definitions in the UI instead of importing directly — check
  the version before assuming import works.
- **Unraid**: Check Community Applications first — Vaultwarden and Caddy
  both commonly exist as one-click templates, which may be simpler than
  hand-rolling this compose file. If going the compose route, the Compose
  Manager plugin runs a `docker-compose.yml` like this one directly.
- **Bare Linux server**: nothing special — install `docker` and the
  `docker compose` plugin, then follow the Setup steps above as written.

## Backups

Everything Vaultwarden needs lives in `./vw-data` (mainly a SQLite
database, encrypted at rest). Fold this directory into whatever backup job
already covers the NAS. **No backup of `vw-data` means the vault is
unrecoverable if that volume is lost** — treat this with the same
seriousness as backing up the Supabase database itself.

## Ongoing maintenance

Periodically pull new images and restart to pick up security patches:

```
docker compose pull
docker compose up -d
```

This is a standing chore, not a one-time setup step — Vaultwarden is
security-sensitive software and should be kept current.

## Clients

Team members install the normal Bitwarden apps/browser extensions, choose
**"Self-hosted"** on first login, and enter `https://<your-domain>` as the
server URL before signing in with the account they were invited with.
