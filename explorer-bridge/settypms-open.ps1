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
  # A visible terminal in the project folder running Claude Code, opened
  # with a kickoff prompt: orient in the folder, then offer a menu of work
  # rather than starting anything unasked. The prompt LEADS with the project
  # folder name so the session auto-titles after the project (Sara 9/6).
  # That name comes from the link, so single quotes in it are doubled before
  # it enters the single-quoted argument below; everything else in the
  # prompt is hardcoded and deliberately apostrophe-free.
  $safeName = $name -replace "'", "''"
  $kickoff = 'Project: ' + $safeName + '. This session is for that project and should be titled after it. Orient yourself in this Setty project folder: skim the folder structure a couple of levels deep and note the main document types you see. Then give the user a two line snapshot and ask what they would like to tackle, suggesting for example: generate a document from a Setty template, edit or update an existing document, assemble a transmittal or submittal package, organize or rename files, or summarize a document or drawing set. If the Setty PMS connector tools are available, use them for project context. Do not start any work until the user chooses. End your first reply with a short note under a Good to know heading: this session is saved and can be continued later in the Claude app or by running claude --continue in this folder; keep this window open while Claude is actively working, but closing it when idle loses nothing; clicking the PMS button again starts a fresh session rather than reopening this one.'
  $inner = '& "' + $claudeExe + '" ''' + $kickoff + ''''
  # Prefer Windows Terminal when present (nicer window, same session).
  # wt needs ONE pre-joined argument string: Start-Process array args break
  # its -d quoting (verified 9/6). wt splits panes on ';', so any path
  # containing one falls back to the plain PowerShell host.
  if ((Get-Command wt -ErrorAction SilentlyContinue) -and $path -notmatch ';') {
    Start-Process wt -ArgumentList ('-d "' + $path + '" powershell -NoExit -NoProfile -Command ' + $inner)
  } else {
    Start-Process powershell -WorkingDirectory $path -ArgumentList '-NoExit','-NoProfile','-Command', $inner
  }
  exit
}

if (Test-Path $path) { Start-Process explorer.exe -ArgumentList ('"' + $path + '"') }
else { Start-Process explorer.exe -ArgumentList ('"' + $root + '"') }
