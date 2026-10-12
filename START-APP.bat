@echo off
REM ---------------------------------------------------------------------------
REM  Smart Examination Section - one-click start for Windows.
REM  Copy the project folder (without node_modules) to any laptop with Node.js 20+
REM  and double-click this file. First run installs packages and loads demo data.
REM ---------------------------------------------------------------------------
title Smart Examination Section
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Download the LTS version from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Installing packages ^(first run only, needs internet^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo  npm install failed. & pause & exit /b 1 )
)

echo  Building and starting the app...
call npm run share
pause
