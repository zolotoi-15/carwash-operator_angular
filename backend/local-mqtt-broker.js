// backend/local-mqtt-broker.js
// Local MQTT broker (Aedes 1.x) + bridge to remote broker.

const { Aedes } = require('aedes');
const http = require('http');
const net = require('net');
const websocketStream = require('websocket-stream');
const mqtt = require('mqtt');
const mongoose = require('mongoose');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://0.0.0.0:27017/carwash';

const SUBSCRIBE_TOPICS = [
  'posts/+/status',
  'posts/+/lwt',
  'posts/+/local_LWT',
  'posts/+/config',
  'posts/+/clientcard',
  'system/config',
  'shift/total',
];

const FORWARD_UP_TOPICS = [
  /\/command$/,
  /^kkm\/print$/,
  /^card-reader\/command$/,
];

const DEFAULTS = {
  localHost: '0.0.0.0',
  localPortTcp: 1883,
  localPortWs: 8083,
  localPath: '/mqtt',
  localUsername: 'admin',
  localPassword: 'Zavulon56',
  remoteHost: 'm2.wqtt.ru',
  remotePortTls: 13258,
  remoteUsername: 'u_GGENLB',
  remotePassword: 'LTHNW22D',
};

async function loadSettings() {
  try {
    await mongoose.connect(MONGO_URL);
    console.log('[SETTINGS] connected to MongoDB');
    // server.js хранит настройки в коллекции settings как { key: 'main', value: {...} }
    const doc = await mongoose.connection.db
      .collection('settings')
      .findOne({ key: 'main' });
    await mongoose.disconnect();

    const mqttCfg = (doc && doc.value && doc.value.mqtt) || (doc && doc.mqtt) || null;
    if (!mqttCfg) {
      console.warn('[SETTINGS] mqtt не найден в БД, используются значения по умолчанию');
      return DEFAULTS;
    }

    // Новый формат { local, remote }
    if (mqttCfg.local || mqttCfg.remote) {
      const local = mqttCfg.local || {};
      const remote = mqttCfg.remote || {};
      const cfg = {
        localHost: local.host ?? DEFAULTS.localHost,
        localPortTcp: local.portTcp ?? DEFAULTS.localPortTcp,
        localPortWs: local.portWs ?? DEFAULTS.localPortWs,
        localPath: local.path ?? DEFAULTS.localPath,
        localUsername: local.username ?? DEFAULTS.localUsername,
        localPassword: local.password ?? DEFAULTS.localPassword,
        remoteHost: remote.host ?? DEFAULTS.remoteHost,
        remotePortTls: remote.portTls ?? DEFAULTS.remotePortTls,
        remoteUsername: remote.username ?? DEFAULTS.remoteUsername,
        remotePassword: remote.password ?? DEFAULTS.remotePassword,
      };
      console.log('[SETTINGS] loaded from DB (new format)');
      return cfg;
    }

    // Legacy формат { brokerUrl, username, password } — используем для удалённого
    if (mqttCfg.brokerUrl) {
      try {
        const u = new URL(mqttCfg.brokerUrl);
        const cfg = {
          ...DEFAULTS,
          remoteHost: u.hostname,
          remotePortTls: Number(u.port) || DEFAULTS.remotePortTls,
          remoteUsername: mqttCfg.username || DEFAULTS.remoteUsername,
          remotePassword: mqttCfg.password || DEFAULTS.remotePassword,
        };
        console.log('[SETTINGS] loaded from DB (legacy format), remote =', mqttCfg.brokerUrl);
        return cfg;
      } catch (e) {
        console.warn('[SETTINGS] некорректный brokerUrl:', mqttCfg.brokerUrl);
      }
    }

    return DEFAULTS;
  } catch (e) {
    console.warn('[SETTINGS] fallback to defaults:', e.message);
    return DEFAULTS;
  }
}

(async () => {
  const cfg = await loadSettings();

  const aedes = await Aedes.createBroker();

  aedes.authenticate = (client, username, password, callback) => {
    const pass = password ? password.toString() : '';
    const ok = (username === cfg.localUsername) && (pass === cfg.localPassword);
    if (ok) return callback(null, true);
    const err = new Error('Auth error');
    err.returnCode = 4;
    return callback(err, false);
  };

  const tcpServer = net.createServer((socket) => aedes.handle(socket));
  tcpServer.listen(cfg.localPortTcp, cfg.localHost, () => {
    console.log(`Local MQTT (TCP) listening on mqtt://${cfg.localHost}:${cfg.localPortTcp}`);
  });

  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Local MQTT broker (WebSocket) is running\n');
  });
  websocketStream.createServer(
    { server: httpServer, path: cfg.localPath },
    (stream, req) => aedes.handle(stream, req)
  );
  httpServer.listen(cfg.localPortWs, cfg.localHost, () => {
    console.log(`Local MQTT (WS)  listening on ws://${cfg.localHost}:${cfg.localPortWs}${cfg.localPath}`);
  });

  const remoteUrl = `mqtts://${cfg.remoteHost}:${cfg.remotePortTls}`;
  console.log(`[BRIDGE] Connecting to remote ${remoteUrl} as ${cfg.remoteUsername}...`);

  const remote = mqtt.connect(remoteUrl, {
    username: cfg.remoteUsername,
    password: cfg.remotePassword,
    clientId: 'bridge_' + Math.random().toString(16).substring(2, 10),
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    clean: true,
  });

  remote.on('connect', () => {
    console.log('[BRIDGE] connected to remote broker');
    remote.subscribe(SUBSCRIBE_TOPICS, { qos: 1 }, (err, granted) => {
      if (err) console.error('[BRIDGE] subscribe error:', err);
      else console.log('[BRIDGE] subscribed:', granted.map(g => g.topic).join(', '));
    });
  });
  remote.on('reconnect', () => console.log('[BRIDGE] reconnecting to remote...'));
  remote.on('close',     () => console.warn('[BRIDGE] remote connection closed'));
  remote.on('offline',   () => console.warn('[BRIDGE] remote offline'));
  remote.on('error',     (err) => console.error('[BRIDGE] remote error:', err.message));

  remote.on('message', (topic, payload) => {
    aedes.publish({ topic, payload, qos: 0, retain: false }, () => {});
  });

  aedes.on('publish', (packet, client) => {
    if (!client) return;
    if (!FORWARD_UP_TOPICS.some(re => re.test(packet.topic))) return;
    if (!remote.connected) return;
    remote.publish(packet.topic, packet.payload, { qos: 1 });
  });

  aedes.on('client',           (c) => console.log('[LOCAL] client connected:', c.id));
  aedes.on('clientDisconnect', (c) => console.log('[LOCAL] client disconnected:', c.id));
  aedes.on('subscribe', (subs, c) => {
    console.log('[LOCAL] ' + (c && c.id) + ' subscribed: ' + subs.map(s => s.topic).join(', '));
  });

  process.on('SIGINT', () => {
    console.log('Stopping local MQTT broker...');
    try { remote.end(true); } catch (e) {}
    aedes.close(() => {
      tcpServer.close();
      httpServer.close(() => process.exit(0));
    });
  });
})();