@echo off
REM Double-click this file to log the Supabase CLI in.
title Supabase login - Dia Shoppe
echo.
echo   Opening your browser to log in to Supabase...
echo   Approve the request there, then come back to this window.
echo.
call "%APPDATA%\npm\supabase.cmd" login
echo.
if %ERRORLEVEL% EQU 0 (
  echo   ============================================
  echo    LOGGED IN. Close this and tell Claude done.
  echo   ============================================
) else (
  echo   Login did not complete. Send Claude the text above.
)
echo.
pause
