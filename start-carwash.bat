@echo off
title CarWash Starter
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-carwash.ps1"
timeout /t 3 /nobreak >nul
exit