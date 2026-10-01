# start-carwash.ps1
# Запуск всех компонентов CarWash без открытия окон

$ErrorActionPreference = 'Continue'

# --- Настройки ---
$ProjectRoot = "C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular"
$LogDir      = Join-Path $ProjectRoot "logs"
$KkmProxyExe = Join-Path $ProjectRoot "KkmProxy\KkmProxy\bin\Debug\net8.0\KkmProxy.exe"
$KkmProxyDir = Join-Path $ProjectRoot "KkmProxy\KkmProxy\bin\Debug\net8.0"
$KkmProxySrc = Join-Path $ProjectRoot "KkmProxy"

# Создаём папку для логов, если её нет
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

Write-Host "=== Запуск CarWash ===" -ForegroundColor Cyan

# --- 1. MongoDB ---
Write-Host "Проверка MongoDB..." -ForegroundColor Yellow
$mongoService = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
if ($mongoService -and $mongoService.Status -ne 'Running') {
    try {
        Start-Service MongoDB -ErrorAction Stop
        Write-Host "  MongoDB запущена." -ForegroundColor Green
    } catch {
        Write-Host "  Не удалось запустить MongoDB: $_" -ForegroundColor Red
    }
} elseif ($mongoService) {
    Write-Host "  MongoDB уже запущена." -ForegroundColor Green
} else {
    Write-Host "  Служба MongoDB не найдена." -ForegroundColor DarkYellow
}

# --- 2. Backend (Node.js) ---
Write-Host "Запуск Backend (node server.js)..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c node server.js > `"$LogDir\backend.log`" 2>&1" `
    -WorkingDirectory (Join-Path $ProjectRoot "backend") `
    -WindowStyle Hidden

# Ждём, пока бэкенд создаст mqtt-config.json
Start-Sleep -Seconds 3

# --- 3. KkmProxy ---
if (Test-Path $KkmProxyExe) {
    Write-Host "Запуск KkmProxy.exe..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c KkmProxy.exe --urls=`"http://0.0.0.0:5001`" > `"$LogDir\kkmproxy.log`" 2>&1" `
        -WorkingDirectory $KkmProxyDir `
        -WindowStyle Hidden
} else {
    Write-Host "KkmProxy.exe не найден, запуск через dotnet run..." -ForegroundColor DarkYellow
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c dotnet run --urls=`"http://0.0.0.0:5001`" > `"$LogDir\kkmproxy.log`" 2>&1" `
        -WorkingDirectory $KkmProxySrc `
        -WindowStyle Hidden
}
Start-Sleep -Seconds 1

# --- 4. KKM Simulator ---
Write-Host "Запуск KKM Simulator..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c node kkm-simulator.js > `"$LogDir\kkm-simulator.log`" 2>&1" `
    -WorkingDirectory (Join-Path $ProjectRoot "kkm-simulator") `
    -WindowStyle Hidden
Start-Sleep -Seconds 1

# --- 5. Tank Simulator ---
Write-Host "Запуск Tank Simulator..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c node tank-simulator-mqtt.js > `"$LogDir\tank-simulator.log`" 2>&1" `
    -WorkingDirectory (Join-Path $ProjectRoot "tank-simulator") `
    -WindowStyle Hidden
Start-Sleep -Seconds 1

# --- 6. Detection Server (Python) ---
$detectionPy = Join-Path $ProjectRoot "backend\detection_server.py"
if (Test-Path $detectionPy) {
    Write-Host "Запуск Detection Server (Python)..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c python detection_server.py > `"$LogDir\detection.log`" 2>&1" `
        -WorkingDirectory (Join-Path $ProjectRoot "backend") `
        -WindowStyle Hidden
    Start-Sleep -Seconds 1
} else {
    Write-Host "detection_server.py не найден, пропуск." -ForegroundColor DarkYellow
}

# --- 7. Frontend (Angular) ---
Write-Host "Запуск Frontend (ng serve)..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c ng serve --host 0.0.0.0 > `"$LogDir\frontend.log`" 2>&1" `
    -WorkingDirectory (Join-Path $ProjectRoot "frontend") `
    -WindowStyle Hidden

Write-Host ""
Write-Host "=== Все компоненты запущены скрыто ===" -ForegroundColor Green
Write-Host "Логи: $LogDir" -ForegroundColor Cyan
Write-Host "Для остановки запустите stop-carwash.bat" -ForegroundColor Cyan