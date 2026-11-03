#!/bin/bash
PROJECT_DIR="/home/pi/carwash-operator"   # измените на ваш путь
cd "$PROJECT_DIR" || exit

mkdir -p logs

# Запуск MongoDB (служба)
echo "Starting MongoDB..."
sudo systemctl start mongod 2>/dev/null || sudo service mongodb start 2>/dev/null || echo "MongoDB not installed or already running"

# Запуск бэкенда (он запускает встроенный MQTT брокер)
echo "Starting Backend..."
node "$PROJECT_DIR/backend/server.js" > "$PROJECT_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID)"

sleep 2

echo "Starting Multi-Simulator..."
node "$PROJECT_DIR/simulator/simulator.js" > "$PROJECT_DIR/logs/simulator.log" 2>&1 &
echo "Multi-Simulator started (PID: $!)"

sleep 1

echo "Starting KKM Simulator..."
node "$PROJECT_DIR/kkm-simulator/kkm-simulator.js" > "$PROJECT_DIR/logs/kkm.log" 2>&1 &
echo "KKM Simulator started (PID: $!)"

sleep 1

echo "Starting Tank Simulator..."
node "$PROJECT_DIR/tank-simulator/tank-simulator-mqtt.js" > "$PROJECT_DIR/logs/tank.log" 2>&1 &
echo "Tank Simulator started (PID: $!)"

sleep 2

echo "Starting Frontend (Angular)..."
ng serve --host 0.0.0.0 --disable-host-check > "$PROJECT_DIR/logs/frontend.log" 2>&1 &
echo "Frontend started (PID: $!)"

echo "All components launched. Logs in $PROJECT_DIR/logs/"
echo "To stop: kill $BACKEND_PID ..."