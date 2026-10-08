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
set "KKMPROXY_EXE=%ROOT%\KkmProxy\KkmProxy\bin\Debug\net8.0\KkmProxy.exe"
set "KKMPROXY_DIR=%ROOT%\KkmProxy\KkmProxy\bin\Debug\net8.0"
set "KKMPROXY_SRC=%ROOT%\KkmProxy"

echo ============================================================
echo   CarWash System Launcher
echo ============================================================
echo.

:: ============================================================
:: 0. Проверка занятости портов
:: ============================================================
echo [0/7] Checking ports...
call :CheckPort 1883 "MQTT TCP"
call :CheckPort 8083 "MQTT WebSocket"
call :CheckPort 3000 "Backend REST API"
call :CheckPort 4200 "Angular Dev Server"
call :CheckPort 5001 "KkmProxy"
echo.

:: ============================================================
:: 1. MongoDB
:: ============================================================
echo [1/7] Starting MongoDB...
net start MongoDB >nul 2>&1
if errorlevel 1 (
    echo    MongoDB service not found or already running.
) else (
    echo    MongoDB started.
)

:: Ждём, пока MongoDB реально начнёт отвечать на порту 27017
call :WaitForPort 27017 "MongoDB" 15
echo.

:: ============================================================
:: 2. Local MQTT Broker (Aedes + мост к WQTT)
:: ============================================================
echo [2/7] Starting Local MQTT Broker...
start "CarWash Local MQTT Broker" cmd /k "cd /d %BACKEND% && node local-mqtt-broker.js"

:: Ждём, пока поднимутся порты 1883 и 8083
call :WaitForPort 1883 "Local MQTT TCP" 10
call :WaitForPort 8083 "Local MQTT WS"  10
echo.

:: ============================================================
:: 3. Backend (REST API)
:: ============================================================
echo [3/7] Starting Backend...
start "CarWash Backend" cmd /k "cd /d %BACKEND% && node server.js"

call :WaitForPort 3000 "Backend REST API" 15
echo.

:: ============================================================
:: 4. KkmProxy
:: ============================================================
echo [4/7] Starting KkmProxy...
if exist "%KKMPROXY_EXE%" (
    echo    Using compiled EXE.
    start "CarWash KkmProxy" cmd /k "cd /d %KKMPROXY_DIR% && KkmProxy.exe --urls="http://0.0.0.0:5001""
) else (
    echo    EXE not found, falling back to dotnet run...
    start "CarWash KkmProxy" cmd /k "cd /d %KKMPROXY_SRC% && dotnet run --urls="http://0.0.0.0:5001""
)
timeout /t 2 /nobreak >nul
echo.

:: ============================================================
:: 5. Simulators
:: ============================================================
echo [5/7] Starting simulators...

:: Multi-Simulator (отключён по умолчанию — раскомментируйте при необходимости)
::start "CarWash Multi-Simulator" cmd /k "cd /d %ROOT%\simulator && node simulator.js"
::timeout /t 1 /nobreak >nul

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
echo [6/7] Starting Detection Server...
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
echo [7/7] Starting Angular Frontend...
start "CarWash Frontend" cmd /k "cd /d %FRONTEND% && ng serve --host 0.0.0.0"

echo.
echo ============================================================
echo   All processes started.
echo.
echo   Local MQTT:  ws://0.0.0.0:8083/mqtt  (mqtt://0.0.0.0:1883)
echo   Backend:     http://0.0.0.0:3000
echo   Frontend:    http://localhost:4200
echo   KkmProxy:    http://0.0.0.0:5001
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