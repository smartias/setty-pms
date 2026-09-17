<#
  Unit checks for the pure functions in Sync-OutgoingToSharePoint.ps1.
  No network, no config, no Graph. Run on any machine with PowerShell 7:

    pwsh -File .\Test-SyncFunctions.ps1

  Exit code 0 when every check passes, 1 otherwise.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Sync-OutgoingToSharePoint.ps1')

$script:Fails = 0
$script:Passes = 0
function Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) { $script:Passes++; Write-Host "  ok   $Name" }
  else { $script:Fails++; Write-Host "  FAIL $Name $Detail" -ForegroundColor Red }
}

Write-Host 'Test-SkipName'
$skip = (Get-DefaultConfig).skipPatterns
Check 'office lock file skipped'        (Test-SkipName -Name '~$M-101 Plan.docx' -Patterns $skip)
Check 'Thumbs.db skipped'               (Test-SkipName -Name 'Thumbs.db' -Patterns $skip)
Check '.tmp skipped'                    (Test-SkipName -Name 'export.tmp' -Patterns $skip)
Check 'ordinary PDF kept'               (-not (Test-SkipName -Name 'M-101 Rev 2.pdf' -Patterns $skip))

Write-Host 'Test-SharePointName'
Check 'plain name ok'                   ($null -eq (Test-SharePointName -Name '2025-01-21_Addendum #1'))
Check 'percent and hash ok'             ($null -eq (Test-SharePointName -Name '100% CD #2.pdf'))
Check 'colon rejected'                  ($null -ne (Test-SharePointName -Name 'Set: final.pdf'))
Check 'trailing space rejected'         ($null -ne (Test-SharePointName -Name 'draft.pdf '))
Check 'trailing period rejected'        ($null -ne (Test-SharePointName -Name 'draft.'))
Check 'reserved _vti_ rejected'         ($null -ne (Test-SharePointName -Name '_vti_'))

Write-Host 'Get-RelativeSegments'
$segs = Get-RelativeSegments -Root 'N:\SAP\2025\SAPQ256919.01\Outgoing' -FullPath 'N:\SAP\2025\SAPQ256919.01\Outgoing\2025-01-21_Addendum #1\INDIVIDUAL PDF''s'
Check 'two segments'                    ($segs.Count -eq 2) "got $($segs.Count)"
Check 'segment values'                  ($segs[0] -eq '2025-01-21_Addendum #1' -and $segs[1] -eq "INDIVIDUAL PDF's")
Check 'root itself is empty'            ((Get-RelativeSegments -Root 'N:\x\Outgoing' -FullPath 'N:\x\Outgoing').Count -eq 0)
Check 'root with trailing slash'        ((Get-RelativeSegments -Root 'N:\x\Outgoing\' -FullPath 'N:\x\Outgoing\a').Count -eq 1)
$threw = $false; try { Get-RelativeSegments -Root 'N:\a' -FullPath 'N:\b\c' | Out-Null } catch { $threw = $true }
Check 'outside root throws'             $threw

Write-Host 'ConvertTo-GraphPath'
Check 'escapes spaces and hash'         ((ConvertTo-GraphPath -Segments @('2025-01-21_Addendum #1', "PDF's")) -eq "2025-01-21_Addendum%20%231/PDF's")

Write-Host 'Get-SinceUtc'
$now = [datetime]::new(2026, 9, 17, 12, 0, 0, [DateTimeKind]::Utc)
Check 'override wins'                   ((Get-SinceUtc -NowUtc $now -SinceDaysOverride 30 -ConfigDays 7 -OverlapHours 2) -eq $now.AddDays(-30))
Check 'no state → window'               ((Get-SinceUtc -NowUtc $now -SinceDaysOverride 0 -ConfigDays 7 -OverlapHours 2) -eq $now.AddDays(-7))
Check 'recent state → resume - overlap' ((Get-SinceUtc -NowUtc $now -SinceDaysOverride 0 -ConfigDays 7 -OverlapHours 2 -LastSuccessUtc $now.AddHours(-1)) -eq $now.AddHours(-3))
Check 'old state → catches up'          ((Get-SinceUtc -NowUtc $now -SinceDaysOverride 0 -ConfigDays 7 -OverlapHours 2 -LastSuccessUtc $now.AddDays(-12)) -eq $now.AddDays(-12).AddHours(-2))
Check 'ancient state → floored at 4x'   ((Get-SinceUtc -NowUtc $now -SinceDaysOverride 0 -ConfigDays 7 -OverlapHours 2 -LastSuccessUtc $now.AddDays(-90)) -eq $now.AddDays(-28))

Write-Host 'Find-ProjectFolderName / Select-OutgoingName'
$names = @('SAPQ256919.01 - K292 Roof', 'SAPQ256920.00 Some School', 'Templates')
Check 'starts-with match'               ((Find-ProjectFolderName -Names $names -ProjectNumber 'sapq256919.01') -eq 'SAPQ256919.01 - K292 Roof')
Check 'no match is null'                ($null -eq (Find-ProjectFolderName -Names $names -ProjectNumber 'SAPQ999999.00'))
Check 'emoji outgoing found'            ((Select-OutgoingName -Names @('01 Incoming', '99 📤 Outgoing', 'QA-QC')) -eq '99 📤 Outgoing')
Check 'DC style outgoing found'         ((Select-OutgoingName -Names @('99-SIPX262012.00_OUTGOING', '01-SIPX262012.00_INCOMING')) -eq '99-SIPX262012.00_OUTGOING')
Check 'plainest wins'                   ((Select-OutgoingName -Names @('Outgoing - old', 'Outgoing')) -eq 'Outgoing')
Check 'none is null'                    ($null -eq (Select-OutgoingName -Names @('Incoming')))

Write-Host 'Get-SyncDecision'
$src = [datetime]::new(2026, 9, 10, 9, 0, 0, [DateTimeKind]::Utc)
$same = [pscustomobject]@{ size = 1000; fileSystemInfo = [pscustomobject]@{ lastModifiedDateTime = '2026-06-01T00:00:00Z' } }
$diffOld = [pscustomobject]@{ size = 900; fileSystemInfo = [pscustomobject]@{ lastModifiedDateTime = '2026-06-01T00:00:00Z' } }
$diffNew = [pscustomobject]@{ size = 900; fileSystemInfo = [pscustomobject]@{ lastModifiedDateTime = '2026-09-12T00:00:00Z' } }
Check 'missing → copy'                  ((Get-SyncDecision -SourceLength 1000 -SourceModifiedUtc $src -Target $null -MaxBytes 0) -eq 'copy')
Check 'same size → skip-exists'         ((Get-SyncDecision -SourceLength 1000 -SourceModifiedUtc $src -Target $same -MaxBytes 0) -eq 'skip-exists')
Check 'size differs, SP older → replace' ((Get-SyncDecision -SourceLength 1000 -SourceModifiedUtc $src -Target $diffOld -MaxBytes 0) -eq 'replace')
Check 'size differs, SP newer → conflict' ((Get-SyncDecision -SourceLength 1000 -SourceModifiedUtc $src -Target $diffNew -MaxBytes 0) -eq 'conflict-sharepoint-newer')
Check 'over cap → skip-too-large'       ((Get-SyncDecision -SourceLength 5000 -SourceModifiedUtc $src -Target $null -MaxBytes 4000) -eq 'skip-too-large')

Write-Host 'Get-SourceProjects / Get-CandidateFiles (temp tree)'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("ndrive-sync-test-" + [guid]::NewGuid().ToString('N'))
try {
  $sap = Join-Path $tmp 'SAP'
  $p1 = Join-Path $sap '2025\SAPQ256919.01'
  $p2 = Join-Path $sap '2024\SAPQ246001.00 - Named'
  $p3 = Join-Path $sap 'Templates'
  New-Item -ItemType Directory -Path (Join-Path $p1 '99 Outgoing\2025-01-21_Addendum #1') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $p2 'Incoming') -Force | Out-Null
  New-Item -ItemType Directory -Path $p3 -Force | Out-Null
  $newFile = Join-Path $p1 '99 Outgoing\2025-01-21_Addendum #1\M-101.pdf'
  $oldFile = Join-Path $p1 '99 Outgoing\old.pdf'
  $lockFile = Join-Path $p1 '99 Outgoing\~$lock.docx'
  'x' | Set-Content $newFile; 'y' | Set-Content $oldFile; 'z' | Set-Content $lockFile
  (Get-Item $oldFile).LastWriteTimeUtc = (Get-Date).ToUniversalTime().AddDays(-40)

  $cfg = Get-DefaultConfig
  $projects = @(Get-SourceProjects -Roots @($sap) -ProjectPattern $cfg.projectFolderPattern -YearPattern $cfg.yearFolderPattern -OutgoingMatch $cfg.outgoingMatch)
  Check 'two projects found'            ($projects.Count -eq 2) "got $($projects.Count)"
  $a = $projects | Where-Object Number -eq 'SAPQ256919.01'
  $b = $projects | Where-Object Number -eq 'SAPQ246001.00'
  Check 'number extracted from named folder' ($null -ne $b)
  Check 'outgoing resolved'             ($a.OutgoingPath -eq (Join-Path $p1 '99 Outgoing'))
  Check 'no outgoing is null'           ($null -eq $b.OutgoingPath)
  $only = @(Get-SourceProjects -Roots @($sap) -ProjectPattern $cfg.projectFolderPattern -YearPattern $cfg.yearFolderPattern -OutgoingMatch $cfg.outgoingMatch -OnlyProjects @('SAPQ2569'))
  Check '-Project prefix filter'        ($only.Count -eq 1 -and $only[0].Number -eq 'SAPQ256919.01')

  $files = @(Get-CandidateFiles -OutgoingPath $a.OutgoingPath -SinceUtc (Get-Date).ToUniversalTime().AddDays(-7) -SkipPatterns $cfg.skipPatterns)
  Check 'recent file kept, old and lock dropped' ($files.Count -eq 1 -and $files[0].Name -eq 'M-101.pdf') "got $($files.Count)"
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$script:Passes passed, $script:Fails failed"
if ($script:Fails -gt 0) { exit 1 }
