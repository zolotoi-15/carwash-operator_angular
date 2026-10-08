@echo off
setlocal enabledelayedexpansion
title CarWash System Launcher (Angular)

:: ============================================================
:: Пути проекта (при необходимости поменяйте)
:: ============================================================
set "ROOT=C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular"
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "KKM_SIM=%ROOT%\kkm-simulator"
set "TANK_SIM=%ROOT%\tank-simulator"

:: KKM-мост через PowerShell + COM (AddIn.DrvFR)
set "KKM_BRIDGE_JS=%BACKEND%\kkm-bridge.js"
set "KKM_QUERY_PS=%BACKEND%\kkm-query.ps1"

echo ============================================================
echo   CarWash System Launcher
echo ============================================================
echo.

:: ============================================================
:: 0. Проверка занятости портов
:: ============================================================
echo [0/8] Checking ports...
call :CheckPort 1883 "MQTT TCP"
call :CheckPort 8083 "MQTT WebSocket"
call :CheckPort 3000 "Backend REST API"
call :CheckPort 4200 "Angular Dev Server"
call :CheckPort 5001 "KKM Bridge"
echo.

:: ============================================================
:: 1. MongoDB
:: ============================================================
echo [1/8] Starting MongoDB...
net start MongoDB >nul 2>&1
if errorlevel 1 (
    echo    MongoDB service not found or already running.
) else (
    echo    MongoDB started.
)

call :WaitForPort 27017 "MongoDB" 15
echo.

:: ============================================================
:: 2. Local MQTT Broker (Aedes + мост к WQTT)
:: ============================================================
echo [2/8] Starting Local MQTT Broker...
start "CarWash Local MQTT Broker" cmd /k "cd /d %BACKEND% && node local-mqtt-broker.js"

call :WaitForPort 1883 "Local MQTT TCP" 10
call :WaitForPort 8083 "Local MQTT WS"  10
echo.

:: ============================================================
:: 3. Backend (REST API)
:: ============================================================
echo [3/8] Starting Backend...
start "CarWash Backend" cmd /k "cd /d %BACKEND% && node server.js"

call :WaitForPort 3000 "Backend REST API" 15
echo.

:: ============================================================
:: 4. KKM Bridge (PowerShell + AddIn.DrvFR)
:: ============================================================
echo [4/8] Starting KKM Bridge...

:: Проверка COM-объекта драйвера Штрих-М (запускается в фоне)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $null = New-Object -ComObject 'AddIn.DrvFR'; Write-Host '   COM AddIn.DrvFR — OK' -ForegroundColor Green; exit 0 } catch { Write-Host '   COM AddIn.DrvFR — NOT AVAILABLE: ' + $_.Exception.Message -ForegroundColor Yellow; exit 1 }"
if errorlevel 1 (
    echo    WARNING: драйвер Штрих-М не зарегистрирован. KKM Bridge будет в режиме "driver offline".
)

if exist "%KKM_BRIDGE_JS%" (
    if exist "%KKM_QUERY_PS%" (
        start "CarWash KKM Bridge" cmd /k "cd /d %BACKEND% && set KKM_BRIDGE_PORT=5001&& set SHTRIH_COM_NUMBER=1&& set SHTRIH_BAUD=115200&& node kkm-bridge.js"
        call :WaitForPort 5001 "KKM Bridge" 10
    ) else (
        echo    kkm-query.ps1 not found at %KKM_QUERY_PS%, skipping KKM Bridge.
    )
) else (
    echo    kkm-bridge.js not found at %KKM_BRIDGE_JS%, skipping KKM Bridge.
)
echo.

:: ============================================================
:: 5. Simulators
:: ============================================================
echo [5/8] Starting simulators...

if exist "%KKM_SIM%\kkm-simulator.js" (
    start "CarWash KKM Simulator" cmd /k "cd /d %KKM_SIM% && node kkm-simulator.js"
    timeout /t 1 /nobreak >nul
) else (
    echo    kkm-simulator.js not found, skipping.
)

if exist "%TANK_SIM%\tank-simulator-mqtt.js" (
    start "CarWash Tank Simulator" cmd /k "cd /d %TANK_SIM% && node tank-simulator-mqtt.js"
    timeout /t 1 /nobreak >nul
) else (
    echo    tank-simulator-mqtt.js not found, skipping.
)
echo.

:: ============================================================
:: 6. Detection Server (Python, опционально)
:: ============================================================
echo [6/8] Starting Detection Server...
if exist "%BACKEND%\detection_server.py" (
    where python >nul 2>&1
    if errorlevel 1 (
        echo    Python not found in PATH, skipping detection server.
    ) else (
        start "CarWash Detection" cmd /k "cd /d %BACKEND% && python detection_server.py"
        timeout /t 1 /nobreak >nul
    )
) else (
    echo    detection_server.py not found, skipping.
)
echo.

:: ============================================================
:: 7. Angular Frontend
:: ============================================================
echo [7/8] Starting Angular Frontend...
start "CarWash Frontend" cmd /k "cd /d %FRONTEND% && ng serve --host 0.0.0.0"

call :WaitForPort 4200 "Angular Dev Server" 30
echo.

:: ============================================================
:: 8. Итоговая проверка KKM Bridge
:: ============================================================
echo [8/8] Verifying KKM Bridge...
timeout /t 2 /nobreak >nul
curl -s http://127.0.0.1:5001/api/kkm/status >nul 2>&1
if errorlevel 1 (
    echo    KKM Bridge не отвечает. Проверьте окно "CarWash KKM Bridge".
) else (
    echo    KKM Bridge отвечает: http://127.0.0.1:5001/api/kkm/status
    curl -s http://127.0.0.1:5001/api/kkm/status
    echo.
)
echo.

echo ============================================================
echo   All processes started.
echo.
echo   Local MQTT:  ws://0.0.0.0:8083/mqtt  (mqtt://0.0.0.0:1883)
echo   Backend:     http://0.0.0.0:3000
echo   Frontend:    http://localhost:4200
echo   KKM Bridge:  http://127.0.0.1:5001/api/kkm/status
echo.
echo   Close each terminal window to stop a service.
echo ============================================================
pause
exit /b 0


:: ============================================================
:: Вспомогательные подпрограммы
:: ============================================================

:CheckPort
:: %1 = порт, %2 = описание
netstat -ano | findstr /R /C:":%~1 .*LISTENING" >nul
if not errorlevel 1 (
    echo    WARNING: port %~1 (%~2^) is already in use.
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%~1 .*LISTENING"') do (
        echo             PID %%P — возможно, старый процесс. Закройте его или перезагрузите ПК.
    )
) else (
    echo    port %~1 (%~2^) — free.
)
exit /b 0


:WaitForPort
:: %1 = порт, %2 = описание, %3 = таймаут в секундах
set /a "_tries=%~3"
:WaitLoop
netstat -ano | findstr /R /C:":%~1 .*LISTENING" >nul
if not errorlevel 1 (
    echo    %~2 — ready on port %~1.
    exit /b 0
)
timeout /t 1 /nobreak >nul
set /a "_tries-=1"
if !_tries! gtr 0 goto WaitLoop
echo    WARNING: %~2 did not start on port %~1 within %~3s.
exit /b 1