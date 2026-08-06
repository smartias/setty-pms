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
rem      synced OneDrive folder.
rem
rem To undo:  reg delete HKCU\Software\Classes\settypms /f
rem           and delete the %LOCALAPPDATA%\SettyPMS folder.
rem ---------------------------------------------------------------------------

echo Setting up the Setty PMS one-click Explorer handler (this user only)...
set "DIR=%LOCALAPPDATA%\SettyPMS"
if not exist "%DIR%" mkdir "%DIR%"

powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://smartias.github.io/setty-pms/explorer-bridge/settypms-open.ps1' -OutFile \"$env:LOCALAPPDATA\SettyPMS\settypms-open.ps1\""
if not exist "%DIR%\settypms-open.ps1" (
  echo.
  echo Could not download the handler script - check your internet connection
  echo and try again.
  pause
  exit /b 1
)

reg add "HKCU\Software\Classes\settypms" /ve /t REG_SZ /d "URL:Setty PMS" /f >nul
reg add "HKCU\Software\Classes\settypms" /v "URL Protocol" /t REG_SZ /d "" /f >nul
reg add "HKCU\Software\Classes\settypms\shell\open\command" /ve /t REG_SZ /d "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%DIR%\settypms-open.ps1\" \"%%1\"" /f >nul

echo.
echo Done. Back in the PMS: My Projects -^> My Settings -^> tick the one-click box.
echo Your first 📂 click will ask you to pick the folder that contains your
echo synced project folders, and the browser may ask to allow "SettyPMS" links.
pause
