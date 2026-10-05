@echo off
title CarWash System Launcher (Angular)
echo Starting all components...

:: Запуск MongoDB (если служба не запущена)
net start MongoDB 2>nul
if errorlevel 1 (
    echo MongoDB service not found or already running.
)

:: Запуск локального MQTT-брокера (Aedes + мост к WQTT)
echo Starting Local MQTT Broker (ws://0.0.0.0:8083/mqtt, mqtt://0.0.0.0:1883)...
start "CarWash Local MQTT Broker" cmd /k "cd /d C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\backend && node local-mqtt-broker.js"
:: Даём брокеру подняться (2 секунды)
timeout /t 2 /nobreak >nul

echo Starting Backend (auto-starts MQTT)...
start "CarWash Backend" cmd /k "cd /d C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\backend && node server.js"
:: Ждём, пока бэкенд создаст mqtt-config.json (3 секунды достаточно)
timeout /t 3 /nobreak >nul

:: Запуск KkmProxy (реальный ККМ) – приоритет отдаём скомпилированному EXE
set KKMPROXY_EXE=C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\KkmProxy\KkmProxy\bin\Debug\net8.0\KkmProxy.exe
if exist "%KKMPROXY_EXE%" (
    echo Starting KkmProxy.exe...
    start "CarWash KkmProxy" cmd /k "cd /d C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\KkmProxy\KkmProxy\bin\Debug\net8.0 && KkmProxy.exe --urls="http://0.0.0.0:5001""
) else (
    echo KkmProxy.exe not found, falling back to dotnet run...
    start "CarWash KkmProxy" cmd /k "cd /d C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\KkmProxy && dotnet run --urls="http://0.0.0.0:5001""
)
timeout /t 1 /nobreak >nul

:: Запуск симуляторов (они прочитают mqtt-config.json)
::echo Starting Multi-Simulator...
::start "CarWash Multi-Simulator" cmd /k "cd /d C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\simulator && node simulator.js"
::timeout /t 1 /nobreak >nul

echo Starting KKM Simulator...
start "CarWash KKM Simulator" cmd /k "cd /d C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\kkm-simulator && node kkm-simulator.js"
timeout /t 1 /nobreak >nul

echo Starting Tank Simulator...
start "CarWash Tank Simulator" cmd /k "cd /d C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\tank-simulator && node tank-simulator-mqtt.js"
timeout /t 1 /nobreak >nul

:: Запуск бэкенда распознавания (если файл существует и Python установлен)
if exist "C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\backend\detection_server.py" (
    echo Starting Detection Server...
    start "CarWash Detection" cmd /k "cd /d C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\backend && python detection_server.py"
    timeout /t 1 /nobreak >nul
) else (
    echo detection_server.py not found, skipping...
)

start "CarWash Frontend" cmd /k "cd /d C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular\frontend && ng serve --host 0.0.0.0"

echo All processes started. Close each terminal window to stop.
pause