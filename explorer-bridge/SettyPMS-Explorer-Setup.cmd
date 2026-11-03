@echo off
setlocal
rem ---------------------------------------------------------------------------
rem Setty PMS one-click Explorer setup (current user only, no admin rights).
rem
rem What this does, in full:
rem   1. Downloads settypms-open.ps1 (readable source in this same folder of
rem      the repo: https://github.com/smartias/setty-pms/tree/main/explorer-bridge)
rem      into %LOCALAPPDATA%\SettyPMS\.
rem   2. Registers the settypms: link type for YOUR user account so that
rem      clicking the PMS's 📂 button opens File Explorer at the project's
rem      synced OneDrive folder, and "Work in the project folder" opens a
rem      Claude Code session there.
rem
rem Safe to re-run any time: it simply replaces the handler with the current
rem version (the handler is cached on this computer and never updates
rem itself, so re-run this whenever the PMS says a newer one is available).
rem
rem Blocked by company security software ("Lockdown ... Windows Command
rem Processor")? Use SettyPMS-Explorer-Setup.reg from this same folder
rem instead (registry entry only, runs nothing) and place settypms-open.ps1
rem by hand - the .reg file explains where.
rem
rem To undo:  reg delete HKCU\Software\Classes\settypms /f
rem           and delete the %LOCALAPPDATA%\SettyPMS folder.
rem ---------------------------------------------------------------------------

echo Setting up the Setty PMS one-click Explorer handler (this user only)...
set "DIR=%LOCALAPPDATA%\SettyPMS"
if not exist "%DIR%" mkdir "%DIR%"

if exist "%DIR%\settypms-open.ps1.new" del "%DIR%\settypms-open.ps1.new"
rem A settypms-open.ps1 sitting NEXT TO this file (IT staged both, or the
rem download is blocked on this computer) is used as-is: no PowerShell, no
rem network. Otherwise download to a temp name first so a failed download
rem never clobbers a working handler; the ?v= query defeats a cached old copy.
if exist "%~dp0settypms-open.ps1" goto :uselocal
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri ('https://smartias.github.io/setty-pms/explorer-bridge/settypms-open.ps1?v=' + [DateTime]::UtcNow.Ticks) -OutFile \"$env:LOCALAPPDATA\SettyPMS\settypms-open.ps1.new\""
goto :verify
:uselocal
echo Using the handler script found next to this file (no download).
copy /y "%~dp0settypms-open.ps1" "%DIR%\settypms-open.ps1.new" >nul
:verify
if not exist "%DIR%\settypms-open.ps1.new" (
  echo.
  echo Could not download the handler script - check your internet connection
  echo and try again. If you are on a company machine and this keeps failing,
  echo ask IT whether PowerShell downloads from smartias.github.io are allowed.
  pause
  exit /b 1
)
findstr /C:"HandlerVersion = " "%DIR%\settypms-open.ps1.new" >nul
if errorlevel 1 (
  echo.
  echo The downloaded file is not the current handler script (an old or
  echo incomplete copy came back). Nothing was changed. Try again in a few
  echo minutes.
  del "%DIR%\settypms-open.ps1.new"
  pause
  exit /b 1
)
move /y "%DIR%\settypms-open.ps1.new" "%DIR%\settypms-open.ps1" >nul

reg add "HKCU\Software\Classes\settypms" /ve /t REG_SZ /d "URL:Setty PMS" /f >nul
reg add "HKCU\Software\Classes\settypms" /v "URL Protocol" /t REG_SZ /d "" /f >nul
reg add "HKCU\Software\Classes\settypms\shell\open\command" /ve /t REG_SZ /d "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%DIR%\settypms-open.ps1\" \"%%1\"" /f >nul

echo.
for /f "tokens=3" %%v in ('findstr /C:"$HandlerVersion = " "%DIR%\settypms-open.ps1"') do echo Installed handler version %%v.
echo.
echo Done. Back in the PMS: My Projects -^> My Settings -^> tick the one-click box,
echo then use "Test the handler" there to confirm it works (a dialog should
echo appear within a few seconds).
echo Your first Open in Explorer click will ask you to pick the folder that
echo contains your synced project folders, and the browser may ask to allow
echo "SettyPMS" links - tick "always allow".
pause
