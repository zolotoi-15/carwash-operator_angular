# stop-carwash.ps1
# Скрипт для остановки всех компонентов CarWash

$ErrorActionPreference = 'SilentlyContinue'

Write-Host "=== Остановка CarWash ===" -ForegroundColor Cyan

# 1. Закрываем окна, запущенные оригинальным launcher'ом (по заголовку)
Write-Host "Поиск окон с заголовком 'CarWash'..." -ForegroundColor Yellow
taskkill /FI "WINDOWTITLE eq CarWash*" /T /F 2>$null | Out-Null

# 2. Останавливаем KkmProxy.exe (реальный ККМ)
Write-Host "Остановка KkmProxy.exe..." -ForegroundColor Yellow
Get-Process KkmProxy -ErrorAction SilentlyContinue | Stop-Process -Force

# 3. Останавливаем node-процессы (backend, симуляторы, frontend)
Write-Host "Остановка node-процессов..." -ForegroundColor Yellow
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
    Write-Host "  Остановка node PID $($_.ProcessId)" -ForegroundColor Gray
    Stop-Process -Id $_.ProcessId -Force
}

# 4. Останавливаем Python detection_server.py
Write-Host "Остановка detection_server.py..." -ForegroundColor Yellow
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object {
    $_.CommandLine -like '*detection_server.py*'
} | ForEach-Object {
    Write-Host "  Остановка python PID $($_.ProcessId)" -ForegroundColor Gray
    Stop-Process -Id $_.ProcessId -Force
}

# 5. Останавливаем dotnet-процессы, связанные с KkmProxy (если запущен через dotnet run)
Write-Host "Остановка dotnet KkmProxy..." -ForegroundColor Yellow
Get-CimInstance Win32_Process -Filter "Name = 'dotnet.exe'" | Where-Object {
    $_.CommandLine -like '*KkmProxy*'
} | ForEach-Object {
    Write-Host "  Остановка dotnet PID $($_.ProcessId)" -ForegroundColor Gray
    Stop-Process -Id $_.ProcessId -Force
}

# 6. Опционально: остановка MongoDB (раскомментируйте, если нужно)
# Write-Host "Остановка MongoDB..." -ForegroundColor Yellow
# net stop MongoDB 2>$null

Write-Host "=== Готово ===" -ForegroundColor Green