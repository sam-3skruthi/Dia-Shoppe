@echo off
REM Double-click this file to log the Supabase CLI in.
REM It calls the CLI by absolute path, so nothing depends on PATH or spelling.
title Supabase login - Dia Shoppe
echo.
echo   Opening your browser to log in to Supabase...
echo   Approve the request there, then come back to this window.
echo.
"%APPDATA%\npm\supabase.cmd" login
echo.
if %ERRORLEVEL% EQU 0 (
  echo   ================================================
  echo    LOGGED IN. You can close this window and tell
  echo    Claude "done" - it will deploy the functions.
  echo   ================================================
) else (
  echo   Login did not complete ^(exit code %ERRORLEVEL%^).
  echo   Copy whatever is shown above and send it to Claude.
)
echo.
pause
