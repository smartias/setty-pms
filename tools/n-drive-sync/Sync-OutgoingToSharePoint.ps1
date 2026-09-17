<#
.SYNOPSIS
  Copies recently saved files from each project's Outgoing folder on the
  network drive up to the project's Outgoing folder in SharePoint, when they
  are not there yet.

.DESCRIPTION
  Phase one of the storage policy's enforcement agent (see README.md). Runs on
  a Windows host that has the network drive mapped, under a service account.

  For every project folder found under the configured source roots
  (N:\SAP\2025\SAPQ256919.01, ...) it:
    1. finds the Outgoing subfolder (CONTAINS "outgoing", like the connector);
    2. takes files last written inside the recency window;
    3. resolves the project's folder in the region's SharePoint library
       (folder name STARTS WITH the project number, like the connector) and
       its Outgoing subfolder (created when missing, in -Commit mode);
    4. uploads what is missing, replaces what differs in size when the
       SharePoint copy is not newer, and skips the rest;
    5. appends every decision to a CSV ledger and writes a run report.

  DRY RUN BY DEFAULT. Nothing is written to SharePoint without -Commit.

  Timestamps: SharePoint's modified dates were flattened by the bulk
  migration, so "already there" is decided by relative path + byte size,
  never by date. Files the script uploads carry the network drive's created
  and modified times (fileSystemInfo), so this migration does not flatten
  them again.

.PARAMETER ConfigPath
  JSON config. Defaults to config.json beside this script. See config.example.json.
.PARAMETER Commit
  Actually upload. Without it every upload is logged as would-copy / would-replace.
.PARAMETER SinceDays
  Override the recency window (config sinceDays). Ignores the saved state.
.PARAMETER Project
  Only these project numbers (prefix match, case-insensitive).
.PARAMETER MaxFiles
  Cap on uploads this run (config maxFilesPerRun). 0 = use config.
.PARAMETER NoState
  Do not read or write the state file (lastSuccessUtc).

.EXAMPLE
  pwsh -File .\Sync-OutgoingToSharePoint.ps1                 # dry run, report only
  pwsh -File .\Sync-OutgoingToSharePoint.ps1 -Project SAPQ256919.01 -SinceDays 30
  pwsh -File .\Sync-OutgoingToSharePoint.ps1 -Commit         # scheduled task form
#>
[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json'),
  [switch]$Commit,
  [int]$SinceDays = 0,
  [string[]]$Project = @(),
  [int]$MaxFiles = 0,
  [switch]$NoState
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:GraphBase = 'https://graph.microsoft.com/v1.0'
# Upload-session chunks must be a multiple of 320 KiB; 10 MiB = 32 × 320 KiB.
$script:ChunkBytes = 10485760
$script:SmallFileBytes = 4194304   # Graph's simple-PUT ceiling is 4 MB.

# ---------------------------------------------------------------------------
# Pure helpers (covered by Test-SyncFunctions.ps1; no network, no config)
# ---------------------------------------------------------------------------

function Get-DefaultConfig {
  [ordered]@{
    region                  = 'NY'
    tenantId                = ''
    clientId                = ''
    clientSecretEnv         = 'SETTY_SYNC_CLIENT_SECRET'
    siteUrl                 = ''
    docLibrary              = 'Project Document Library'
    sources                 = @()
    projectFolderPattern    = '^[A-Z]{3,5}\d{6}\.\d{2}'
    yearFolderPattern       = '^\d{4}$'
    outgoingMatch           = 'outgoing'
    sinceDays               = 7
    overlapHours            = 2
    maxFilesPerRun          = 500
    maxFileBytes            = 2147483648
    skipPatterns            = @('~$*', '*.tmp', 'Thumbs.db', 'desktop.ini', '.DS_Store', '*.lock', '*.crdownload', '*.partial')
    createOutgoingIfMissing = $true
    preserveTimestamps      = $true
    stateDir                = ''
    projectOverrides        = @{}
  }
}

function Merge-Config {
  param([hashtable]$Defaults, $Loaded)
  $out = [ordered]@{}
  foreach ($k in $Defaults.Keys) { $out[$k] = $Defaults[$k] }
  if ($null -ne $Loaded) {
    foreach ($p in $Loaded.PSObject.Properties) {
      if ($p.Name -eq 'projectOverrides' -and $null -ne $p.Value) {
        $h = @{}
        foreach ($q in $p.Value.PSObject.Properties) { $h[$q.Name.ToUpperInvariant()] = [string]$q.Value }
        $out[$p.Name] = $h
      } else {
        $out[$p.Name] = $p.Value
      }
    }
  }
  if (-not $out.stateDir) { $out.stateDir = Join-Path $PSScriptRoot 'state' }
  $out.sources = @($out.sources | Where-Object { $_ })
  $out.skipPatterns = @($out.skipPatterns | Where-Object { $_ })
  $out
}

function Test-SkipName {
  # Lock files, temp files and OS litter. Wildcards are PowerShell -like.
  param([string]$Name, [string[]]$Patterns)
  foreach ($p in $Patterns) { if ($Name -like $p) { return $true } }
  $false
}

function Test-SharePointName {
  # SharePoint rejects these outright; catching them here keeps a bad name
  # from failing the upload with an opaque 400. Returns $null when fine, or
  # the reason.
  param([string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) { return 'empty name' }
  if ($Name -match '["*:<>?/\\|]') { return 'contains one of " * : < > ? / \ |' }
  if ($Name -ne $Name.Trim()) { return 'leading or trailing whitespace' }
  if ($Name.EndsWith('.')) { return 'ends with a period' }
  if ($Name -match '^(\.lock|CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]|_vti_|desktop\.ini)$') { return 'reserved name' }
  if ($Name.StartsWith('~$')) { return 'Office lock file' }
  if ($Name.Length -gt 255) { return 'longer than 255 characters' }
  $null
}

function Get-RelativeSegments {
  # Path of $FullPath below $Root as an array of segments, no root, no file.
  param([string]$Root, [string]$FullPath)
  $r = $Root.TrimEnd('\', '/')
  if (-not $FullPath.StartsWith($r, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "'$FullPath' is not under '$Root'"
  }
  $rel = $FullPath.Substring($r.Length).TrimStart('\', '/')
  if (-not $rel) { return @() }
  @($rel -split '[\\/]' | Where-Object { $_ -ne '' })
}

function ConvertTo-GraphPath {
  # Segments → escaped path for /items/{id}:/a/b/c:/... addressing.
  param([string[]]$Segments)
  ($Segments | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
}

function Get-SinceUtc {
  # The window start. Explicit -SinceDays wins; else pick up where the last
  # successful run left off (minus an overlap so a file saved during that run
  # is not missed); else the configured window. Never later than the window
  # start so a long gap between runs is caught up, and never earlier than
  # sinceDays × 4 so a stale state file cannot trigger a full re-crawl.
  param([datetime]$NowUtc, [int]$SinceDaysOverride, [int]$ConfigDays, [int]$OverlapHours, [datetime]$LastSuccessUtc = [datetime]::MinValue)
  if ($SinceDaysOverride -gt 0) { return $NowUtc.AddDays(-$SinceDaysOverride) }
  $window = $NowUtc.AddDays(-$ConfigDays)
  if ($LastSuccessUtc -eq [datetime]::MinValue) { return $window }
  $resume = $LastSuccessUtc.AddHours(-$OverlapHours)
  $floor = $NowUtc.AddDays(-$ConfigDays * 4)
  if ($resume -lt $floor) { return $floor }
  if ($resume -gt $window) { return $window }
  $resume
}

function Find-ProjectFolderName {
  # The connector's rule: first folder whose name starts with the number.
  # Longest number wins when several registered numbers prefix each other.
  param([string[]]$Names, [string]$ProjectNumber)
  $num = $ProjectNumber.Trim().ToLowerInvariant()
  foreach ($n in $Names) { if ($n.ToLowerInvariant().StartsWith($num)) { return $n } }
  $null
}

function Select-OutgoingName {
  # CONTAINS, not equals: names carry numbering and emoji prefixes
  # ("99 📤 Outgoing", "99-SIPX262012.00_OUTGOING").
  param([string[]]$Names, [string]$Contains = 'outgoing')
  $hits = @($Names | Where-Object { $_.ToLowerInvariant().Contains($Contains.ToLowerInvariant()) })
  if ($hits.Count -eq 0) { return $null }
  # Prefer the plainest match (shortest name) when several qualify.
  ($hits | Sort-Object Length)[0]
}

function Get-SyncDecision {
  # copy | skip-exists | replace | conflict-sharepoint-newer | skip-too-large
  # Size is the only trustworthy equality signal (migrated dates are
  # flattened). A size mismatch is replaced unless SharePoint's own modified
  # stamp is later than the drive's: that means someone edited it in
  # SharePoint after the migration, and the drive copy is the stale one.
  param([long]$SourceLength, [datetime]$SourceModifiedUtc, $Target, [long]$MaxBytes)
  if ($MaxBytes -gt 0 -and $SourceLength -gt $MaxBytes) { return 'skip-too-large' }
  if ($null -eq $Target) { return 'copy' }
  if ([long]$Target.size -eq $SourceLength) { return 'skip-exists' }
  $spModified = $null
  if ($Target.PSObject.Properties['fileSystemInfo'] -and $Target.fileSystemInfo -and $Target.fileSystemInfo.lastModifiedDateTime) {
    $spModified = ([datetime]$Target.fileSystemInfo.lastModifiedDateTime).ToUniversalTime()
  } elseif ($Target.PSObject.Properties['lastModifiedDateTime'] -and $Target.lastModifiedDateTime) {
    $spModified = ([datetime]$Target.lastModifiedDateTime).ToUniversalTime()
  }
  if ($spModified -and $spModified -gt $SourceModifiedUtc.AddMinutes(1)) { return 'conflict-sharepoint-newer' }
  'replace'
}

function Get-SourceProjects {
  # Walk the source roots for project folders. Layouts handled:
  #   <root>\<year>\<project>      (NY: N:\SAP\2025\SAPQ256919.01)
  #   <root>\<project>             (a root registered at the year folder)
  # Returns objects: Number, Name, Path, OutgoingPath (or $null).
  param([string[]]$Roots, [string]$ProjectPattern, [string]$YearPattern, [string]$OutgoingMatch, [string[]]$OnlyProjects = @())
  $found = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root)) { Write-Warning "Source root not found: $root"; continue }
    $groups = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)
    $candidates = New-Object System.Collections.Generic.List[object]
    foreach ($g in $groups) {
      if ($g.Name -match $ProjectPattern) { $candidates.Add($g); continue }
      if ($g.Name -match $YearPattern) {
        foreach ($p in @(Get-ChildItem -LiteralPath $g.FullName -Directory -ErrorAction SilentlyContinue)) {
          if ($p.Name -match $ProjectPattern) { $candidates.Add($p) }
        }
      }
    }
    foreach ($dir in $candidates) {
      $number = [regex]::Match($dir.Name, $ProjectPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase).Value.ToUpperInvariant()
      if ($OnlyProjects.Count -gt 0) {
        $keep = $false
        foreach ($o in $OnlyProjects) { if ($number.StartsWith($o.Trim().ToUpperInvariant())) { $keep = $true; break } }
        if (-not $keep) { continue }
      }
      if ($seen.ContainsKey($number)) { Write-Warning "Project $number appears twice on the drive; using $($seen[$number]), ignoring $($dir.FullName)"; continue }
      $seen[$number] = $dir.FullName
      $subNames = @(Get-ChildItem -LiteralPath $dir.FullName -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
      $outName = Select-OutgoingName -Names $subNames -Contains $OutgoingMatch
      $found.Add([pscustomobject]@{
        Number       = $number
        Name         = $dir.Name
        Path         = $dir.FullName
        OutgoingPath = if ($outName) { Join-Path $dir.FullName $outName } else { $null }
      })
    }
  }
  $found
}

function Get-CandidateFiles {
  # Files under the drive's Outgoing folder written on or after $SinceUtc.
  param([string]$OutgoingPath, [datetime]$SinceUtc, [string[]]$SkipPatterns)
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($f in @(Get-ChildItem -LiteralPath $OutgoingPath -File -Recurse -ErrorAction SilentlyContinue)) {
    if ($f.LastWriteTimeUtc -lt $SinceUtc) { continue }
    if (Test-SkipName -Name $f.Name -Patterns $SkipPatterns) { continue }
    $out.Add($f)
  }
  $out
}

# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------

$script:Token = $null
$script:TokenExpiresUtc = [datetime]::MinValue
$script:Cfg = $null

function Get-GraphToken {
  if ($script:Token -and $script:TokenExpiresUtc -gt (Get-Date).ToUniversalTime().AddMinutes(5)) { return $script:Token }
  $secret = [Environment]::GetEnvironmentVariable($script:Cfg.clientSecretEnv)
  if (-not $secret) { throw "Client secret not found: set the environment variable named by clientSecretEnv ($($script:Cfg.clientSecretEnv)) for the account running this script." }
  $body = @{
    client_id     = $script:Cfg.clientId
    client_secret = $secret
    scope         = 'https://graph.microsoft.com/.default'
    grant_type    = 'client_credentials'
  }
  $r = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$($script:Cfg.tenantId)/oauth2/v2.0/token" -Body $body -ContentType 'application/x-www-form-urlencoded'
  $script:Token = $r.access_token
  $script:TokenExpiresUtc = (Get-Date).ToUniversalTime().AddSeconds([int]$r.expires_in)
  $script:Token
}

function Invoke-Graph {
  # One Graph call with throttling and transient-failure retries.
  param(
    [string]$Method = 'GET',
    [Parameter(Mandatory)][string]$Path,     # "/sites/..." or a full URL (nextLink)
    $Body = $null,
    [string]$InFile = $null,
    [string]$ContentType = 'application/json',
    [int]$MaxAttempts = 6
  )
  $uri = if ($Path.StartsWith('http')) { $Path } else { $script:GraphBase + $Path }
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      $headers = @{ Authorization = "Bearer $(Get-GraphToken)" }
      $req = @{ Method = $Method; Uri = $uri; Headers = $headers }
      if ($InFile) { $req.InFile = $InFile; $req.ContentType = 'application/octet-stream' }
      elseif ($null -ne $Body) { $req.Body = ($Body | ConvertTo-Json -Depth 10 -Compress); $req.ContentType = $ContentType }
      return Invoke-RestMethod @req
    } catch {
      $status = 0
      $retryAfter = 0
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      try { $retryAfter = [int]($_.Exception.Response.Headers.GetValues('Retry-After') | Select-Object -First 1) } catch {}
      $transient = $status -in 429, 500, 502, 503, 504
      if (-not $transient -or $attempt -ge $MaxAttempts) { throw }
      $delay = if ($retryAfter -gt 0) { $retryAfter } else { [math]::Min(60, [math]::Pow(2, $attempt)) }
      Write-Verbose "Graph $status on $Method $Path; retrying in ${delay}s (attempt $attempt/$MaxAttempts)"
      Start-Sleep -Seconds $delay
    }
  }
}

function Get-GraphPages {
  # Follow @odata.nextLink; returns all .value items.
  param([Parameter(Mandatory)][string]$Path)
  $items = New-Object System.Collections.Generic.List[object]
  $url = $Path
  while ($url) {
    $page = Invoke-Graph -Path $url
    if ($page.PSObject.Properties['value']) { foreach ($v in $page.value) { $items.Add($v) } }
    $url = if ($page.PSObject.Properties['@odata.nextLink']) { $page.'@odata.nextLink' } else { $null }
  }
  $items
}

function Resolve-DriveId {
  # siteUrl → site id → the document library's drive id.
  $u = [uri]$script:Cfg.siteUrl
  $site = Invoke-Graph -Path "/sites/$($u.Host):$($u.AbsolutePath)"
  $drives = Get-GraphPages -Path "/sites/$($site.id)/drives?`$select=id,name"
  $match = $drives | Where-Object { $_.name -eq $script:Cfg.docLibrary } | Select-Object -First 1
  if (-not $match) { throw "No document library named '$($script:Cfg.docLibrary)' on $($script:Cfg.siteUrl). Libraries: $(($drives | ForEach-Object name) -join ', ')" }
  $match.id
}

$script:ListingCache = @{}
function Get-FolderListing {
  # name(lower) → item, for every child of a folder. Cached per run.
  param([string]$DriveId, [string]$FolderId)
  $key = "$DriveId/$FolderId"
  if ($script:ListingCache.ContainsKey($key)) { return $script:ListingCache[$key] }
  $map = @{}
  $base = if ($FolderId -eq 'root') { "/drives/$DriveId/root/children" } else { "/drives/$DriveId/items/$FolderId/children" }
  $kids = Get-GraphPages -Path "$base?`$select=id,name,size,file,folder,fileSystemInfo,lastModifiedDateTime&`$top=200"
  foreach ($k in $kids) { $map[$k.name.ToLowerInvariant()] = $k }
  $script:ListingCache[$key] = $map
  $map
}

function Add-ToListing {
  param([string]$DriveId, [string]$FolderId, $Item)
  $key = "$DriveId/$FolderId"
  if ($script:ListingCache.ContainsKey($key)) { $script:ListingCache[$key][$Item.name.ToLowerInvariant()] = $Item }
}

function Get-OrCreateChildFolder {
  # Child folder by exact name (case-insensitive); created in -Commit mode.
  # In dry run a missing folder returns a placeholder id so the walk can
  # continue and report would-copy for the files beneath it.
  param([string]$DriveId, [string]$ParentId, [string]$Name, [switch]$DoCommit)
  $listing = Get-FolderListing -DriveId $DriveId -FolderId $ParentId
  $hit = $listing[$Name.ToLowerInvariant()]
  if ($hit -and $hit.PSObject.Properties['folder']) { return $hit }
  if ($hit) { throw "'$Name' exists in SharePoint as a file, not a folder" }
  if (-not $DoCommit) {
    $ph = [pscustomobject]@{ id = "dryrun:$ParentId/$Name"; name = $Name; folder = @{}; placeholder = $true }
    $script:ListingCache["$DriveId/$($ph.id)"] = @{}
    Add-ToListing -DriveId $DriveId -FolderId $ParentId -Item $ph
    return $ph
  }
  $created = Invoke-Graph -Method Post -Path "/drives/$DriveId/items/$ParentId/children" -Body @{
    name = $Name; folder = @{}; '@microsoft.graph.conflictBehavior' = 'fail'
  }
  $script:ListingCache["$DriveId/$($created.id)"] = @{}
  Add-ToListing -DriveId $DriveId -FolderId $ParentId -Item $created
  $created
}

function Send-FileToSharePoint {
  # Upload one file into $ParentId as $Name. Small files: simple PUT then a
  # PATCH for timestamps. Large files: upload session carrying the timestamps
  # in its item description, streamed in 10 MiB chunks.
  param([string]$DriveId, [string]$ParentId, [string]$Name, [System.IO.FileInfo]$File, [bool]$PreserveTimestamps)
  $fsi = @{
    createdDateTime      = $File.CreationTimeUtc.ToString('o')
    lastModifiedDateTime = $File.LastWriteTimeUtc.ToString('o')
  }
  $enc = [uri]::EscapeDataString($Name)
  if ($File.Length -le $script:SmallFileBytes) {
    $item = Invoke-Graph -Method Put -Path "/drives/$DriveId/items/${ParentId}:/${enc}:/content?@microsoft.graph.conflictBehavior=replace" -InFile $File.FullName
    if ($PreserveTimestamps) {
      $item = Invoke-Graph -Method Patch -Path "/drives/$DriveId/items/$($item.id)" -Body @{ fileSystemInfo = $fsi }
    }
    return $item
  }
  $itemDesc = @{ '@microsoft.graph.conflictBehavior' = 'replace'; name = $Name }
  if ($PreserveTimestamps) { $itemDesc.fileSystemInfo = $fsi }
  $session = Invoke-Graph -Method Post -Path "/drives/$DriveId/items/${ParentId}:/${enc}:/createUploadSession" -Body @{ item = $itemDesc }
  $stream = [System.IO.File]::OpenRead($File.FullName)
  try {
    $total = $File.Length
    $offset = [long]0
    $buffer = New-Object byte[] $script:ChunkBytes
    $result = $null
    while ($offset -lt $total) {
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { break }
      [byte[]]$chunk = if ($read -eq $buffer.Length) { $buffer } else { $t = New-Object byte[] $read; [Array]::Copy($buffer, $t, $read); $t }
      $end = $offset + $read - 1
      $attempt = 0
      while ($true) {
        $attempt++
        try {
          $result = Invoke-WebRequest -Method Put -Uri $session.uploadUrl -Body $chunk -ContentType 'application/octet-stream' `
            -Headers @{ 'Content-Range' = "bytes $offset-$end/$total" } -SkipHttpErrorCheck
          if ($result.StatusCode -in 200, 201, 202) { break }
          if ($result.StatusCode -in 429, 500, 502, 503, 504 -and $attempt -lt 6) { Start-Sleep -Seconds ([math]::Min(60, [math]::Pow(2, $attempt))); continue }
          throw "Upload session chunk failed with HTTP $($result.StatusCode): $($result.Content)"
        } catch {
          if ($attempt -ge 6) { throw }
          Start-Sleep -Seconds ([math]::Min(60, [math]::Pow(2, $attempt)))
        }
      }
      $offset += $read
    }
    if ($result -and $result.Content) { return ($result.Content | ConvertFrom-Json) }
    return $null
  } finally {
    $stream.Dispose()
  }
}

# ---------------------------------------------------------------------------
# State, ledger, report
# ---------------------------------------------------------------------------

function Read-State {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) }
  $null
}

function Write-State {
  param([string]$Path, $State)
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  ($State | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Write-Ledger {
  param([string]$Path, [string]$RunId, [string]$ProjectNumber, [string]$Action, [string]$Source, [string]$Target, [long]$Bytes, [string]$Detail = '')
  $row = [pscustomobject]@{
    RunId = $RunId; Timestamp = (Get-Date).ToUniversalTime().ToString('o'); Project = $ProjectNumber
    Action = $Action; Source = $Source; Target = $Target; Bytes = $Bytes; Detail = $Detail
  }
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $row | Export-Csv -LiteralPath $Path -Append -NoTypeInformation -Encoding UTF8
  $row
}

function Format-Bytes {
  param([long]$B)
  if ($B -ge 1GB) { return ('{0:N2} GB' -f ($B / 1GB)) }
  if ($B -ge 1MB) { return ('{0:N1} MB' -f ($B / 1MB)) }
  if ($B -ge 1KB) { return ('{0:N0} KB' -f ($B / 1KB)) }
  "$B B"
}

function New-RunReport {
  param([string]$RunId, [bool]$DidCommit, [datetime]$SinceUtc, [object[]]$Rows, [object[]]$Projects, [string]$OutPath)
  $counts = @{}
  foreach ($r in $Rows) { $counts[$r.Action] = 1 + ($counts[$r.Action] ?? 0) }
  $bytes = ($Rows | Where-Object { $_.Action -in 'copied', 'replaced', 'would-copy', 'would-replace' } | Measure-Object -Property Bytes -Sum).Sum ?? 0
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("# N: drive → SharePoint Outgoing sync, run $RunId")
  [void]$sb.AppendLine()
  [void]$sb.AppendLine("Mode: $(if ($DidCommit) { 'COMMIT' } else { 'DRY RUN (nothing written)' })  ")
  [void]$sb.AppendLine("Window: files written since $($SinceUtc.ToString('u'))  ")
  [void]$sb.AppendLine("Projects scanned: $($Projects.Count)  ")
  [void]$sb.AppendLine("Bytes $(if ($DidCommit) { 'uploaded' } else { 'to upload' }): $(Format-Bytes $bytes)")
  [void]$sb.AppendLine()
  [void]$sb.AppendLine('| Action | Count |'); [void]$sb.AppendLine('|---|---|')
  foreach ($k in ($counts.Keys | Sort-Object)) { [void]$sb.AppendLine("| $k | $($counts[$k]) |") }
  $attention = @($Rows | Where-Object { $_.Action -in 'no-project-folder', 'no-outgoing-folder', 'conflict-sharepoint-newer', 'invalid-name', 'skip-too-large', 'error' })
  if ($attention.Count -gt 0) {
    [void]$sb.AppendLine(); [void]$sb.AppendLine('## Needs a person')
    [void]$sb.AppendLine(); [void]$sb.AppendLine('| Project | Action | Source | Detail |'); [void]$sb.AppendLine('|---|---|---|---|')
    foreach ($a in $attention) { [void]$sb.AppendLine("| $($a.Project) | $($a.Action) | $($a.Source) | $($a.Detail) |") }
  }
  $moved = @($Rows | Where-Object { $_.Action -in 'copied', 'replaced', 'would-copy', 'would-replace' })
  if ($moved.Count -gt 0) {
    [void]$sb.AppendLine(); [void]$sb.AppendLine("## $(if ($DidCommit) { 'Uploaded' } else { 'Would upload' })")
    [void]$sb.AppendLine(); [void]$sb.AppendLine('| Project | Action | Source | Size |'); [void]$sb.AppendLine('|---|---|---|---|')
    foreach ($m in $moved) { [void]$sb.AppendLine("| $($m.Project) | $($m.Action) | $($m.Source) | $(Format-Bytes $m.Bytes) |") }
  }
  $dir = Split-Path -Parent $OutPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $sb.ToString() | Set-Content -LiteralPath $OutPath -Encoding UTF8
  $sb.ToString()
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Invoke-Sync {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Config not found: $ConfigPath (copy config.example.json to config.json and fill it in)" }
  $script:Cfg = Merge-Config -Defaults (Get-DefaultConfig) -Loaded (Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json)
  $cfg = $script:Cfg
  foreach ($req in 'tenantId', 'clientId', 'siteUrl') { if (-not $cfg[$req]) { throw "config.$req is required" } }
  if (-not $cfg.sources -or $cfg.sources.Count -eq 0) { throw 'config.sources must list at least one drive root' }

  $runId = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
  $nowUtc = (Get-Date).ToUniversalTime()
  $statePath = Join-Path $cfg.stateDir 'state.json'
  $ledgerPath = Join-Path $cfg.stateDir 'ledger.csv'
  $reportPath = Join-Path (Join-Path $cfg.stateDir 'reports') "$runId.md"
  $state = if ($NoState) { $null } else { Read-State -Path $statePath }
  $lastSuccess = [datetime]::MinValue
  if ($state -and $state.PSObject.Properties['lastSuccessUtc'] -and $state.lastSuccessUtc) { $lastSuccess = ([datetime]$state.lastSuccessUtc).ToUniversalTime() }
  $sinceUtc = Get-SinceUtc -NowUtc $nowUtc -SinceDaysOverride $SinceDays -ConfigDays ([int]$cfg.sinceDays) -OverlapHours ([int]$cfg.overlapHours) -LastSuccessUtc $lastSuccess
  $cap = if ($MaxFiles -gt 0) { $MaxFiles } else { [int]$cfg.maxFilesPerRun }
  $doCommit = [bool]$Commit

  Write-Host "Run $runId  mode=$(if ($doCommit) { 'COMMIT' } else { 'DRY RUN' })  since=$($sinceUtc.ToString('u'))  region=$($cfg.region)"

  $projects = @(Get-SourceProjects -Roots $cfg.sources -ProjectPattern $cfg.projectFolderPattern -YearPattern $cfg.yearFolderPattern -OutgoingMatch $cfg.outgoingMatch -OnlyProjects $Project)
  Write-Host "Found $($projects.Count) project folder(s) on the drive"

  # Only touch Graph when there is something to check.
  $work = New-Object System.Collections.Generic.List[object]
  foreach ($p in $projects) {
    if (-not $p.OutgoingPath) { continue }
    $files = @(Get-CandidateFiles -OutgoingPath $p.OutgoingPath -SinceUtc $sinceUtc -SkipPatterns $cfg.skipPatterns)
    if ($files.Count -gt 0) { $work.Add([pscustomobject]@{ Project = $p; Files = $files }) }
  }
  Write-Host "$($work.Count) project(s) have files in the window"

  $rows = New-Object System.Collections.Generic.List[object]
  $errors = 0
  $uploads = 0
  if ($work.Count -gt 0) {
    $driveId = Resolve-DriveId
    $rootListing = Get-FolderListing -DriveId $driveId -FolderId 'root'
    $rootNames = @($rootListing.Values | Where-Object { $_.PSObject.Properties['folder'] } | ForEach-Object name)

    foreach ($w in $work) {
      $p = $w.Project
      $override = $cfg.projectOverrides[$p.Number]
      $spName = if ($override) { $override } else { Find-ProjectFolderName -Names $rootNames -ProjectNumber $p.Number }
      if (-not $spName -or -not $rootListing.ContainsKey($spName.ToLowerInvariant())) {
        $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action 'no-project-folder' -Source $p.OutgoingPath -Target '' -Bytes 0 -Detail "$($w.Files.Count) file(s) waiting; no folder starting with $($p.Number) in '$($cfg.docLibrary)'"))
        continue
      }
      $spProject = $rootListing[$spName.ToLowerInvariant()]
      $projListing = Get-FolderListing -DriveId $driveId -FolderId $spProject.id
      $outName = Select-OutgoingName -Names @($projListing.Values | Where-Object { $_.PSObject.Properties['folder'] } | ForEach-Object name) -Contains $cfg.outgoingMatch
      $spOutgoing = $null
      if ($outName) {
        $spOutgoing = $projListing[$outName.ToLowerInvariant()]
      } elseif ([bool]$cfg.createOutgoingIfMissing) {
        $spOutgoing = Get-OrCreateChildFolder -DriveId $driveId -ParentId $spProject.id -Name 'Outgoing' -DoCommit:$doCommit
        $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action ($doCommit ? 'created-outgoing' : 'would-create-outgoing') -Source $p.OutgoingPath -Target "$spName/Outgoing" -Bytes 0))
      } else {
        $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action 'no-outgoing-folder' -Source $p.OutgoingPath -Target $spName -Bytes 0 -Detail "$($w.Files.Count) file(s) waiting"))
        continue
      }

      foreach ($f in $w.Files) {
        if ($uploads -ge $cap) {
          $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action 'deferred-cap' -Source $f.FullName -Target '' -Bytes $f.Length -Detail "maxFilesPerRun=$cap reached; next run picks it up"))
          continue
        }
        try {
          $segments = @(Get-RelativeSegments -Root $p.OutgoingPath -FullPath $f.DirectoryName)
          $bad = $null
          foreach ($s in ($segments + $f.Name)) { $bad = Test-SharePointName -Name $s; if ($bad) { $bad = "'$s': $bad"; break } }
          if ($bad) {
            $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action 'invalid-name' -Source $f.FullName -Target '' -Bytes $f.Length -Detail $bad))
            continue
          }
          # Walk/create the folder chain under Outgoing.
          $parent = $spOutgoing
          foreach ($s in $segments) { $parent = Get-OrCreateChildFolder -DriveId $driveId -ParentId $parent.id -Name $s -DoCommit:$doCommit }
          $targetRel = (@($spName, $outName ?? 'Outgoing') + $segments + $f.Name) -join '/'
          $listing = Get-FolderListing -DriveId $driveId -FolderId $parent.id
          $existing = $listing[$f.Name.ToLowerInvariant()]
          if ($existing -and $existing.PSObject.Properties['folder']) {
            $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action 'error' -Source $f.FullName -Target $targetRel -Bytes $f.Length -Detail 'a folder with this name exists in SharePoint'))
            $errors++; continue
          }
          $decision = Get-SyncDecision -SourceLength $f.Length -SourceModifiedUtc $f.LastWriteTimeUtc -Target $existing -MaxBytes ([long]$cfg.maxFileBytes)
          switch ($decision) {
            'skip-exists' { $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action 'skip-exists' -Source $f.FullName -Target $targetRel -Bytes $f.Length)) }
            'skip-too-large' { $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action 'skip-too-large' -Source $f.FullName -Target $targetRel -Bytes $f.Length -Detail "over maxFileBytes ($($cfg.maxFileBytes))")) }
            'conflict-sharepoint-newer' { $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action 'conflict-sharepoint-newer' -Source $f.FullName -Target $targetRel -Bytes $f.Length -Detail "SharePoint copy ($($existing.size) B) modified after the drive copy; not overwritten")) }
            default {
              $verb = if ($decision -eq 'replace') { 'replace' } else { 'copy' }
              if (-not $doCommit) {
                $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action "would-$verb" -Source $f.FullName -Target $targetRel -Bytes $f.Length))
                $uploads++
              } else {
                $item = Send-FileToSharePoint -DriveId $driveId -ParentId $parent.id -Name $f.Name -File $f -PreserveTimestamps ([bool]$cfg.preserveTimestamps)
                if ($item) { Add-ToListing -DriveId $driveId -FolderId $parent.id -Item $item }
                $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action ($verb -eq 'replace' ? 'replaced' : 'copied') -Source $f.FullName -Target $targetRel -Bytes $f.Length -Detail ($item.webUrl ?? '')))
                $uploads++
              }
            }
          }
        } catch {
          $errors++
          $rows.Add((Write-Ledger -Path $ledgerPath -RunId $runId -ProjectNumber $p.Number -Action 'error' -Source $f.FullName -Target '' -Bytes $f.Length -Detail ($_.Exception.Message -replace '[\r\n]+', ' ')))
          Write-Warning "$($f.FullName): $($_.Exception.Message)"
        }
      }
    }
  }

  $report = New-RunReport -RunId $runId -DidCommit $doCommit -SinceUtc $sinceUtc -Rows @($rows) -Projects $projects -OutPath $reportPath
  Write-Host $report
  Write-Host "Ledger: $ledgerPath"
  Write-Host "Report: $reportPath"

  if (-not $NoState -and $doCommit -and $errors -eq 0) {
    Write-State -Path $statePath -State @{ lastRunUtc = $nowUtc.ToString('o'); lastSuccessUtc = $nowUtc.ToString('o'); lastRunId = $runId; uploads = $uploads }
  } elseif (-not $NoState) {
    $prev = if ($state) { $state } else { @{} }
    $keep = if ($prev.PSObject -and $prev.PSObject.Properties['lastSuccessUtc']) { $prev.lastSuccessUtc } else { $null }
    Write-State -Path $statePath -State @{ lastRunUtc = $nowUtc.ToString('o'); lastSuccessUtc = $keep; lastRunId = $runId; uploads = $uploads; errors = $errors; dryRun = (-not $doCommit) }
  }
  if ($errors -gt 0) { Write-Warning "$errors error(s); see the ledger"; exit 2 }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-Sync }
