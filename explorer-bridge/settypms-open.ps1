# Setty PMS one-click Explorer handler.  (handler version 3)
#
# Invoked by settypms: links from the PMS web app (registered by
# SettyPMS-Explorer-Setup.cmd in this folder, current user only).
# Four verbs:
#   settypms:open?folder=SAPX256024.00%20-%20K292%20Roof
#     opens File Explorer at <your synced project root>\<that folder>.
#   settypms:cowork?folder=...
#     opens a Claude Code session IN that folder (a terminal window whose
#     working directory is the project folder), so Claude can read and
#     write the actual project documents, not just chat about them.
#   settypms:ndrive?path=N:%5CSAP%5C2026%5CSAPX266002.00
#     opens File Explorer directly at that N: drive path (NY only). Unlike
#     `open`, this needs no per-device root — N: is the same fixed drive
#     letter for everyone in the office — so it is validated against the
#     known N:\SAP\<year>\... shape instead (see below) rather than joined
#     under a configured folder.
#   settypms:check
#     self-test: shows a dialog with the handler version, the saved root,
#     whether the Claude Code CLI and Windows Terminal were found, and where
#     the run log is. The PMS's My Settings "Test the handler" link and the
#     bridge page use it. If clicking that shows NOTHING, the handler on
#     this computer is old (pre-v3) or not registered: re-run the setup file.
#
# The root is remembered in %LOCALAPPDATA%\SettyPMS\explorer-root.txt.
# First run (or if the saved root disappears) shows a folder picker.
#
# Every run writes %LOCALAPPDATA%\SettyPMS\last-run.log (overwritten each
# time): what link arrived, what it resolved to, and what was launched or
# why not. Any unexpected error is shown in a dialog instead of vanishing —
# the handler runs in a hidden window, so without this a failure looks
# like "nothing happened".
#
# Safety: `open`/`cowork` only ever launch explorer.exe or claude at a
# single folder name under the saved root — path separators are stripped
# from the name and ".." is rejected, so a link cannot escape the root.
# `ndrive` has no root to escape (it is already an absolute path), so it is
# instead validated to START WITH N:\SAP\<4 digits>\ and contain no "..";
# anything else is refused rather than passed to explorer.exe. No text from
# any link is ever placed on a command line — a path is passed only as a
# quoted Start-Process argument or working directory, and the Claude kickoff
# travels as a base64 -EncodedCommand (so quoting can never break it and the
# folder name can never be interpreted as a command) — so a link cannot run
# anything.

param([string]$Uri)
$ErrorActionPreference = 'Stop'
$HandlerVersion = 3

$dir = Join-Path $env:LOCALAPPDATA 'SettyPMS'
$cfg = Join-Path $dir 'explorer-root.txt'
$log = Join-Path $dir 'last-run.log'

$script:LogLines = @()
function Log([string]$Message) {
  $script:LogLines += ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Message)
}
function SaveLog {
  try {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [System.IO.File]::WriteAllLines($log, [string[]]$script:LogLines)
  } catch { }
}
function Say([string]$Text, [string]$Title) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($Text, $Title)
}
# Single-quoted PowerShell literal: the only escaping single quotes need.
function Quote([string]$Text) {
  return "'" + ($Text -replace "'", "''") + "'"
}
# The claude CLI may not be on the PATH this process inherited: the browser
# that launched us may have been started before the CLI was installed (an
# old PATH), and people who only use the desktop app may not have it at all.
# So after Get-Command, probe the native installer's location, npm's global
# bin, and a FRESH PATH read from the registry.
function Find-Claude {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $candidates = @(
    ($env:USERPROFILE + '\.local\bin\claude.exe'),
    ($env:APPDATA + '\npm\claude.cmd')
  )
  foreach ($scope in @('User', 'Machine')) {
    $p = [Environment]::GetEnvironmentVariable('Path', $scope)
    if (-not $p) { continue }
    foreach ($d in $p.Split(';')) {
      $d = $d.Trim().Trim('"').TrimEnd('\')
      if ($d) {
        $candidates += ($d + '\claude.exe')
        $candidates += ($d + '\claude.cmd')
      }
    }
  }
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c -PathType Leaf -ErrorAction SilentlyContinue) { return $c }
  }
  return $null
}
function Find-Wt {
  $wt = Get-Command wt -ErrorAction SilentlyContinue
  if ($wt -and $wt.Source) { return $wt.Source }
  return $null
}
function Read-Root {
  if (Test-Path -LiteralPath $cfg) { return (Get-Content -LiteralPath $cfg -TotalCount 1).Trim() }
  return ''
}

try {
  Log ("handler v" + $HandlerVersion + "  uri=" + $Uri)

  $verb = 'open'
  if ($Uri -match '^settypms:/{0,2}([a-z]+)') { $verb = $Matches[1] }
  Log ("verb=" + $verb)

  if ($verb -eq 'check') {
    $root = Read-Root
    $rootLine = if (-not $root) { '(not chosen yet - your first Open in Explorer click asks for it)' }
                elseif (Test-Path -LiteralPath $root) { $root }
                else { $root + '  (MISSING on this computer - delete ' + $cfg + ' to choose again)' }
    $claude = Find-Claude
    $claudeLine = if ($claude) { $claude } else { 'NOT FOUND - install Claude Code (claude.com/claude-code) for Work in the project folder' }
    $wt = Find-Wt
    $wtLine = if ($wt) { $wt } else { 'not installed (optional - plain PowerShell window is used instead)' }
    Log ("check: root=" + $rootLine + " claude=" + $claudeLine + " wt=" + $wtLine)
    SaveLog
    Say ("The Setty PMS one-click handler is installed and running.`n`n" +
         "Handler version: " + $HandlerVersion + "`n" +
         "Synced project root: " + $rootLine + "`n" +
         "Claude Code CLI: " + $claudeLine + "`n" +
         "Windows Terminal: " + $wtLine + "`n`n" +
         "Each click writes a short log to:`n" + $log) 'Setty PMS - handler check'
    exit
  }

  if ($verb -eq 'ndrive') {
    # No configured root: the path arrives whole and absolute, so it is
    # validated instead of joined. Must start with N:\SAP\<4 digits>\ and
    # carry no "..", or it is refused outright.
    if ($Uri -notmatch 'path=([^&]+)') { Log 'ndrive: no path= in link'; SaveLog; exit }
    $path = [uri]::UnescapeDataString($Matches[1])
    if ($path -notmatch '^N:\\SAP\\\d{4}\\' -or $path -match '\.\.') { Log ('ndrive: refused ' + $path); SaveLog; exit }
    if (Test-Path -LiteralPath $path) {
      Log ('ndrive: opening ' + $path)
      SaveLog
      Start-Process explorer.exe -ArgumentList ('"' + $path + '"')
    } else {
      Log ('ndrive: not found ' + $path)
      SaveLog
      Say ("Could not open`n`n" + $path + "`n`nThe N: drive may not be mapped on this computer, or the folder may not exist.") 'Setty PMS - N Drive'
    }
    exit
  }

  if ($Uri -notmatch 'folder=([^&]+)') { Log 'no folder= in link'; SaveLog; exit }
  $name = [uri]::UnescapeDataString($Matches[1])
  # One path segment only: no separators, no traversal.
  $name = ($name -replace '[\\/]', ' ').Trim()
  if (-not $name -or $name -match '\.\.') { Log ('refused folder name: ' + $name); SaveLog; exit }
  Log ('folder=' + $name)

  $root = Read-Root
  if (-not $root -or -not (Test-Path -LiteralPath $root)) {
    Log ('root missing or invalid (' + $root + ') - asking')
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = 'One-time setup: select the folder that CONTAINS your synced project folders (your OneDrive project library).'
    if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Log 'root picker cancelled'; SaveLog; exit }
    $root = $dlg.SelectedPath
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [System.IO.File]::WriteAllText($cfg, $root)
    Log ('root saved: ' + $root)
  }

  $path = Join-Path $root $name
  Log ('path=' + $path)

  if ($verb -eq 'cowork') {
    # Work-in-the-folder mode. Unlike Explorer (where falling back to the root
    # is harmless), starting an agent session in the wrong directory is not —
    # so a missing folder is a hard stop with an explanation.
    if (-not (Test-Path -LiteralPath $path)) {
      Log 'cowork: folder not synced'
      SaveLog
      Say ("The folder`n`n" + $name + "`n`nisn't synced under`n" + $root + "`n`nSync it in OneDrive (or fix the root by deleting`n" + $cfg + ") and try again.") 'Setty PMS - Work in project folder'
      exit
    }
    $claudeExe = Find-Claude
    if (-not $claudeExe) {
      Log 'cowork: claude CLI not found'
      SaveLog
      Say ("The Claude Code command line ('claude') was not found on this computer.`n`nThe Claude desktop app alone isn't enough for this button. Install Claude Code from claude.com/claude-code (or 'npm install -g @anthropic-ai/claude-code'), sign in once, then click the button again.") 'Setty PMS - Work in project folder'
      exit
    }
    Log ('cowork: claude=' + $claudeExe)
    # A visible terminal in the project folder running Claude Code, opened
    # with a kickoff prompt: orient in the folder, then offer a menu of work
    # rather than starting anything unasked. The prompt LEADS with the project
    # folder name so the session auto-titles after the project (Sara 9/6).
    $kickoff = 'Project: ' + $name + '. This session is for that project and should be titled after it. Orient yourself in this Setty project folder: skim the folder structure a couple of levels deep and note the main document types you see. Then give the user a two line snapshot and ask what they would like to tackle, suggesting for example: generate a document from a Setty template, edit or update an existing document, assemble a transmittal or submittal package, organize or rename files, or summarize a document or drawing set. If the Setty PMS connector tools are available, use them for project context. Do not start any work until the user chooses. End your first reply with a short note under a Good to know heading: this session is saved and can be continued later in the Claude app or by running claude --continue in this folder. Keep this window open while Claude is actively working, but closing it when idle loses nothing. Clicking the PMS button again starts a fresh session rather than reopening this one.'
    # The inner command travels as -EncodedCommand (base64 of UTF-16): no
    # quoting rules of wt / powershell.exe can mangle it, a space in the
    # claude.exe path (user names with spaces) is harmless, and nothing in
    # the folder name is ever parsed as a command.
    $inner = '& ' + (Quote $claudeExe) + ' ' + (Quote $kickoff)
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($inner))
    $psArgs = '-NoExit -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + $encoded
    # Prefer Windows Terminal when present (nicer window, same session).
    # wt needs ONE pre-joined argument string: Start-Process array args break
    # its -d quoting (verified 9/6). wt splits panes on ';' ANYWHERE in its
    # command line — the base64 command cannot contain one, but a path can,
    # and that case falls back to the plain PowerShell host, which has no
    # such splitting. So does a wt that is installed but refuses to launch
    # (e.g. its "app execution alias" switched off in Windows Settings):
    # Get-Command still finds the stub, Start-Process then throws.
    $launched = $false
    $wt = Find-Wt
    if ($wt -and $path -notmatch ';') {
      try {
        Start-Process wt -ArgumentList ('-d "' + $path + '" powershell ' + $psArgs)
        $launched = $true
        Log 'cowork: launched via Windows Terminal'
      } catch {
        Log ('cowork: Windows Terminal failed (' + $_.Exception.Message + ') - using PowerShell window')
      }
    }
    if (-not $launched) {
      Start-Process powershell -WorkingDirectory $path -ArgumentList $psArgs
      Log 'cowork: launched via PowerShell window'
    }
    SaveLog
    exit
  }

  if (Test-Path -LiteralPath $path) {
    Log ('open: ' + $path)
    SaveLog
    Start-Process explorer.exe -ArgumentList ('"' + $path + '"')
  } else {
    Log ('open: folder not synced, opening root ' + $root)
    SaveLog
    Start-Process explorer.exe -ArgumentList ('"' + $root + '"')
    Say ("The folder`n`n" + $name + "`n`nisn't synced under`n" + $root + "`n`nFile Explorer opened at that root instead. Sync the project in OneDrive, or if the root is wrong, delete`n" + $cfg + "`nand the next click asks again.") 'Setty PMS - Open in Explorer'
  }
} catch {
  Log ('ERROR: ' + $_.Exception.Message)
  SaveLog
  try {
    Say ("The Setty PMS one-click handler hit an error:`n`n" + $_.Exception.Message + "`n`nDetails were written to:`n" + $log + "`n`nRe-running the setup file (PMS - My Projects - My Settings) refreshes the handler; if it keeps failing, send that log file to whoever supports the PMS.") 'Setty PMS - handler error'
  } catch { }
}
