# start-carwash.ps1
# Start all CarWash components silently (no windows)

$ErrorActionPreference = 'Continue'

# --- Settings ---
$ProjectRoot = "C:\Users\User\source\repos\zolotoi-15\carwash-operator_angular"
$LogDir      = Join-Path $ProjectRoot "logs"
$KkmProxyExe = Join-Path $ProjectRoot "KkmProxy\KkmProxy\bin\Debug\net8.0\KkmProxy.exe"
$KkmProxyDir = Join-Path $ProjectRoot "KkmProxy\KkmProxy\bin\Debug\net8.0"
$KkmProxySrc = Join-Path $ProjectRoot "KkmProxy"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

Write-Host "=== CarWash starting ===" -ForegroundColor Cyan

# --- 1. MongoDB ---
Write-Host "Checking MongoDB..." -ForegroundColor Yellow
$mongoService = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
if ($mongoService -and $mongoService.Status -ne 'Running') {
    try {
        Start-Service MongoDB -ErrorAction Stop
        Write-Host "  MongoDB started." -ForegroundColor Green
    } catch {
        Write-Host "  Failed to start MongoDB: $_" -ForegroundColor Red
    }
} elseif ($mongoService) {
    Write-Host "  MongoDB already running." -ForegroundColor Green
} else {
    Write-Host "  MongoDB service not found." -ForegroundColor DarkYellow
}

# --- 2. Backend (Node.js) ---
Write-Host "Starting Backend (node server.js)..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c node server.js > `"$LogDir\backend.log`" 2>&1" `
    -WorkingDirectory (Join-Path $ProjectRoot "backend") `
    -WindowStyle Hidden

Start-Sleep -Seconds 3

# --- 3. KkmProxy ---
if (Test-Path $KkmProxyExe) {
    Write-Host "Starting KkmProxy.exe..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c KkmProxy.exe --urls=`"http://0.0.0.0:5001`" > `"$LogDir\kkmproxy.log`" 2>&1" `
        -WorkingDirectory $KkmProxyDir `
        -WindowStyle Hidden
} else {
    Write-Host "KkmProxy.exe not found, using dotnet run..." -ForegroundColor DarkYellow
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c dotnet run --urls=`"http://0.0.0.0:5001`" > `"$LogDir\kkmproxy.log`" 2>&1" `
        -WorkingDirectory $KkmProxySrc `
        -WindowStyle Hidden
}
Start-Sleep -Seconds 1

# --- 4. KKM Simulator ---
Write-Host "Starting KKM Simulator..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c node kkm-simulator.js > `"$LogDir\kkm-simulator.log`" 2>&1" `
    -WorkingDirectory (Join-Path $ProjectRoot "kkm-simulator") `
    -WindowStyle Hidden
Start-Sleep -Seconds 1

# --- 5. Tank Simulator ---
Write-Host "Starting Tank Simulator..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c node tank-simulator-mqtt.js > `"$LogDir\tank-simulator.log`" 2>&1" `
    -WorkingDirectory (Join-Path $ProjectRoot "tank-simulator") `
    -WindowStyle Hidden
Start-Sleep -Seconds 1

# --- 6. Detection Server (Python) ---
$detectionPy = Join-Path $ProjectRoot "backend\detection_server.py"
if (Test-Path $detectionPy) {
    Write-Host "Starting Detection Server (Python)..." -ForegroundColor Yellow
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c python detection_server.py > `"$LogDir\detection.log`" 2>&1" `
        -WorkingDirectory (Join-Path $ProjectRoot "backend") `
        -WindowStyle Hidden
    Start-Sleep -Seconds 1
} else {
    Write-Host "detection_server.py not found, skipping." -ForegroundColor DarkYellow
}

# --- 7. Frontend (Angular) ---
Write-Host "Starting Frontend (ng serve)..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c ng serve --host 0.0.0.0 > `"$LogDir\frontend.log`" 2>&1" `
    -WorkingDirectory (Join-Path $ProjectRoot "frontend") `
    -WindowStyle Hidden

Write-Host ""
Write-Host "=== All components started (silent mode) ===" -ForegroundColor Green
Write-Host "Logs: $LogDir" -ForegroundColor Cyan
Write-Host "To stop - run stop-carwash.bat" -ForegroundColor Cyan