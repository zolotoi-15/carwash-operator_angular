@echo off
title CarWash Stopper
echo Stopping CarWash components...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-carwash.ps1"
echo.
echo All CarWash processes stopped.
pause