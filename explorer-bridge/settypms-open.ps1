# Setty PMS one-click Explorer handler.
#
# Invoked by settypms: links from the PMS web app (registered by
# SettyPMS-Explorer-Setup.cmd in this folder, current user only).
# Given a link like  settypms:open?folder=SAPX256024.00%20-%20K292%20Roof
# it opens File Explorer at <your synced project root>\<that folder>.
#
# The root is remembered in %LOCALAPPDATA%\SettyPMS\explorer-root.txt.
# First run (or if the saved root disappears) shows a folder picker.
#
# Safety: only ever opens explorer.exe at a single folder name under the
# saved root. Path separators are stripped from the name and ".." is
# rejected, so a link cannot escape the root or run anything.

param([string]$Uri)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:LOCALAPPDATA 'SettyPMS'
$cfg = Join-Path $dir 'explorer-root.txt'

if ($Uri -notmatch 'folder=([^&]+)') { exit }
$name = [uri]::UnescapeDataString($Matches[1])
# One path segment only: no separators, no traversal.
$name = ($name -replace '[\\/]', ' ').Trim()
if (-not $name -or $name -match '\.\.') { exit }

$root = ''
if (Test-Path $cfg) { $root = (Get-Content $cfg -TotalCount 1).Trim() }
if (-not $root -or -not (Test-Path $root)) {
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = 'One-time setup: select the folder that CONTAINS your synced project folders (your OneDrive project library).'
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit }
  $root = $dlg.SelectedPath
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  [System.IO.File]::WriteAllText($cfg, $root)
}

$path = Join-Path $root $name
if (Test-Path $path) { Start-Process explorer.exe -ArgumentList ('"' + $path + '"') }
else { Start-Process explorer.exe -ArgumentList ('"' + $root + '"') }
