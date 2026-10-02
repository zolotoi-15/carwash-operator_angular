# stop-carwash.ps1
# Stop all CarWash components

$ErrorActionPreference = 'SilentlyContinue'

Write-Host "=== Stopping CarWash ===" -ForegroundColor Cyan

# 1. Kill windows started by original launcher (by title)
Write-Host "Killing windows with title 'CarWash*'..." -ForegroundColor Yellow
taskkill /FI "WINDOWTITLE eq CarWash*" /T /F 2>$null | Out-Null

# 2. Stop KkmProxy.exe
Write-Host "Stopping KkmProxy.exe..." -ForegroundColor Yellow
Get-Process KkmProxy -ErrorAction SilentlyContinue | Stop-Process -Force

# 3. Stop node processes (backend, simulators, frontend)
Write-Host "Stopping node processes..." -ForegroundColor Yellow
$nodePatterns = @(
    'server.js',
    'kkm-simulator.js',
    'tank-simulator-mqtt.js',
    'ng serve'
)
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $cmd = $_.CommandLine
    if ($cmd) {
        foreach ($pattern in $nodePatterns) {
            if ($cmd -like "*$pattern*") { return $true }
        }
    }
    return $false
} | ForEach-Object {
    Write-Host "  Stopping node PID $($_.ProcessId)" -ForegroundColor Gray
    Stop-Process -Id $_.ProcessId -Force
}

# 4. Stop Python detection_server.py
Write-Host "Stopping detection_server.py..." -ForegroundColor Yellow
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object {
    $_.CommandLine -like '*detection_server.py*'
} | ForEach-Object {
    Write-Host "  Stopping python PID $($_.ProcessId)" -ForegroundColor Gray
    Stop-Process -Id $_.ProcessId -Force
}

# 5. Stop dotnet KkmProxy (if started via dotnet run)
Write-Host "Stopping dotnet KkmProxy..." -ForegroundColor Yellow
Get-CimInstance Win32_Process -Filter "Name = 'dotnet.exe'" | Where-Object {
    $_.CommandLine -like '*KkmProxy*'
} | ForEach-Object {
    Write-Host "  Stopping dotnet PID $($_.ProcessId)" -ForegroundColor Gray
    Stop-Process -Id $_.ProcessId -Force
}

# 6. Optional: stop MongoDB (uncomment if needed)
# Write-Host "Stopping MongoDB..." -ForegroundColor Yellow
# net stop MongoDB 2>$null

Write-Host "=== Done ===" -ForegroundColor Green