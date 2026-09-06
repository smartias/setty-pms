# Setty PMS one-click Explorer handler.
#
# Invoked by settypms: links from the PMS web app (registered by
# SettyPMS-Explorer-Setup.cmd in this folder, current user only).
# Two verbs:
#   settypms:open?folder=SAPX256024.00%20-%20K292%20Roof
#     opens File Explorer at <your synced project root>\<that folder>.
#   settypms:cowork?folder=...
#     opens a Claude Code session IN that folder (a terminal window whose
#     working directory is the project folder), so Claude can read and
#     write the actual project documents, not just chat about them.
#
# The root is remembered in %LOCALAPPDATA%\SettyPMS\explorer-root.txt.
# First run (or if the saved root disappears) shows a folder picker.
#
# Safety: only ever launches explorer.exe or claude at a single folder
# name under the saved root. Path separators are stripped from the name
# and ".." is rejected, so a link cannot escape the root. No text from
# the link is ever placed on a command line — the folder is passed only
# as a working directory / quoted path — so a link cannot run anything.

param([string]$Uri)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:LOCALAPPDATA 'SettyPMS'
$cfg = Join-Path $dir 'explorer-root.txt'

$verb = 'open'
if ($Uri -match '^settypms:/{0,2}([a-z]+)') { $verb = $Matches[1] }

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

if ($verb -eq 'cowork') {
  # Work-in-the-folder mode. Unlike Explorer (where falling back to the root
  # is harmless), starting an agent session in the wrong directory is not —
  # so a missing folder is a hard stop with an explanation.
  Add-Type -AssemblyName System.Windows.Forms
  if (-not (Test-Path $path)) {
    [void][System.Windows.Forms.MessageBox]::Show(
      "The folder`n`n$name`n`nisn't synced under`n$root`n`nSync it in OneDrive (or fix the root by deleting`n$cfg) and try again.",
      'Setty PMS - Work in project folder')
    exit
  }
  # The claude CLI may not be on PATH for people who only use the desktop
  # app, so probe the native installer's location too before giving up.
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  $claudeExe = if ($cmd) { $cmd.Source }
    elseif (Test-Path "$env:USERPROFILE\.local\bin\claude.exe") { "$env:USERPROFILE\.local\bin\claude.exe" }
    else { $null }
  if (-not $claudeExe) {
    [void][System.Windows.Forms.MessageBox]::Show(
      "The Claude Code command line ('claude') was not found on this computer.`n`nThe Claude desktop app alone isn't enough for this button. Install Claude Code from claude.com/claude-code (or 'npm install -g @anthropic-ai/claude-code'), sign in once, then click the button again.",
      'Setty PMS - Work in project folder')
    exit
  }
  # A visible terminal in the project folder running Claude Code. Plain
  # session, no arguments: the person says what they need once it opens.
  Start-Process powershell -WorkingDirectory $path -ArgumentList '-NoExit','-NoProfile','-Command', ('& "' + $claudeExe + '"')
  exit
}

if (Test-Path $path) { Start-Process explorer.exe -ArgumentList ('"' + $path + '"') }
else { Start-Process explorer.exe -ArgumentList ('"' + $root + '"') }
