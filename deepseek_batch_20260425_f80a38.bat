@echo off
title CarWash System Launcher
echo Starting all components...

:: Запуск MongoDB (если служба не запущена)
net start MongoDB 2>nul
if errorlevel 1 (
    echo MongoDB service not found or already running.
)

echo Starting Backend (auto-starts MQTT)...
start "CarWash Backend" cmd /k "cd /d C:\Users\User\carwash-operator\backend && node server.js"
timeout /t 2 /nobreak >nul

start "CarWash Multi-Simulator" cmd /k "cd /d C:\Users\User\carwash-operator\simulator && node simulator.js"
timeout /t 1 /nobreak >nul

start "CarWash KKM Simulator" cmd /k "cd /d C:\Users\User\carwash-operator\kkm-simulator && node kkm-simulator.js"
timeout /t 1 /nobreak >nul

start "CarWash Tank Simulator" cmd /k "cd /d C:\Users\User\carwash-operator\tank-simulator && node tank-simulator-mqtt.js"
timeout /t 1 /nobreak >nul

start "CarWash Frontend" cmd /k "cd /d C:\Users\User\carwash-operator\frontend && ng serve --host 0.0.0.0"

echo All processes started. Close each terminal window to stop.
pause