# Deploy the pms-mcp Edge Function from this checkout and prove it is live.
#
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."      # supabase.com -> Account -> Access Tokens
#   .\supabase\functions\pms-mcp\deploy.ps1     # from anywhere inside the repo
#
# What it does, in order (each step stops the script if it is off):
#   1. moves to the repo root (the CLI must run from there, see README -> Deploying)
#   2. checks out main and pulls, unless -SkipPull
#   3. reads the build that is live now ("deploy-412": it names the deployed copy, see buildLabel.ts)
#   4. npx supabase functions deploy pms-mcp --project-ref ... --no-verify-jwt
#   5. polls /health until it answers with a different deploy- build (cold starts take a few seconds)
# It never touches secrets. "WARNING: Docker is not running" from the CLI is harmless.

param(
  [string]$ProjectRef = "khxmgjilwhdguuepbhne",
  [switch]$SkipPull
)
$ErrorActionPreference = "Stop"

# 1. repo root = the folder that contains supabase\
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
if (-not (Test-Path (Join-Path $root "supabase\functions\pms-mcp\index.ts"))) {
  throw "Could not find supabase\functions\pms-mcp\index.ts under $root - run this from inside the setty-pms checkout."
}
Set-Location $root
Write-Host "Repo root: $root"

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  throw 'SUPABASE_ACCESS_TOKEN is not set. Generate one at supabase.com -> Account -> Access Tokens, then: $env:SUPABASE_ACCESS_TOKEN = "sbp_..."'
}

# 2. main, current
if (-not $SkipPull) {
  git checkout main
  if ($LASTEXITCODE -ne 0) { throw "git checkout main failed" }
  git pull origin main
  if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
}
$dirty = git status --porcelain -- supabase/functions/pms-mcp
if ($dirty) { throw "supabase\functions\pms-mcp has uncommitted changes - disk must equal what you mean to deploy:`n$dirty" }

# 3. the build live now; a successful deploy changes it
$health = "https://$ProjectRef.supabase.co/functions/v1/pms-mcp/health"
$before = $null
try { $before = (Invoke-RestMethod -Uri $health -TimeoutSec 30).build } catch { }
Write-Host "Live before this deploy: $before"

# 4. deploy - repo root, no --import-map, --no-verify-jwt (the function does its own auth)
npx supabase functions deploy pms-mcp --project-ref $ProjectRef --no-verify-jwt --yes
if ($LASTEXITCODE -ne 0) { throw "supabase functions deploy failed (exit $LASTEXITCODE)" }

# 5. prove the new copy is live: a deploy- build different from the one before
Write-Host "Waiting for $health to report a new build ..."
$live = $null
$isNew = { param($l) $l -and $l.ok -and ("$($l.build)" -like "deploy-*") -and ($l.build -ne $before) }
for ($i = 1; $i -le 12; $i++) {
  try {
    $live = Invoke-RestMethod -Uri $health -TimeoutSec 30
    if (& $isNew $live) { break }
    Write-Host "  attempt $i : live build is '$($live.build)' (old copy still answering?)"
  } catch {
    Write-Host "  attempt $i : $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 5
}
if (-not (& $isNew $live)) {
  throw "Health check never reported a new build (still '$before'). Check the deploy output above and the function logs in the Supabase dashboard."
}
Write-Host ""
Write-Host "Live: build $($live.build) (was $before)" -ForegroundColor Green
Write-Host "Next: start a fresh Claude conversation so the tool list refreshes, then revoke the access token."
