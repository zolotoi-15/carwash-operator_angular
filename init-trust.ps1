#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# ============================================================
# CarWash Docker Trust Init (Windows)
# ============================================================

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CertsDir   = Join-Path $ProjectDir "certs"
$CaDir      = Join-Path $CertsDir "ca"
$MqttDir    = Join-Path $CertsDir "mqtt"
$ClientDir  = Join-Path $CertsDir "client"
$MosqConf   = Join-Path $ProjectDir "mosquitto\config"

# ⚠️ Измените под себя
$MqttHost = if ($env:MQTT_HOST) { $env:MQTT_HOST } else { "carwash.local" }
$MqttIp   = if ($env:MQTT_IP)   { $env:MQTT_IP }   else { "192.168.31.211" }
$ClientCn = if ($env:CLIENT_CN) { $env:CLIENT_CN } else { "esp32-post-3" }
$DaysCa   = 3650
$DaysCert = 825

function Log  ($m) { Write-Host "▶ $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "⚠ $m" -ForegroundColor Yellow }
function Err  ($m) { Write-Host "✖ $m" -ForegroundColor Red }

# 0. Проверки
Log "Проверка окружения..."
$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
  # Пробуем стандартный путь Git for Windows
  $gitOpenSsl = "C:\Program Files\Git\usr\bin\openssl.exe"
  if (Test-Path $gitOpenSsl) { $openssl = $gitOpenSsl } else {
    Err "openssl не найден. Установите Git for Windows или добавьте openssl в PATH."
    exit 1
  }
}
Log "openssl: $openssl"

try { docker compose version | Out-Null } catch { Err "docker compose не найден"; exit 1 }
Log "docker: $((docker --version) -replace 'Docker version ','' -replace ',.*','')"

# 1. Папки
New-Item -ItemType Directory -Force -Path $CaDir, $MqttDir, $ClientDir, $MosqConf | Out-Null

# 2. CA
if (-not (Test-Path (Join-Path $CaDir "ca.key"))) {
  Log "Генерация CA..."
  & $openssl genrsa -out "$CaDir\ca.key" 4096
  & $openssl req -x509 -new -nodes -key "$CaDir\ca.key" -sha256 -days $DaysCa `
      -subj "/C=RU/ST=Moscow/L=Moscow/O=CarWash/OU=PKI/CN=CarWash Root CA" `
      -out "$CaDir\ca.crt"
} else { Warn "CA уже существует" }

# 3. MQTT-брокер
Log "Сертификат брокера (CN=$MqttHost, IP=$MqttIp)..."
& $openssl genrsa -out "$MqttDir\server.key" 2048
& $openssl req -new -key "$MqttDir\server.key" `
    -subj "/C=RU/ST=Moscow/L=Moscow/O=CarWash/OU=Broker/CN=$MqttHost" `
    -out "$MqttDir\server.csr"

@"
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
DNS.1=$MqttHost
DNS.2=mosquitto
DNS.3=localhost
IP.1=$MqttIp
IP.2=127.0.0.1
"@ | Out-File -Encoding ASCII "$MqttDir\server.ext"

& $openssl x509 -req -in "$MqttDir\server.csr" -CA "$CaDir\ca.crt" -CAkey "$CaDir\ca.key" `
    -CAcreateserial -days $DaysCert -sha256 -extfile "$MqttDir\server.ext" `
    -out "$MqttDir\server.crt"
Copy-Item "$CaDir\ca.crt" "$MqttDir\ca.crt" -Force
Remove-Item "$MqttDir\server.csr", "$MqttDir\server.ext" -ErrorAction SilentlyContinue

# 4. Клиент ESP32
Log "Клиентский сертификат (CN=$ClientCn)..."
& $openssl genrsa -out "$ClientDir\client.key" 2048
& $openssl req -new -key "$ClientDir\client.key" `
    -subj "/C=RU/ST=Moscow/L=Moscow/O=CarWash/OU=Device/CN=$ClientCn" `
    -out "$ClientDir\client.csr"

@"
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
"@ | Out-File -Encoding ASCII "$ClientDir\client.ext"

& $openssl x509 -req -in "$ClientDir\client.csr" -CA "$CaDir\ca.crt" -CAkey "$CaDir\ca.key" `
    -CAcreateserial -days $DaysCert -sha256 -extfile "$ClientDir\client.ext" `
    -out "$ClientDir\client.crt"
Copy-Item "$CaDir\ca.crt" "$ClientDir\ca.crt" -Force
Remove-Item "$ClientDir\client.csr", "$ClientDir\client.ext" -ErrorAction SilentlyContinue

# 5. Mosquitto TLS-конфиг
$mosqTls = @"
listener 1883
protocol mqtt
allow_anonymous true

listener 8083
protocol websockets
allow_anonymous true

listener 8883
protocol mqtt
cafile   /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile  /mosquitto/certs/server.key
require_certificate true
use_identity_as_username true
allow_anonymous false

listener 8084
protocol websockets
cafile   /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile  /mosquitto/certs/server.key
allow_anonymous true
"@
$mosqTls | Out-File -Encoding ASCII -NoNewline (Join-Path $MosqConf "mosquitto-tls.conf")
Log "Mosquitto TLS: $MosqConf\mosquitto-tls.conf"

# 6. docker-compose.tls.yml
$composeTls = @"
version: '3.8'

services:
  mqtt:
    ports:
      - "8883:8883"
      - "8084:8084"
    volumes:
      - ./certs/mqtt:/mosquitto/certs:ro
      - ./mosquitto/config/mosquitto-tls.conf:/mosquitto/config/mosquitto.conf:ro

  backend:
    environment:
      MQTT_USE_TLS: "true"
      MQTT_CA_FILE: "/app/certs/ca.crt"
      MQTT_CLIENT_CERT: "/app/certs/client.crt"
      MQTT_CLIENT_KEY: "/app/certs/client.key"
      MQTT_BROKER_URL: "mqtts://mqtt:8883"
    volumes:
      - ./certs/client:/app/certs:ro
"@
$composeTls | Out-File -Encoding ASCII (Join-Path $ProjectDir "docker-compose.tls.yml")
Log "Override: docker-compose.tls.yml"

# 7. Запуск
Log "Запуск docker compose с TLS..."
Set-Location $ProjectDir
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build

# 8. Проверка доверия
Log "Ожидание (10 сек)..."
Start-Sleep -Seconds 10
Log "Проверка TLS..."
$result = & $openssl s_client -connect "${MqttIp}:8883" -CAfile "$CaDir\ca.crt" `
    -cert "$ClientDir\client.crt" -key "$ClientDir\client.key" -verify_return_error 2>&1
if ($result -match "Verify return code: 0 \(ok\)") {
  Log "✅ TLS-соединение установлено, сертификат доверенный"
} else {
  Warn "TLS-проверка не удалась. Логи: docker compose logs mqtt"
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  🔐 Доверенные контейнеры запущены" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  MQTT (plain):  localhost:1883"
Write-Host "  MQTT (TLS):    ${MqttIp}:8883   ← для ESP32"
Write-Host "  MQTT (WS):     localhost:8083"
Write-Host "  MQTT (WSS):    localhost:8084"
Write-Host "  Backend:       http://localhost:3000"
Write-Host "  Frontend:      http://localhost"
Write-Host ""
Write-Host "  Файлы для ESP32 (прошейте во флеш):"
Write-Host "    CA:     $ClientDir\ca.crt"
Write-Host "    Client: $ClientDir\client.crt"
Write-Host "    Key:    $ClientDir\client.key"
Write-Host ""
Write-Host "  broker в ESP32: mqtts://${MqttIp}:8883"
Write-Host "============================================================" -ForegroundColor Cyan