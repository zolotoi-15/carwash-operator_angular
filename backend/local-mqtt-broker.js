// backend/local-mqtt-broker.js
// Локальный MQTT-брокер на базе Aedes с поддержкой WebSocket.
// Используется как fallback, когда удалённый брокер (WQTT) недоступен.

const aedes = require('aedes')();
const http = require('http');
const websocketStream = require('websocket-stream');

const MQTT_WS_PORT = process.env.LOCAL_MQTT_PORT || 8083;
const MQTT_WS_PATH = process.env.LOCAL_MQTT_PATH || '/mqtt';

// ---------- HTTP-сервер, к которому привяжем WebSocket ----------
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Local MQTT broker (WebSocket) is running\n');
});

// ---------- WebSocket-стрим для MQTT ----------
websocketStream.createServer(
  { server: httpServer, path: MQTT_WS_PATH },
  aedes.handle
);

httpServer.listen(MQTT_WS_PORT, '0.0.0.0', () => {
  console.log(`✅ Локальный MQTT-брокер запущен: ws://0.0.0.0:${MQTT_WS_PORT}${MQTT_WS_PATH}`);
  console.log(`   Для Angular используйте: ws://localhost:${MQTT_WS_PORT}${MQTT_WS_PATH}`);
});

// ---------- Логирование ----------
aedes.on('client', (client) => {
  console.log(`[MQTT] client connected: ${client.id}`);
});
aedes.on('clientDisconnect', (client) => {
  console.log(`[MQTT] client disconnected: ${client.id}`);
});
aedes.on('subscribe', (subscriptions, client) => {
  const topics = subscriptions.map((s) => s.topic).join(', ');
  console.log(`[MQTT] ${client?.id} subscribed: ${topics}`);
});
aedes.on('unsubscribe', (unsubscriptions, client) => {
  console.log(`[MQTT] ${client?.id} unsubscribed: ${unsubscriptions.join(', ')}`);
});
aedes.on('publish', (packet, client) => {
  if (!client) return; // системные сообщения (retained, will и т.п.)
  console.log(`[MQTT] publish from ${client.id} → ${packet.topic}`);
});

// ---------- Аккуратное завершение ----------
process.on('SIGINT', () => {
  console.log('Останавливаю локальный MQTT-брокер...');
  aedes.close(() => {
    httpServer.close(() => process.exit(0));
  });
});

module.exports = { httpServer, aedes, MQTT_WS_PORT, MQTT_WS_PATH };