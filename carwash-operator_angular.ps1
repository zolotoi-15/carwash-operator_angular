#Requires -Version 5.1

# ============================================================
# Настройка путей
# ============================================================
$ROOT       = "C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular"
$BACKEND    = "$ROOT\backend"
$FRONTEND   = "$ROOT\frontend"
$KKM_SIM    = "$ROOT\kkm-simulator"
$TANK_SIM   = "$ROOT\tank-simulator"

$KKM_BRIDGE_JS = "$BACKEND\kkm-bridge.js"
$KKM_QUERY_PS  = "$BACKEND\kkm-query.ps1"

$Host.UI.RawUI.WindowTitle = "CarWash System Launcher (PowerShell)"

# ============================================================
# Вспомогательные функции
# ============================================================
function Test-Port {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

function Check-Port {
    param([int]$Port, [string]$Description)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Host "   WARNING: port $Port ($Description) is already in use." -ForegroundColor Yellow
        foreach ($c in $conn) {
            Write-Host "            PID $($c.OwningProcess) — возможно, старый процесс. Закройте его." -ForegroundColor Yellow
        }
    } else {
        Write-Host "   port $Port ($Description) — free." -ForegroundColor Gray
    }
}

function Wait-ForPort {
    param([int]$Port, [string]$Description, [int]$TimeoutSec)
    $tries = $TimeoutSec
    while ($tries -gt 0) {
        if (Test-Port -Port $Port) {
            Write-Host "   $Description — ready on port $Port." -ForegroundColor Green
            return $true
        }
        Start-Sleep -Seconds 1
        $tries--
    }
    Write-Host "   WARNING: $Description did not start on port $Port within ${TimeoutSec}s." -ForegroundColor Red
    return $false
}

# ============================================================
# Старт
# ============================================================
Write-Host "============================================================"
Write-Host "  CarWash System Launcher"
Write-Host "============================================================"
Write-Host ""

# ------------------------------------------------------------
# 0. Проверка занятости портов
# ------------------------------------------------------------
Write-Host "[0/8] Checking ports..."
Check-Port -Port 1883 -Description "MQTT TCP"
Check-Port -Port 8083 -Description "MQTT WebSocket"
Check-Port -Port 3000 -Description "Backend REST API"
Check-Port -Port 4200 -Description "Angular Dev Server"
Check-Port -Port 5001 -Description "KKM Bridge"
Write-Host ""

# ------------------------------------------------------------
# 1. MongoDB
# ------------------------------------------------------------
Write-Host "[1/8] Starting MongoDB..."
try {
    Start-Service -Name "MongoDB" -ErrorAction Stop
    Write-Host "   MongoDB started." -ForegroundColor Green
} catch {
    Write-Host "   MongoDB service not found or already running." -ForegroundColor Yellow
}
Wait-ForPort -Port 27017 -Description "MongoDB" -TimeoutSec 15
Write-Host ""

# ------------------------------------------------------------
# 2. Local MQTT Broker
# ------------------------------------------------------------
Write-Host "[2/8] Starting Local MQTT Broker..."
Start-Process cmd -ArgumentList "/k", "title CarWash Local MQTT Broker && cd /d `"$BACKEND`" && node local-mqtt-broker.js"
Wait-ForPort -Port 1883 -Description "Local MQTT TCP" -TimeoutSec 10
Wait-ForPort -Port 8083 -Description "Local MQTT WS" -TimeoutSec 10
Write-Host ""

# ------------------------------------------------------------
# 3. Backend (REST API)
# ------------------------------------------------------------
Write-Host "[3/8] Starting Backend..."
Start-Process cmd -ArgumentList "/k", "title CarWash Backend && cd /d `"$BACKEND`" && node server.js"
Wait-ForPort -Port 3000 -Description "Backend REST API" -TimeoutSec 15
Write-Host ""

# ------------------------------------------------------------
# 4. KKM Bridge
# ------------------------------------------------------------
Write-Host "[4/8] Starting KKM Bridge..."
try {
    $null = New-Object -ComObject 'AddIn.DrvFR'
    Write-Host "   COM AddIn.DrvFR — OK" -ForegroundColor Green
    $comOk = $true
} catch {
    Write-Host "   COM AddIn.DrvFR — NOT AVAILABLE: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "   WARNING: драйвер Штрих-М не зарегистрирован. KKM Bridge будет в режиме 'driver offline'." -ForegroundColor Yellow
    $comOk = $false
}

if ((Test-Path $KKM_BRIDGE_JS) -and (Test-Path $KKM_QUERY_PS)) {
    $kkmCmd = "title CarWash KKM Bridge && cd /d `"$BACKEND`" && set KKM_BRIDGE_PORT=5001&& set SHTRIH_COM_NUMBER=1&& set SHTRIH_BAUD=115200&& node kkm-bridge.js"
    Start-Process cmd -ArgumentList "/k", $kkmCmd
    Wait-ForPort -Port 5001 -Description "KKM Bridge" -TimeoutSec 10
} else {
    Write-Host "   kkm-bridge.js or kkm-query.ps1 not found, skipping KKM Bridge." -ForegroundColor Yellow
}
Write-Host ""

# ------------------------------------------------------------
# 5. Simulators
# ------------------------------------------------------------
Write-Host "[5/8] Starting simulators..."
if (Test-Path "$KKM_SIM\kkm-simulator.js") {
    Start-Process cmd -ArgumentList "/k", "title CarWash KKM Simulator && cd /d `"$KKM_SIM`" && node kkm-simulator.js"
    Start-Sleep -Seconds 1
} else {
    Write-Host "   kkm-simulator.js not found, skipping." -ForegroundColor Gray
}

if (Test-Path "$TANK_SIM\tank-simulator-mqtt.js") {
    Start-Process cmd -ArgumentList "/k", "title CarWash Tank Simulator && cd /d `"$TANK_SIM`" && node tank-simulator-mqtt.js"
    Start-Sleep -Seconds 1
} else {
    Write-Host "   tank-simulator-mqtt.js not found, skipping." -ForegroundColor Gray
}
Write-Host ""

# ------------------------------------------------------------
# 6. Detection Server (Python)
# ------------------------------------------------------------
Write-Host "[6/8] Starting Detection Server..."
if (Test-Path "$BACKEND\detection_server.py") {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        Start-Process cmd -ArgumentList "/k", "title CarWash Detection && cd /d `"$BACKEND`" && python detection_server.py"
        Start-Sleep -Seconds 1
    } else {
        Write-Host "   Python not found in PATH, skipping detection server." -ForegroundColor Yellow
    }
} else {
    Write-Host "   detection_server.py not found, skipping." -ForegroundColor Gray
}
Write-Host ""

# ------------------------------------------------------------
# 7. Angular Frontend
# ------------------------------------------------------------
Write-Host "[7/8] Starting Angular Frontend..."
# Добавляем лимит памяти, чтобы ng serve не зависал
$frontendCmd = "title CarWash Frontend && cd /d `"$FRONTEND`" && set NODE_OPTIONS=--max_old_space_size=8192 && ng serve --host 0.0.0.0"
Start-Process cmd -ArgumentList "/k", $frontendCmd
Wait-ForPort -Port 4200 -Description "Angular Dev Server" -TimeoutSec 30
Write-Host ""

# ------------------------------------------------------------
# 8. Итоговая проверка KKM Bridge
# ------------------------------------------------------------
Write-Host "[8/8] Verifying KKM Bridge..."
Start-Sleep -Seconds 2
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:5001/api/kkm/status" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "   KKM Bridge отвечает: http://127.0.0.1:5001/api/kkm/status" -ForegroundColor Green
    Write-Host "   $($response | ConvertTo-Json -Compress)" -ForegroundColor Gray
} catch {
    Write-Host "   KKM Bridge не отвечает. Проверьте окно 'CarWash KKM Bridge'." -ForegroundColor Red
}
Write-Host ""

# ------------------------------------------------------------
# Финал
# ------------------------------------------------------------
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  All processes started." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Local MQTT:  ws://0.0.0.0:8083/mqtt  (mqtt://0.0.0.0:1883)" -ForegroundColor White
Write-Host "  Backend:     http://0.0.0.0:3000" -ForegroundColor White
Write-Host "  Frontend:    http://localhost:4200" -ForegroundColor White
Write-Host "  KKM Bridge:  http://127.0.0.1:5001/api/kkm/status" -ForegroundColor White
Write-Host ""
Write-Host "  Close each terminal window to stop a service." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan

Read-Host -Prompt "Press Enter to exit..."