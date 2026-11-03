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
rem To undo:  reg delete HKCU\Software\Classes\settypms /f
rem           and delete the %LOCALAPPDATA%\SettyPMS folder.
rem ---------------------------------------------------------------------------

echo Setting up the Setty PMS one-click Explorer handler (this user only)...
set "DIR=%LOCALAPPDATA%\SettyPMS"
if not exist "%DIR%" mkdir "%DIR%"

rem Download to a temp name first so a failed download never clobbers a
rem working handler; the ?v= query defeats any cached old copy on the way.
if exist "%DIR%\settypms-open.ps1.new" del "%DIR%\settypms-open.ps1.new"
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri ('https://smartias.github.io/setty-pms/explorer-bridge/settypms-open.ps1?v=' + [DateTime]::UtcNow.Ticks) -OutFile \"$env:LOCALAPPDATA\SettyPMS\settypms-open.ps1.new\""
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
