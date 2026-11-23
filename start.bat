@echo off
rem Double-click to start RainCheck (PHP API + web app) on free ports and open the browser.
rem Optional: start.bat -WebPort 6000 -ApiPort 9000 -NoBrowser
title RainCheck - Daily Commute
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 pause
