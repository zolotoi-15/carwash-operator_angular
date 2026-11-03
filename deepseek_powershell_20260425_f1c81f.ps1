# Запуск MongoDB (если служба существует)
try {
    Start-Service MongoDB -ErrorAction Stop
    Write-Host "MongoDB started"
} catch {
    Write-Host "MongoDB service not found or already running."
}

$scripts = @(
    @{Name="Backend";        Path="C:\Users\User\carwash-operator\backend";        File="server.js"},
    @{Name="Multi-Simulator";Path="C:\Users\User\carwash-operator\simulator";      File="simulator.js"},
    @{Name="KKM-Simulator";  Path="C:\Users\User\carwash-operator\kkm-simulator";  File="kkm-simulator.js"},
    @{Name="Tank-Simulator"; Path="C:\Users\User\carwash-operator\tank-simulator"; File="tank-simulator-mqtt.js"},
    @{Name="Frontend";       Path="C:\Users\User\carwash-operator\frontend";       File="ng", Arguments="serve --host 0.0.0.0"}
)

foreach ($s in $scripts) {
    $logFile = Join-Path $s.Path "logs.txt"
    if ($s.Name -eq "Frontend") {
        Start-Process -NoNewWindow -FilePath "ng" -ArgumentList $s.Arguments -WorkingDirectory $s.Path -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"
    } else {
        Start-Process -NoNewWindow -FilePath "node" -ArgumentList $s.File -WorkingDirectory $s.Path -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"
    }
    Write-Host "Started $($s.Name)"
    Start-Sleep -Seconds 1
}
Write-Host "All components launched. Logs in respective folders."
Read-Host "Press Enter to exit"