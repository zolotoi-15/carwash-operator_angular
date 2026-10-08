// backend/server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const ClientCard = require('./models/ClientCard');
const cardsRouter = require('./routes/cards');
const Receipt = require('./models/Receipt');
const { initReceiptService, createReceipt } = require('./services/receipt.service');
require('dotenv').config();

const KKM_DRIVER_URL = process.env.KKM_DRIVER_URL || 'http://127.0.0.1:5001/api/kkm';

// ============================================================
// WebSocket
// ============================================================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(payload) {
  if (!wss) return;
  const data = JSON.stringify(payload);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); } catch { /* ignore */ }
    }
  }
}

wss.on('connection', async (ws) => {
  console.log(`🔌 WebSocket: клиент подключён (всего: ${wss.clients.size})`);

  try {
    ws.send(JSON.stringify({
      type: 'snapshot',
      posts: postsState,
      settings: {
        tankLevels: settings.tankLevels,
        numberOfPosts: settings.numberOfPosts,
      },
      timestamp: Date.now(),
    }));
  } catch (e) {
    console.warn('WebSocket snapshot error:', e.message);
  }

  try { await closeExpiredShiftIfNeeded(); } catch { /* ignore */ }

  try {
    const currentShift = await Shift.findOne({ shiftOpen: true });
    if (currentShift) {
      const receipts = await Receipt.find({ timestamp: { $gte: currentShift.openedAt } });
      const total = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);
      ws.send(JSON.stringify({
        type: 'mqtt',
        topic: 'shift/total',
        payload: JSON.stringify({ total, count: receipts.length }),
        timestamp: Date.now(),
      }));
    }
  } catch (e) {
    console.warn('WebSocket shift/total snapshot error:', e.message);
  }

  try {
    await publishKkmStatus();
    const shift = await Shift.findOne({ shiftOpen: true }).lean();
    const driverData = await fetchKkmStatusFromDriver();

    const kkmPayload = JSON.stringify({
      ready:              driverData ? !!driverData.ready       : true,
      connected:          driverData ? !!driverData.connected   : false,
      paper:              driverData ? !!driverData.paper       : true,
      kkNumber:           driverData?.kkNumber || settings.kkmManual?.kkNumber || '',
      shiftNumber:        driverData?.shiftNumber ?? settings.kkmManual?.fiscalShiftNumber ?? 0,
      cashier:            driverData?.cashierName || settings.kkmManual?.cashierName || 'Оператор',
      shiftOpened:        !!shift,
      shiftOpenedAt:      shift?.openedAt || null,
      shiftAutoCloseAt:   shift?.autoCloseAt || null,
      currentShiftNumber: shift?.shiftNumber || 0,
      driverOnline:       !!driverData,
      errors:             driverData?.errors || [],
    });
    ws.send(JSON.stringify({
      type: 'mqtt',
      topic: 'kkm/status',
      payload: kkmPayload,
      timestamp: Date.now(),
    }));
  } catch (e) {
    console.warn('WebSocket kkm/status snapshot error:', e.message);
  }

  ws.on('close', () => {
    console.log(`🔌 WebSocket: клиент отключился (всего: ${wss.clients.size})`);
  });
  ws.on('error', (err) => console.warn('WebSocket error:', err.message));
});

// ============================================================
// MQTT
// ============================================================
let mqttClient = null;
let mqttSettings = {
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  username: '',
  password: ''
};

function writeMqttConfigFile(cfg) {
  try {
    const configPath = path.join(__dirname, '..', 'mqtt-config.json');
    const mqttCfg = cfg.mqtt || {};
    const local = mqttCfg.local || {};

    let out;
    if (local.host) {
      const host = (local.host && local.host !== '0.0.0.0') ? local.host : 'localhost';
      const port = local.portTcp ?? 1883;
      out = {
        brokerUrl: `mqtt://${host}:${port}`,
        username: local.username || '',
        password: local.password || ''
      };
    } else {
      out = {
        brokerUrl: mqttCfg.brokerUrl || process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        username: mqttCfg.username || '',
        password: mqttCfg.password || ''
      };
    }

    fs.writeFileSync(configPath, JSON.stringify(out, null, 2));
    console.log('✅ mqtt-config.json обновлён:', out.brokerUrl);
  } catch (err) {
    console.warn('⚠️ Не удалось сохранить mqtt-config.json:', err.message);
  }
}

function connectMqtt(settings) {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }

  const mqttCfg = settings || {};
  const local = mqttCfg.local || {};

  let brokerUrl, username, password;
  if (local.host) {
    const host = (local.host && local.host !== '0.0.0.0') ? local.host : 'localhost';
    brokerUrl = `mqtt://${host}:${local.portTcp ?? 1883}`;
    username = local.username || '';
    password = local.password || '';
  } else if (mqttCfg.brokerUrl) {
    brokerUrl = mqttCfg.brokerUrl;
    username = mqttCfg.username || '';
    password = mqttCfg.password || '';
  } else {
    brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    username = '';
    password = '';
  }

  const options = {};
  if (username) options.username = username;
  if (password) options.password = password;

  console.log('Подключение к локальному брокеру:', brokerUrl);
  mqttClient = mqtt.connect(brokerUrl, options);

  mqttClient.on('connect', () => {
    console.log('✅ Подключено к MQTT брокеру:', brokerUrl);
    mqttClient.subscribe('kkm/print');
    mqttClient.subscribe('posts/+/command');
    mqttClient.subscribe('posts/+/status');
    mqttClient.subscribe('tank/levels');
    mqttClient.subscribe('reports/request');
    mqttClient.subscribe('posts/+/config');
    mqttClient.subscribe('posts/+/clientcard');
    mqttClient.subscribe('posts/+/receipt');
    mqttClient.subscribe('posts/+/lwt');
    mqttClient.subscribe('posts/+/receipt_number');
    if (settings.posts) publishConfigToAllPosts();
  });

  mqttClient.on('message', async (topic, message) => {
    const payload = message.toString();

    broadcast({
      type: 'mqtt',
      topic,
      payload,
      timestamp: Date.now(),
    });

    if (topic === 'kkm/print' || /^posts\/[^/]+\/receipt$/.test(topic)) {
      try {
        const receiptData = JSON.parse(payload);
        if (!receiptData.postId) {
          const m = topic.match(/^posts\/(\d+)\//);
          if (m) receiptData.postId = parseInt(m[1], 10);
        }

        const items = Array.isArray(receiptData.items) ? receiptData.items : [];
        const totalCost = items.reduce((s, it) => s + (Number(it.cost) || 0), 0);

        await createReceipt({
          postId:        receiptData.postId || 0,
          kind:          receiptData.kind || 'session',
          operation:     receiptData.operation || 'sell',
          isAdvance:     !!receiptData.isAdvance,
          advanceReceiptNumber: receiptData.advanceReceiptNumber ?? null,
          items,
          totalCost:     Math.round(totalCost * 10) / 10,
          balanceAfter:  receiptData.balance || 0,
          paymentMethod: receiptData.paymentMethod || null,
          discountTotal: receiptData.discountTotal || 0,
          correctionInfo: receiptData.correctionInfo || null,
          timestamp:     receiptData.timestamp,
        });
        console.log(`✅ Чек сохранён (postId=${receiptData.postId || 0}, kind=${receiptData.kind || 'session'}, adv=${receiptData.advanceReceiptNumber || '—'})`);
      } catch (err) {
        console.error(`Ошибка сохранения чека из ${topic}:`, err.message);
      }
    }

    if (topic.startsWith('posts/') && topic.endsWith('/command')) {
      const postId = topic.split('/')[1];
      try {
        const { command } = JSON.parse(payload);
        console.log(`📨 Пост ${postId}: ${command}`);
        if (command.startsWith('program ')) {
          handleProgram(postId, command.substring(8).trim());
        } else if (command === 'stop') {
          stopPost(postId, true, true);
        } else if (command === 'pause') {
          togglePause(postId);
        } else if (command.startsWith('add_balance ')) {
          const amount = parseFloat(command.substring(12).trim());
          if (!isNaN(amount) && amount > 0) addBalance(postId, amount);
        } else if (command === 'get_status') {
          publishStatus(postId);
        } else if (command === 'reset') {
          resetPost(postId);
        } else if (command === 'print_receipt') {
          printReceipt(postId);
        }
      } catch (e) {
        console.error(`Ошибка обработки команды для поста ${postId}:`, e.message);
      }
    }

    if (topic.startsWith('posts/') && topic.endsWith('/status')) {
      const postId = topic.split('/')[1];
      try {
        const data = JSON.parse(payload);
        if (!postsState[postId]) postsState[postId] = {};
        const state = postsState[postId];
        const cc = state.clientCard;
        const ccb = state.clientCardBalance;
        const cct = state.clientCardType;
        const newEspBalance = typeof data.balance === 'number' ? data.balance : null;
        const lastEspBalance = typeof state._lastEspBalance === 'number' ? state._lastEspBalance : null;
        if (cc && newEspBalance !== null && lastEspBalance !== null && lastEspBalance > newEspBalance + 0.001) {
          const delta = Math.round((lastEspBalance - newEspBalance) * 100) / 100;
          const cardBal = typeof ccb === 'number' ? ccb : 0;
          if (delta > 0.001 && delta <= cardBal + 0.01) {
            debitCardForPost(postId, delta).catch((e) => console.warn(`[Post ${postId}] debit: ${e.message}`));
          }
        }
        Object.assign(state, data, { lastSeen: Date.now() });
        state.clientCard = cc;
        state.clientCardBalance = ccb;
        state.clientCardType = cct;
        state._lastEspBalance = newEspBalance;
        if (cc) state.balance = typeof ccb === 'number' ? ccb : 0;
      } catch { /* ignore */ }
    }

    if (/^posts\/[^/]+\/lwt$/.test(topic)) {
      const postId = topic.split('/')[1];
      const status = (payload || '').trim().toLowerCase();
      const isOnline = (status === 'online');

      if (!postsState[postId]) postsState[postId] = {};
      postsState[postId].online = isOnline;

      if (!isOnline) {
        const state = postsState[postId];
        if (state && state.clientCard) {
          console.log(`📴 Пост ${postId} offline — освобождаем карту ${state.clientCard}`);
          delete state.clientCard;
          delete state.clientCardBalance;
          delete state.clientCardType;
          state._lastEspBalance = null;
          state.balance = 0;
          state.busy = false;
        }
      }
    }

    if (/^posts\/[^/]+\/clientcard$/.test(topic)) {
      const postId = topic.split('/')[1];
      try {
        const data = JSON.parse(payload);
        const cardNumber = (data.card || '').toString().trim().toUpperCase();
        if (!postsState[postId]) postsState[postId] = {};
        const state = postsState[postId];

        if (!cardNumber || cardNumber === 'NULL') {
          const hadCard = !!state.clientCard;
          delete state.clientCard;
          delete state.clientCardBalance;
          delete state.clientCardType;
          state._lastEspBalance = null;
          if (hadCard) {
            state.balance = 0;
            state.totalPaid = 0;
            state.receiptCount = 0;
            state.servicesUsage = {};
            state.elapsedSec = 0;
            state.busy = false;
            state.paused = false;
            state.currentProgram = null;
            if (state.timer) { clearInterval(state.timer); state.timer = null; }
            mqttClient.publish(`posts/${postId}/command`, JSON.stringify({ command: 'reset' }), { qos: 1 });
            publishStatus(postId);
            publishRelayStatus(postId);
          }
          mqttClient.publish(`posts/${postId}/message`, JSON.stringify({ "": "" }), { qos: 0 });
          return;
        }

        const busyPostId = findPostWithCard(cardNumber, postId);
        if (busyPostId) {
          delete state.clientCard;
          delete state.clientCardBalance;
          delete state.clientCardType;
          state._lastEspBalance = null;
          mqttClient.publish(`posts/${postId}/message`,
            JSON.stringify({ ERR: `КАРТА УЖЕ ИСПОЛЬЗУЕТСЯ НА ПОСТУ ${busyPostId}` }), { qos: 1 });
          broadcast({
            type: 'card-scan',
            postId, card: cardNumber, balance: 0, cardType: 'busy', known: false,
            error: `Карта уже используется на посту ${busyPostId}`,
            timestamp: Date.now(),
          });
          return;
        }

        const prevCard = state.clientCard;
        state.clientCard = cardNumber;
        const clientCard = await ClientCard.findOne({ card: cardNumber });
        if (!clientCard) {
          console.warn(`⚠️ Пост ${postId}: карта ${cardNumber} не найдена в БД`);
          delete state.clientCardBalance;
          delete state.clientCardType;
          state._lastEspBalance = null;
          broadcast({
            type: 'card-scan',
            postId, card: cardNumber, balance: 0, cardType: 'unknown', known: false,
            timestamp: Date.now(),
          });
          return;
        }

        state._lastEspBalance = null;
        const hasForeignBalance = !prevCard && typeof state.balance === 'number' && state.balance > 0.01;
        const switchingCard = prevCard && prevCard !== cardNumber;
        if (hasForeignBalance || switchingCard) {
          mqttClient.publish(`posts/${postId}/command`, JSON.stringify({ command: 'reset' }), { qos: 1 });
          await new Promise(r => setTimeout(r, 300));
        }

        state.clientCardBalance = clientCard.balance;
        state.clientCardType = clientCard.type;
        state.balance = clientCard.balance;

        mqttClient.publish(`posts/${postId}/clientcardbalance`,
          JSON.stringify({ card: clientCard.card, balance: clientCard.balance, type: clientCard.type }),
          { qos: 1 });
        mqttClient.publish(`posts/${postId}/message`, JSON.stringify({ "": "" }), { qos: 0 });
        publishStatus(postId);

        broadcast({
          type: 'card-scan',
          postId,
          card: clientCard.card,
          balance: clientCard.balance,
          cardType: clientCard.type,
          known: true,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error(`Ошибка обработки posts/${postId}/clientcard:`, err.message);
      }
    }

    if (topic === 'tank/levels') {
      try {
        const { tank, level } = JSON.parse(payload);
        if (settings.tankLevels && settings.tankLevels.hasOwnProperty(tank)) {
          const newLevel = Math.min(100, Math.max(0, Math.round(level)));
          if (settings.tankLevels[tank] !== newLevel) {
            settings.tankLevels[tank] = newLevel;
            mqttClient.publish('system/config', JSON.stringify(settings), { qos: 0 });
            saveSettings(settings).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    }

    if (topic === 'reports/request') {
      try {
        const { from, to, responseTopic } = JSON.parse(payload);
        if (!from || !to) return;
        const start = new Date(from);
        const end = new Date(to);
        const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
        const totalSum = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);
        const translatedReceipts = receipts.map(r => ({
          ...r.toObject(), items: translateReceiptItems(r.items)
        }));
        mqttClient.publish(responseTopic || 'reports/response',
          JSON.stringify({ totalSum, count: translatedReceipts.length, receipts: translatedReceipts }),
          { qos: 0 });
      } catch (err) {
        console.error('Ошибка MQTT-запроса отчёта:', err);
      }
    }
  });

  mqttClient.on('error', (err) => console.error('MQTT error:', err));
  mqttClient.on('close', () => console.warn('MQTT connection closed'));
}

function reconnectMqtt(newSettings) {
  mqttSettings = { ...mqttSettings, ...newSettings };
  connectMqtt(mqttSettings);
}

// ============================================================
// MongoDB / схемы
// ============================================================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://0.0.0.0:27017/carwash';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String, default: '' },
  email: { type: String, default: '' },
  role: { type: String, enum: ['admin', 'developer', 'operator'], default: 'operator' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

const shiftSchema = new mongoose.Schema({
  shiftNumber: { type: Number, required: true },
  shiftOpen: { type: Boolean, default: true },
  openedAt: { type: Date, default: Date.now },
  autoCloseAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
  cashier: { type: String, default: '' },
  autoClosed: { type: Boolean, default: false },
  fiscalShiftNumber: { type: Number, default: null },
  xReports: [{ timestamp: { type: Date, default: Date.now }, total: Number, count: Number, cashier: String }],
  zReport: {
    total: { type: Number, default: 0 }, count: { type: Number, default: 0 },
    generatedAt: { type: Date, default: null }, cashier: String
  }
});

const fiscalRegistrationSchema = new mongoose.Schema({
  registrationNumber: { type: String, required: true },
  inn: { type: String, required: true },
  fnNumber: { type: String, required: true },
  registeredAt: { type: Date, default: Date.now },
  validUntil: { type: Date, required: true }
});

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
});

const User = mongoose.model('User', userSchema);
const Counter = mongoose.model('Counter', counterSchema);
const Shift = mongoose.model('Shift', shiftSchema);
const FiscalRegistration = mongoose.model('FiscalRegistration', fiscalRegistrationSchema);
const Setting = mongoose.model('Setting', settingSchema);

initReceiptService({
  Counter,
  Shift,
  broadcastShiftTotal: (...a) => broadcastShiftTotal(...a),
  publishKkmStatus:    (...a) => publishKkmStatus(...a),
  ensureOpenShift:     (...a) => ensureOpenShift(...a),
});

// ---------- Настройки по умолчанию ----------
let settings = {
  numberOfPosts: 8,
  posts: {},
  tankLevels: { water: 80, foam: 65, wax: 45, teflon: 90, osmosis: 30 },
  tankLowThreshold: { water: 20, foam: 15, wax: 10, teflon: 25, osmosis: 10 },
  kkm: {
    enabled: process.env.KKM_ENABLED === 'true',
    mockReceipt: process.env.KKM_MOCK_RECEIPT === 'true',
    provider: process.env.KKM_PROVIDER || 'mock',
    atol: {
      login: process.env.ATOL_LOGIN || '', password: process.env.ATOL_PASSWORD || '',
      groupCode: process.env.ATOL_GROUP_CODE || '', inn: process.env.ATOL_INN || '000000000000',
      sno: process.env.ATOL_SNO || 'osn',
      paymentAddress: process.env.ATOL_PAYMENT_ADDRESS || 'https://carwash.ru',
      companyEmail: process.env.ATOL_COMPANY_EMAIL || 'company@carwash.ru',
      clientEmail: process.env.ATOL_CLIENT_EMAIL || 'client@carwash.ru'
    },
    shtrihLocal: { baseUrl: process.env.SHTRIH_LOCAL_URL || 'http://0.0.0.0:5001/api/kkm' }
  },
  kkmManual: { kkNumber: '', fiscalShiftNumber: null, cashierName: '' },
  pausePrice: 10,
  pauseFreeTimeSec: 120,
  mqtt: {
    local: { host: '192.168.31.211', portTcp: 1883, portWs: 8083, path: '/mqtt', username: 'admin', password: 'Zavulon56' },
    remote: { host: 'm2.wqtt.ru', portTcp: 13257, portTls: 13258, portWss: 13260, username: 'u_GGENLB', password: 'LTHNW22D' }
  }
};

// ============================================================
// Хелперы
// ============================================================
function buildServicesPayloadForPost(postId) {
  const p = settings.posts?.[postId] || {};
  const services = (p.services || []).filter(svc => svc.enabled !== false); // ← только активные
  const prices = p.prices || {};
  const relayMask = p.relayMask || {};
  const vfd = p.vfdFrequencies || {};
  const dimmer = p.dimmerMask || {};
  const buttons = p.buttonInputs || {};
  const delays = p.relayDelays || {};
  return services.map(svc => ({
    name: svc.name,
    price: prices[svc.name] ?? svc.price ?? 0,
    free_time_sec: svc.free_time_sec ?? 0,
    relayMask: relayMask[svc.name] ?? 0,
    dimmerMask: dimmer[svc.name] ?? 0,
    vfdFrequency: vfd[svc.name] ?? 40,
    onDelay: delays[svc.name]?.onDelay ?? 100,
    offDelay: delays[svc.name]?.offDelay ?? 200,
    buttonInput: buttons[svc.name] ?? 0,
    enabled: true,  // раз мы уже отфильтровали — все оставшиеся активны
  }));
}

function publishConfigToAllPosts() {
  if (!mqttClient) return;
  const n = settings.numberOfPosts || 8;
  for (let i = 1; i <= n; i++) {
    mqttClient.publish(`posts/${i}/config`,
      JSON.stringify({ services: buildServicesPayloadForPost(i) }), { qos: 1, retain: true });
  }
  console.log(`📤 Конфиг опубликован в posts/*/config (${n} постов)`);
}

async function fetchKkmStatusFromDriver() {
  try {
    const r = await axios.get(`${KKM_DRIVER_URL}/status`, { timeout: 2000 });
    return r.data || null;
  } catch (e) {
    return null;
  }
}

async function publishKkmStatus() {
  if (!mqttClient) return;

  const shift = await Shift.findOne({ shiftOpen: true }).lean();
  const driverData = await fetchKkmStatusFromDriver();

  if (driverData) {
    let changed = false;
    if (driverData.kkNumber && settings.kkmManual.kkNumber !== driverData.kkNumber) {
      settings.kkmManual.kkNumber = driverData.kkNumber;
      changed = true;
    }
    if (driverData.shiftNumber != null && settings.kkmManual.fiscalShiftNumber !== driverData.shiftNumber) {
      settings.kkmManual.fiscalShiftNumber = driverData.shiftNumber;
      changed = true;
    }
    if (driverData.cashierName && settings.kkmManual.cashierName !== driverData.cashierName) {
      settings.kkmManual.cashierName = driverData.cashierName;
      changed = true;
    }
    if (changed) saveSettings(settings).catch(() => {});
  }

  const payload = JSON.stringify({
    ready:              driverData ? !!driverData.ready       : true,
    connected:          driverData ? !!driverData.connected   : false,
    paper:              driverData ? !!driverData.paper       : true,
    kkNumber:           driverData?.kkNumber || settings.kkmManual.kkNumber || '',
    shiftNumber:        driverData?.shiftNumber ?? settings.kkmManual.fiscalShiftNumber ?? 0,
    cashier:            driverData?.cashierName || settings.kkmManual.cashierName || 'Оператор',
    shiftOpened:        !!shift,
    shiftOpenedAt:      shift?.openedAt || null,
    shiftAutoCloseAt:   shift?.autoCloseAt || null,
    currentShiftNumber: shift?.shiftNumber || 0,
    errors:             driverData?.errors || [],
    driverOnline:       !!driverData,
  });

  mqttClient.publish('kkm/status', payload, { qos: 0, retain: true });
  broadcast({ type: 'mqtt', topic: 'kkm/status', payload, timestamp: Date.now() });
}

async function broadcastShiftTotal() {
  const currentShift = await Shift.findOne({ shiftOpen: true });
  if (!currentShift) {
    const payload = JSON.stringify({ total: 0, count: 0 });
    broadcast({ type: 'mqtt', topic: 'shift/total', payload, timestamp: Date.now() });
    return;
  }
  const receipts = await Receipt.find({ timestamp: { $gte: currentShift.openedAt } });
  const total = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);
  const payload = JSON.stringify({ total, count: receipts.length });
  if (mqttClient) mqttClient.publish('shift/total', payload, { qos: 0 });
  broadcast({ type: 'mqtt', topic: 'shift/total', payload, timestamp: Date.now() });
}

async function saveSettings(newSettings) {
  try {
    await Setting.findOneAndUpdate({ key: 'main' }, { $set: { value: newSettings } }, { upsert: true });
    writeMqttConfigFile(newSettings);
  } catch (err) {
    console.error('Ошибка сохранения настроек:', err.message);
  }
}

async function loadSettings() {
  try {
    let doc = await Setting.findOne({ key: 'main' });
    const defaultServices = [
      { name: 'Вода', price: 30, free_time_sec: 0, enabled: true },
      { name: 'Пена', price: 40, free_time_sec: 0, enabled: true },
      { name: 'Воск', price: 50, free_time_sec: 0, enabled: true },
      { name: 'Тефлон', price: 60, free_time_sec: 0, enabled: true },
      { name: 'Осмос', price: 70, free_time_sec: 0, enabled: true },
      { name: 'Горячая вода', price: 35, free_time_sec: 0, enabled: true },
      { name: 'Вода+Пена', price: 45, free_time_sec: 0, enabled: true },
      { name: 'Турбо мойка', price: 80, free_time_sec: 0, enabled: true },
      { name: 'Антимошка', price: 80, free_time_sec: 0, enabled: true },
      { name: 'Воздух', price: 80, free_time_sec: 0, enabled: true },
      { name: 'Пылесос', price: 80, free_time_sec: 0, enabled: true },
      { name: 'Пауза', price: 10, free_time_sec: 120, enabled: true }
    ];
    if (!doc) {
      const posts = {};
      const n = settings.numberOfPosts || 8;
      for (let i = 1; i <= n; i++) {
        posts[i] = {
          prices: {}, relayMask: {}, vfdFrequencies: {}, dimmerMask: {},
          buttonInputs: {}, relayDelays: {},
          services: defaultServices.map(s => ({ ...s }))
        };
      }
      settings.posts = posts;
      doc = new Setting({ key: 'main', value: settings });
      await doc.save();
      console.log('Настройки созданы в БД');
    } else {
      settings = doc.value;
      if (!settings.posts) {
        const n = settings.numberOfPosts || 8;
        const posts = {};
        const services = settings.services || defaultServices;
        for (let i = 1; i <= n; i++) {
          posts[i] = {
            prices: settings.prices ? { ...settings.prices } : {},
            relayMask: settings.relayMask ? { ...settings.relayMask } : {},
            vfdFrequencies: settings.vfdFrequencies ? { ...settings.vfdFrequencies } : {},
            dimmerMask: settings.dimmerMask ? { ...settings.dimmerMask } : {},
            buttonInputs: settings.buttonInputs ? { ...settings.buttonInputs } : {},
            relayDelays: settings.relayDelays ? { ...settings.relayDelays } : {},
            services: services.map(s => ({ ...s }))
          };
        }
        settings.posts = posts;
        delete settings.prices; delete settings.relayMask; delete settings.vfdFrequencies;
        delete settings.dimmerMask; delete settings.buttonInputs; delete settings.relayDelays;
        delete settings.services;
        await saveSettings(settings);
      } else {
        const n = settings.numberOfPosts || 8;
        const defaultServices2 = settings.posts[1]?.services || defaultServices;
        for (let i = 1; i <= n; i++) {
          if (!settings.posts[i]) {
            settings.posts[i] = {
              prices: {}, relayMask: {}, vfdFrequencies: {}, dimmerMask: {},
              buttonInputs: {}, relayDelays: {}, services: defaultServices2.map(s => ({ ...s }))
            };
          } else if (!settings.posts[i].services) {
            settings.posts[i].services = defaultServices2.map(s => ({ ...s }));
          }
          // ★ ИСПРАВЛЕНО: было s.enable !== undefined ? s.enable : true
          settings.posts[i].services = settings.posts[i].services.map(s => ({
            ...s, enabled: s.enabled !== false
          }));
        }
        await saveSettings(settings);
      }
      console.log('Настройки загружены из БД');
    }
    if (settings.mqtt) {
      mqttSettings = settings.mqtt;
      connectMqtt(mqttSettings);
    } else {
      connectMqtt({ brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883' });
    }
    writeMqttConfigFile(settings);
    publishConfigToAllPosts();
    await publishKkmStatus();
  } catch (err) {
    console.warn('Не удалось загрузить настройки из БД:', err.message);
  }
}

// ============================================================
// Состояние постов
// ============================================================
let postsState = {};

function getPostState(postId) {
  if (!postsState[postId]) {
    postsState[postId] = {
      busy: false, paused: false, balance: 0, currentProgram: null,
      elapsedSec: 0, totalPaid: 0, receiptCount: 0, servicesUsage: {}, timer: null
    };
  }
  return postsState[postId];
}

function findPostWithCard(cardNumber, excludePostId = null) {
  if (!cardNumber) return null;
  const target = String(cardNumber).toUpperCase();
  for (const [id, st] of Object.entries(postsState)) {
    if (excludePostId && id === excludePostId) continue;
    if (st && st.clientCard === target) return id;
  }
  return null;
}

function findService(postId, name) {
  const p = settings.posts?.[postId];
  if (p && p.services) {
    // ★ ИСПРАВЛЕНО: было s.enable !== false
    return p.services.find(s => s.name.toLowerCase() === name.toLowerCase() && s.enabled !== false);
  }
  if (settings.services) {
    return settings.services.find(s => s.name.toLowerCase() === name.toLowerCase() && s.enabled !== false);
  }
  return null;
}

function publishStatus(postId) {
  if (!mqttClient) return;
  const state = getPostState(postId);
  mqttClient.publish(`posts/${postId}/status`, JSON.stringify({
    busy: state.busy, paused: state.paused,
    balance: Math.round(state.balance * 100) / 100,
    currentProgram: state.currentProgram,
    elapsedSec: Math.round(state.elapsedSec * 100) / 100,
    totalPaid: Math.round(state.totalPaid * 100) / 100,
    receiptCount: state.receiptCount
  }), { qos: 0 });
}

function publishRelayStatus(postId) {
  if (!mqttClient) return;
  const state = getPostState(postId);
  mqttClient.publish(`posts/${postId}/status_relay`,
    JSON.stringify({ busy: state.busy, relayMask: state.busy ? 1 : 0 }), { qos: 0 });
}

async function debitCardForPost(postId, amountRub) {
  const state = postsState[postId];
  if (!state || !state.clientCard) return;
  const amount = Math.round(amountRub * 100) / 100;
  if (amount <= 0) return;
  const card = await ClientCard.findOne({ card: state.clientCard });
  if (!card) return;
  const actual = Math.min(amount, card.balance);
  if (actual <= 0.001) return;
  card.balance = Math.round((card.balance - actual) * 100) / 100;
  if (card.balance < 0) card.balance = 0;
  await card.save();
  state.clientCardBalance = card.balance;
  state.balance = card.balance;
  console.log(`💳 [Post ${postId}] Списано ${actual.toFixed(2)} ₽ с ${card.card}`);
}

function startTimer(postId) {
  const state = getPostState(postId);
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (!state.busy || state.paused) return;
    if (state.clientCard) return;
    const service = findService(postId, state.currentProgram);
    if (!service) { stopPost(postId, true, false); return; }
    const pricePerSec = service.price / 60;
    const deltaSec = 1;
    const cost = pricePerSec * deltaSec;
    if (state.balance >= cost) {
      state.balance -= cost;
      state.elapsedSec += deltaSec;
      if (!state.servicesUsage[service.name]) state.servicesUsage[service.name] = { seconds: 0, cost: 0 };
      state.servicesUsage[service.name].seconds += deltaSec;
      state.servicesUsage[service.name].cost += cost;
      state.balance = Math.round(state.balance * 100) / 100;
      publishStatus(postId);
    } else {
      const remaining = state.balance;
      if (remaining > 0.001) {
        const fractionSec = remaining / pricePerSec;
        state.balance = 0;
        state.elapsedSec += fractionSec;
        if (!state.servicesUsage[service.name]) state.servicesUsage[service.name] = { seconds: 0, cost: 0 };
        state.servicesUsage[service.name].seconds += fractionSec;
        state.servicesUsage[service.name].cost += remaining;
      }
      stopPost(postId, true, true);
    }
  }, 1000);
}

function handleProgram(postId, programName) {
  const state = getPostState(postId);
  const service = findService(postId, programName);
  if (!service) return;
  if (state.busy) stopPost(postId, false, false);
  const pricePerSec = service.price / 60;
  if (state.balance < pricePerSec && state.balance < 0.01) return;
  if (state.timer) clearInterval(state.timer);
  state.busy = true; state.paused = false; state.currentProgram = service.name;
  state.elapsedSec = 0; state.servicesUsage = {};
  startTimer(postId);
  publishStatus(postId); publishRelayStatus(postId);
}

function stopPost(postId, publish = true, printReceiptFlag = false) {
  const state = getPostState(postId);
  if (!state.busy && !printReceiptFlag) return;
  if (printReceiptFlag && Object.keys(state.servicesUsage).length > 0) printReceipt(postId);
  if (state.timer) clearInterval(state.timer);
  state.timer = null; state.busy = false; state.paused = false;
  state.currentProgram = null; state.elapsedSec = 0;
  if (publish) { publishStatus(postId); publishRelayStatus(postId); }
}

function togglePause(postId) {
  const state = getPostState(postId);
  if (!state.busy) return;
  const pauseService = findService(postId, 'Пауза');
  if (pauseService) {
    if (state.currentProgram === 'Пауза') stopPost(postId, true, false);
    else { stopPost(postId, false, false); handleProgram(postId, 'Пауза'); }
  } else stopPost(postId, true, false);
}

function addBalance(postId, amount) {
  const state = getPostState(postId);
  state.balance = Math.round((state.balance + amount) * 100) / 100;
  state.totalPaid = Math.round((state.totalPaid + amount) * 100) / 100;
  publishStatus(postId);
}

function resetPost(postId) {
  const state = getPostState(postId);
  if (state.timer) clearInterval(state.timer);
  postsState[postId] = {
    busy: false, paused: false, balance: 0, currentProgram: null,
    elapsedSec: 0, totalPaid: 0, receiptCount: 0, servicesUsage: {}, timer: null
  };
  publishStatus(postId); publishRelayStatus(postId);
}

function printReceipt(postId) {
  const state = getPostState(postId);
  const items = []; let totalCost = 0;
  for (const [name, usage] of Object.entries(state.servicesUsage)) {
    if (usage.seconds > 0.001) {
      items.push({
        name, seconds: Math.round(usage.seconds * 1000) / 1000,
        cost: Math.round(usage.cost * 100) / 100,
        pricePerSecond: Math.round((usage.cost / usage.seconds) * 100) / 100
      });
      totalCost += usage.cost;
    }
  }
  if (!items.length || totalCost < 0.01) return;

  const balanceAfter = Math.round(state.balance * 100) / 100;

  Receipt.findOne({ postId: Number(postId), isAdvance: true })
    .sort({ timestamp: -1 })
    .lean()
    .then(advance => {
      const advanceReceiptNumber = advance?.receiptNumber || null;
      mqttClient.publish('kkm/print', JSON.stringify({
        postId: parseInt(postId),
        timestamp: new Date().toISOString(),
        operation: 'Финальный чек по сессии',
        kind: 'final',
        isAdvance: false,
        advanceReceiptNumber,
        items,
        balance: balanceAfter,
      }), { qos: 1 });
      state.servicesUsage = {};
      state.receiptCount++;
      publishStatus(postId);
    })
    .catch(err => {
      console.error(`[Post ${postId}] printReceipt: ${err.message}`);
      mqttClient.publish('kkm/print', JSON.stringify({
        postId: parseInt(postId),
        timestamp: new Date().toISOString(),
        operation: 'Финальный чек по сессии',
        kind: 'final',
        items,
        balance: balanceAfter,
      }), { qos: 1 });
      state.servicesUsage = {};
      state.receiptCount++;
      publishStatus(postId);
    });
}

const programNamesRu = {
  water: 'Вода', foam: 'Пена', wax: 'Воск', teflon: 'Тефлон',
  osmosis: 'Осмос', hotWater: 'Горячая вода',
  waterFoam: 'Вода+Пена', turbo: 'Турбо мойка'
};

function translateReceiptItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => ({
    name: programNamesRu[item.name] || item.name || '?',
    seconds: Number(item.seconds) || 0,
    cost: Number(item.cost) || 0,
    pricePerSecond: Number(item.pricePerSecond) || 0
  }));
}

async function getNextReceiptNumber() {
  const c = await Counter.findOneAndUpdate({ _id: 'receiptNumber' }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return c.seq;
}

async function getNextShiftNumber() {
  const c = await Counter.findByIdAndUpdate('shiftNumber', { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}

// ============================================================
// Смена
// ============================================================
function getShiftAutoCloseAt(openedAt) {
  const dt = new Date(openedAt);
  dt.setHours(dt.getHours() + 24);
  return dt;
}

async function closeExpiredShiftIfNeeded() {
  const shift = await Shift.findOne({ shiftOpen: true });
  if (!shift) return null;

  const autoCloseAt = shift.autoCloseAt || getShiftAutoCloseAt(shift.openedAt);
  if (new Date() < autoCloseAt) return shift;

  const closedAt = new Date();
  shift.shiftOpen = false;
  shift.closedAt = closedAt;
  shift.autoClosed = true;

  const receipts = await Receipt.find({
    timestamp: { $gte: shift.openedAt, $lte: closedAt }
  });
  const total = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);
  shift.zReport = {
    total,
    count: receipts.length,
    generatedAt: closedAt,
    cashier: 'system (auto)'
  };
  await shift.save();
  console.log(`♻️ Смена №${shift.shiftNumber} автозакрыта (прошло 24 часа)`);

  const nextNumber = await getNextShiftNumber();
  const openedAt = new Date();
  const newShift = await Shift.create({
    shiftNumber: nextNumber,
    shiftOpen: true,
    openedAt,
    autoCloseAt: getShiftAutoCloseAt(openedAt),
    cashier: 'system (auto)',
  });
  console.log(`♻️ Открыта новая смена №${nextNumber}`);

  await publishKkmStatus();
  await broadcastShiftTotal();
  return newShift;
}

async function ensureOpenShift() {
  await closeExpiredShiftIfNeeded();

  let shift = await Shift.findOne({ shiftOpen: true });
  if (shift) return shift;

  const nextNumber = await getNextShiftNumber();
  const openedAt = new Date();
  shift = await Shift.create({
    shiftNumber: nextNumber,
    shiftOpen: true,
    openedAt,
    autoCloseAt: getShiftAutoCloseAt(openedAt),
    cashier: 'system (auto)',
  });
  console.log(`♻️ Смена №${nextNumber} автоматически открыта перед печатью чека`);

  await publishKkmStatus();
  return shift;
}

async function initShift() {
  await Shift.deleteMany({ shiftNumber: { $exists: false } });
  let currentShift = await Shift.findOne({ shiftOpen: true });
  if (!currentShift) {
    const nextNumber = await getNextShiftNumber();
    const openedAt = new Date();
    await new Shift({
      shiftNumber: nextNumber,
      shiftOpen: true,
      openedAt,
      autoCloseAt: getShiftAutoCloseAt(openedAt),
      cashier: 'system',
    }).save();
    console.log(`✅ Смена №${nextNumber} создана`);
  } else if (!currentShift.autoCloseAt) {
    currentShift.autoCloseAt = getShiftAutoCloseAt(currentShift.openedAt);
    await currentShift.save();
  }
}

// ============================================================
// Middleware
// ============================================================
app.use(cors());
app.use(express.json());

app.locals.publishCardBalanceToPosts = async function (cardNumber) {
  if (!mqttClient || !cardNumber) return;
  try {
    const normalized = String(cardNumber).toUpperCase();
    const clientCard = await ClientCard.findOne({ card: normalized });
    if (!clientCard) return;
    const postsWithCard = [];
    for (const [id, st] of Object.entries(postsState)) {
      if (st && st.clientCard === clientCard.card) {
        st.clientCardBalance = clientCard.balance;
        st.clientCardType = clientCard.type;
        st.balance = clientCard.balance;
        postsWithCard.push(id);
      }
    }
    if (!postsWithCard.length) return;
    const payload = JSON.stringify({ card: clientCard.card, balance: clientCard.balance, type: clientCard.type });
    for (const postId of postsWithCard) {
      mqttClient.publish(`posts/${postId}/clientcardbalance`, payload, { qos: 1 });
      publishStatus(postId);
      broadcast({
        type: 'card-balance',
        postId,
        card: clientCard.card,
        balance: clientCard.balance,
        cardType: clientCard.type,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    console.error('publishCardBalanceToPosts error:', err.message);
  }
};

app.locals.createReceipt = createReceipt;
app.locals.addBalance = (postId, amount) => addBalance(String(postId), amount);

app.use('/api/cards', cardsRouter);

// ---------- Auth ----------
function auth(req, res, next) {
  const header = req.headers.authorization?.split(' ')[1];
  const query  = typeof req.query.token === 'string' ? req.query.token : null;
  const token  = header || query;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secretkey');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'developer') {
    return res.status(403).json({ error: 'Admin required' });
  }
  next();
}

// ---------- Init users ----------
(async () => {
  try {
    const defaults = [
      { username: 'admin', password: 'admin123', role: 'admin', fullName: 'Администратор Системы', email: 'admin@carwash.local' },
      { username: 'dev', password: 'dev123', role: 'developer', fullName: 'Разработчик Системы', email: 'dev@carwash.local' },
      { username: 'operator', password: 'operator123', role: 'operator', fullName: 'Оператор Смены', email: 'operator@carwash.local' }
    ];
    for (const u of defaults) {
      if (!(await User.findOne({ username: u.username }))) {
        await User.create({ ...u, password: await bcrypt.hash(u.password, 10), isActive: true });
        console.log(`✅ Пользователь создан: ${u.username}/${u.password} (${u.role})`);
      }
    }
  } catch (err) {
    console.warn('MongoDB не доступна — пользователи в памяти:', err.message);
  }
})();

const memoryUsers = [
  { username: 'admin', passwordHash: bcrypt.hashSync('admin123', 10), role: 'admin', fullName: 'Администратор Системы', email: 'admin@carwash.local' },
  { username: 'dev', passwordHash: bcrypt.hashSync('dev123', 10), role: 'developer', fullName: 'Разработчик Системы', email: 'dev@carwash.local' },
  { username: 'operator', passwordHash: bcrypt.hashSync('operator123', 10), role: 'operator', fullName: 'Оператор Смены', email: 'operator@carwash.local' }
];

async function findUser(username) {
  try {
    if (mongoose.connection.readyState === 1) return await User.findOne({ username });
    return memoryUsers.find(u => u.username === username);
  } catch {
    return memoryUsers.find(u => u.username === username);
  }
}

// ---------- Users API ----------
app.get('/api/users', auth, adminOnly, async (_req, res) => {
  try {
    const users = await User.find({}, { password: 0 }).lean();
    res.json(users.map(u => ({
      _id: u._id, login: u.username,
      fullName: u.fullName || u.username,
      email: u.email || `${u.username}@carwash.local`,
      role: u.role,
      group: u.role === 'admin' ? 'Администратор'
           : u.role === 'developer' ? 'Разработчик'
           : u.role === 'operator' ? 'Оператор' : 'Пользователь',
      isActive: u.isActive !== false,
      createdAt: u.createdAt
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  const { login, password, fullName, email, role } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'login и password обязательны' });
  if (!['admin', 'developer', 'operator'].includes(role)) return res.status(400).json({ error: 'Недопустимая роль' });
  try {
    if (await User.findOne({ username: login })) return res.status(409).json({ error: 'Пользователь уже существует' });
    const created = await User.create({
      username: login, password: await bcrypt.hash(password, 10),
      fullName: fullName || login, email: email || '', role, isActive: true
    });
    res.status(201).json({
      _id: created._id, login: created.username, fullName: created.fullName,
      email: created.email, role: created.role, isActive: created.isActive
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/users/:id', auth, adminOnly, async (req, res) => {
  const { fullName, email, role, password, isActive } = req.body || {};
  const update = {};
  if (typeof fullName === 'string') update.fullName = fullName;
  if (typeof email === 'string') update.email = email;
  if (typeof role === 'string' && ['admin','developer','operator'].includes(role)) update.role = role;
  if (typeof isActive === 'boolean') update.isActive = isActive;
  if (password) update.password = await bcrypt.hash(password, 10);
  try {
    const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({
      _id: updated._id, login: updated.username, fullName: updated.fullName,
      email: updated.email, role: updated.role, isActive: updated.isActive
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Login ----------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await findUser(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  let valid;
  if (mongoose.connection.readyState === 1 && user.passwordHash === undefined) {
    valid = await bcrypt.compare(password, user.password);
  } else {
    valid = bcrypt.compareSync(password, user.passwordHash || user.password);
  }
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username, role: user.role }, process.env.JWT_SECRET || 'secretkey', { expiresIn: '24h' });
  res.json({ token, role: user.role });
});

// ---------- Posts ----------
app.get('/api/posts', auth, (_req, res) => {
  try {
    const n = (typeof settings.numberOfPosts === 'number' && settings.numberOfPosts > 0) ? settings.numberOfPosts : 8;
    const result = {};
    for (let i = 1; i <= n; i++) {
      const id = String(i);
      const state = postsState[id];
      if (state) {
        const { timer, _lastEspBalance, ...safeState } = state;
        if (safeState.clientCard && typeof safeState.clientCardBalance === 'number') {
          safeState.balance = safeState.clientCardBalance;
        }
        result[id] = safeState;
      } else result[id] = { busy: false };
    }
    res.json(result);
  } catch (err) {
    console.error('❌ /api/posts:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------- Settings ----------
app.get('/api/settings', (_req, res) => res.json(settings));

app.put('/api/settings', auth, adminOnly, async (req, res) => {
  try {
    const newSettings = req.body;
    if (newSettings.prices || newSettings.relayMask || newSettings.vfdFrequencies ||
        newSettings.dimmerMask || newSettings.buttonInputs || newSettings.relayDelays ||
        newSettings.services) {
      const n = newSettings.numberOfPosts || settings.numberOfPosts || 8;
      const posts = {};
      const services = newSettings.services || settings.posts?.[1]?.services || [];
      for (let i = 1; i <= n; i++) {
        posts[i] = {
          prices: newSettings.prices ? { ...newSettings.prices } : {},
          relayMask: newSettings.relayMask ? { ...newSettings.relayMask } : {},
          vfdFrequencies: newSettings.vfdFrequencies ? { ...newSettings.vfdFrequencies } : {},
          dimmerMask: newSettings.dimmerMask ? { ...newSettings.dimmerMask } : {},
          buttonInputs: newSettings.buttonInputs ? { ...newSettings.buttonInputs } : {},
          relayDelays: newSettings.relayDelays ? { ...newSettings.relayDelays } : {},
          // ★ ИСПРАВЛЕНО: было s.enable !== undefined ? s.enable : true
          services: services.map(s => ({ ...s, enabled: s.enabled !== false }))
        };
      }
      newSettings.posts = posts;
      delete newSettings.prices; delete newSettings.relayMask; delete newSettings.vfdFrequencies;
      delete newSettings.dimmerMask; delete newSettings.buttonInputs; delete newSettings.relayDelays;
      delete newSettings.services;
    }
    settings = { ...settings, ...newSettings };
    if (newSettings.posts) {
      for (const [postId, postData] of Object.entries(newSettings.posts)) {
        if (!settings.posts[postId]) settings.posts[postId] = {};
        settings.posts[postId] = { ...settings.posts[postId], ...postData };
        if (settings.posts[postId].services) {
          // ★ ИСПРАВЛЕНО: было s.enable !== undefined ? s.enable : true
          settings.posts[postId].services = settings.posts[postId].services.map(s => ({
            ...s, enabled: s.enabled !== false
          }));
        }
      }
    }
    await saveSettings(settings);
    publishConfigToAllPosts();
    if (mqttClient) mqttClient.publish('system/config', JSON.stringify(settings), { qos: 0 });
    res.json(settings);
  } catch (err) {
    console.error('❌ PUT /api/settings:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/publish-config', auth, adminOnly, (_req, res) => {
  try { publishConfigToAllPosts(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Команды постов ----------
app.post('/api/posts/:postId/command', auth, adminOnly, (req, res) => {
  if (!mqttClient) {
    console.error(`❌ /api/posts/${req.params.postId}/command: mqttClient не подключён`);
    return res.status(503).json({ error: 'MQTT не подключён' });
  }
  const { command } = req.body || {};
  if (!command) return res.status(400).json({ error: 'command обязателен' });
  try {
    mqttClient.publish(
      `posts/${req.params.postId}/command`,
      JSON.stringify({ command }),
      { qos: 1 },
    );
    console.log(`📤 [API] posts/${req.params.postId}/command → ${command}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ publish error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Пополнение поста (АВАНС) ----------
app.post('/api/posts/:postId/topup', auth, async (req, res) => {
  const postId = String(req.params.postId);
  const amount = Number(req.body?.amount);
  const paymentMethod = req.body?.paymentMethod || null;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Сумма должна быть положительным числом' });
  }
  if (!['cash', 'card_terminal', 'client_card'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Недопустимый способ оплаты' });
  }

  try {
    const n = settings.numberOfPosts || 8;
    if (Number(postId) < 1 || Number(postId) > n) {
      return res.status(404).json({ error: `Пост ${postId} не найден` });
    }

    addBalance(postId, amount);
    const state = getPostState(postId);

    const receipt = await createReceipt({
      postId:        Number(postId),
      kind:          'advance_post',
      operation:     'topup',
      isAdvance:     true,
      items:         [{ name: 'Аванс: пополнение поста', seconds: 0, cost: amount, pricePerSecond: 0 }],
      totalCost:     amount,
      balanceAfter:  state.balance,
      paymentMethod,
    });

    if (mqttClient) {
      mqttClient.publish(
        `posts/${postId}/receipt_number`,
        JSON.stringify({
          receiptNumber: receipt.receiptNumber,
          kind: 'advance_post',
          isAdvance: true,
          amount,
          paymentMethod,
          balanceAfter: state.balance,
          timestamp: new Date().toISOString(),
        }),
        { qos: 1, retain: true },
      );

      mqttClient.publish(
        `posts/${postId}/command`,
        JSON.stringify({ command: `add_balance ${amount}` }),
        { qos: 1 },
      );
    }

    res.json({
      ok: true,
      postId: Number(postId),
      amount,
      balance: state.balance,
      paymentMethod,
      receiptNumber: receipt.receiptNumber,
      kind: 'advance_post',
      isAdvance: true,
    });
  } catch (err) {
    console.error('Ошибка пополнения поста:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tank-levels', auth, adminOnly, async (req, res) => {
  const { tank, level } = req.body;
  if (settings.tankLevels?.hasOwnProperty(tank)) {
    settings.tankLevels[tank] = level;
    await saveSettings(settings);
    if (mqttClient) mqttClient.publish('system/config', JSON.stringify(settings), { qos: 0 });
    res.json({ ok: true });
  } else res.status(400).json({ error: 'Invalid tank name' });
});

// ---------- MQTT settings ----------
app.get('/api/mqtt/settings', auth, adminOnly, (_req, res) => res.json(settings.mqtt || {}));

app.post('/api/mqtt/settings', auth, adminOnly, async (req, res) => {
  try {
    const { local, remote, brokerUrl, username, password } = req.body || {};
    let newMqtt;
    if (local || remote) {
      newMqtt = {
        local: { host: local?.host ?? '192.168.31.211', portTcp: local?.portTcp ?? 1883,
                 portWs: local?.portWs ?? 8083, path: local?.path ?? '/mqtt',
                 username: local?.username ?? 'admin', password: local?.password ?? 'Zavulon56' },
        remote: { host: remote?.host ?? 'm2.wqtt.ru', portTcp: remote?.portTcp ?? 13257,
                  portTls: remote?.portTls ?? 13258, portWss: remote?.portWss ?? 13260,
                  username: remote?.username ?? 'u_GGENLB', password: remote?.password ?? 'LTHNW22D' }
      };
    } else if (brokerUrl) {
      newMqtt = { brokerUrl, username: username || '', password: password || '' };
    } else return res.status(400).json({ error: 'Укажите local/remote или brokerUrl' });
    settings.mqtt = newMqtt;
    await saveSettings(settings);
    reconnectMqtt(newMqtt);
    res.json({ ok: true, mqtt: newMqtt });
  } catch (err) {
    console.error('Ошибка MQTT settings:', err);
    res.status(500).json({ error: 'Ошибка обновления настроек MQTT' });
  }
});

// ============================================================
// KKM
// ============================================================
app.get('/api/kkm/status', auth, adminOnly, async (_req, res) => {
  try {
    const r = await axios.get(`${KKM_DRIVER_URL}/status`, { timeout: 2000 });
    res.json(r.data);
  } catch {
    res.json({
      ready: true, connected: false, paper: true,
      kkNumber: settings.kkmManual.kkNumber || null,
      shiftNumber: settings.kkmManual.fiscalShiftNumber || null,
      cashierName: settings.kkmManual.cashierName || null,
      errors: ['Драйвер ККМ не отвечает, используются ручные настройки'],
      driverOnline: false,
    });
  }
});

app.put('/api/kkm/manual', auth, adminOnly, async (req, res) => {
  const { kkNumber, fiscalShiftNumber, cashierName } = req.body;
  if (kkNumber !== undefined) settings.kkmManual.kkNumber = kkNumber;
  if (fiscalShiftNumber !== undefined) settings.kkmManual.fiscalShiftNumber = fiscalShiftNumber;
  if (cashierName !== undefined) settings.kkmManual.cashierName = cashierName;
  await saveSettings(settings);
  if (mqttClient) mqttClient.publish('system/config', JSON.stringify(settings), { qos: 0 });
  await publishKkmStatus();
  res.json(settings.kkmManual);
});

app.get('/api/kkm/current-shift', auth, adminOnly, async (_req, res) => {
  await closeExpiredShiftIfNeeded();
  const shift = await Shift.findOne({ shiftOpen: true }).sort({ shiftNumber: -1 });
  if (!shift) return res.json({ exists: false });
  res.json({
    shiftNumber:       shift.shiftNumber,
    cashier:           shift.cashier,
    openedAt:          shift.openedAt,
    autoCloseAt:       shift.autoCloseAt,
    fiscalShiftNumber: shift.fiscalShiftNumber,
    exists: true,
  });
});

app.get('/api/kkm/shift-status', auth, adminOnly, async (_req, res) => {
  const shift = await Shift.findOne({ shiftOpen: true });
  res.json({ shiftOpen: !!shift });
});

app.post('/api/kkm/open-shift', auth, adminOnly, async (req, res) => {
  await closeExpiredShiftIfNeeded();
  if (await Shift.findOne({ shiftOpen: true })) {
    return res.status(400).json({ error: 'Уже есть открытая смена' });
  }
  const nextNumber = await getNextShiftNumber();
  const openedAt = new Date();
  const newShift = await Shift.create({
    shiftNumber: nextNumber,
    shiftOpen: true,
    openedAt,
    autoCloseAt: getShiftAutoCloseAt(openedAt),
    cashier: req.user.username,
  });
  await publishKkmStatus();
  await broadcastShiftTotal();
  res.json({
    shiftNumber: newShift.shiftNumber,
    cashier:     newShift.cashier,
    openedAt:    newShift.openedAt,
    autoCloseAt: newShift.autoCloseAt,
  });
});

app.post('/api/kkm/close-shift', auth, adminOnly, async (_req, res) => {
  const shift = await Shift.findOne({ shiftOpen: true });
  if (!shift) return res.status(400).json({ error: 'Нет открытой смены' });

  const closedAt = new Date();
  shift.shiftOpen = false;
  shift.closedAt = closedAt;
  shift.autoClosed = false;

  const receipts = await Receipt.find({
    timestamp: { $gte: shift.openedAt, $lte: closedAt }
  });
  const total = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);
  shift.zReport = {
    total,
    count: receipts.length,
    generatedAt: closedAt,
    cashier: req.user.username,
  };
  await shift.save();

  await publishKkmStatus();
  await broadcastShiftTotal();
  res.json({ message: 'Смена закрыта', total, count: receipts.length });
});

app.get('/api/kkm/x-report', auth, adminOnly, async (req, res) => {
  const shift = await Shift.findOne({ shiftOpen: true });
  if (!shift) return res.status(404).json({ error: 'Нет открытой смены' });

  const receipts = await Receipt.find({ timestamp: { $gte: shift.openedAt } });
  const total = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);

  shift.xReports.push({
    timestamp: new Date(),
    total,
    count: receipts.length,
    cashier: req.user.username,
  });
  await shift.save();
  res.json({ message: 'X-отчёт', total, count: receipts.length });
});

app.post('/api/kkm/z-report', auth, adminOnly, async (req, res) => {
  const currentShift = await Shift.findOne({ shiftOpen: true });
  if (!currentShift) return res.status(400).json({ error: 'Нет открытой смены' });

  const closedAt = new Date();
  const receipts = await Receipt.find({
    timestamp: { $gte: currentShift.openedAt, $lte: closedAt }
  });
  const total = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);

  currentShift.zReport = {
    total,
    count: receipts.length,
    generatedAt: closedAt,
    cashier: req.user.username,
  };
  currentShift.shiftOpen = false;
  currentShift.closedAt = closedAt;
  await currentShift.save();

  const nextNumber = await getNextShiftNumber();
  const openedAt = new Date();
  const newShift = await Shift.create({
    shiftNumber: nextNumber,
    shiftOpen: true,
    openedAt,
    autoCloseAt: getShiftAutoCloseAt(openedAt),
    cashier: req.user.username,
  });

  await publishKkmStatus();
  await broadcastShiftTotal();

  res.json({
    message: 'Z-отчёт сформирован, смена закрыта',
    closed: { total, count: receipts.length },
    newShift: { shiftNumber: newShift.shiftNumber, openedAt: newShift.openedAt },
  });
});

app.get('/api/kkm/settings', auth, adminOnly, (_req, res) => res.json(settings.kkm));

app.get('/api/shift-total', auth, adminOnly, async (_req, res) => {
  const currentShift = await Shift.findOne({ shiftOpen: true });
  if (!currentShift) return res.json({ total: 0, count: 0 });
  const receipts = await Receipt.find({ timestamp: { $gte: currentShift.openedAt } });
  res.json({ total: receipts.reduce((s, r) => s + (r.totalCost || 0), 0), count: receipts.length });
});

app.get('/api/kkm/fiscal-registration', auth, adminOnly, async (_req, res) => {
  const reg = await FiscalRegistration.findOne();
  res.json(reg || {});
});

app.post('/api/kkm/fiscal-registration', auth, adminOnly, async (req, res) => {
  const { registrationNumber, inn, fnNumber, validUntil } = req.body || {};
  if (!registrationNumber || !inn || !fnNumber || !validUntil) return res.status(400).json({ error: 'Missing fields' });
  await FiscalRegistration.deleteMany({});
  res.json(await FiscalRegistration.create({ registrationNumber, inn, fnNumber, validUntil: new Date(validUntil) }));
});

app.post('/api/kkm/fiscal/open-shift', auth, adminOnly, (_req, res) => res.json({ ok: true }));
app.post('/api/kkm/fiscal/close-shift', auth, adminOnly, (_req, res) => res.json({ ok: true }));
app.get('/api/kkm/fiscal/x-report', auth, adminOnly, (_req, res) => res.json({ total: 0, count: 0 }));
app.post('/api/kkm/fiscal/z-report', auth, adminOnly, (_req, res) => res.json({ ok: true }));

// ============================================================
// Reports
// ============================================================
async function generatePDFReport(receipts, totalSum, fromDate, toDate) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    const buffers = [];
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const fontPathArial = path.join(__dirname, 'fonts', 'Arial.ttf');
    if (fs.existsSync(fontPathArial)) { doc.registerFont('MainFont', fontPathArial); doc.font('MainFont'); }
    else doc.font('Helvetica');

    doc.fontSize(18).text('Отчёт по кассовым чекам', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Период: ${fromDate} – ${toDate}`, { align: 'center' });
    doc.moveDown();
    doc.text(`Всего чеков: ${receipts.length}`);
    doc.text(`Общая сумма: ${(Number(totalSum) || 0).toFixed(2)} руб.`);
    doc.moveDown();

    const startX = 40;
    let y = doc.y + 10;
    const colWidths = [30, 35, 120, 50, 70, 205];
    const headers = ['№', 'Пост', 'Дата', 'Сумма', 'Оплата', 'Услуги'];
    const headerHeight = 25;

    function drawHeaders(yPos) {
      let x = startX;
      doc.fontSize(10);
      for (let i = 0; i < headers.length; i++) {
        doc.rect(x, yPos, colWidths[i], headerHeight).stroke();
        doc.text(headers[i], x + 5, yPos + 5, { width: colWidths[i] - 10 });
        x += colWidths[i];
      }
      return yPos + headerHeight;
    }

    y = drawHeaders(y);
    for (const receipt of receipts) {
      const itemsStr = (receipt.items || []).map(i =>
        `${i.name} (${(Number(i.seconds) || 0).toFixed(1)}с, ${(Number(i.cost) || 0).toFixed(2)}₽)`
      ).join(', ');
      const textHeight = doc.heightOfString(itemsStr, { width: colWidths[5] - 10 });
      const rowHeight = Math.max(20, textHeight + 10);
      if (y + rowHeight > doc.page.height - 50) { doc.addPage(); y = 50; y = drawHeaders(y); }
      let x = startX;
      const dateStr = new Date(receipt.timestamp).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      const cells = [
        String(receipts.indexOf(receipt) + 1),
        String(receipt.postId || ''),
        dateStr,
        (Number(receipt.totalCost) || 0).toFixed(2) + ' ₽',
        receipt.paymentMethod === 'cash' ? 'Наличные'
          : receipt.paymentMethod === 'card_terminal' ? 'Безнал'
          : receipt.paymentMethod === 'client_card' ? 'Карта' : '—',
        itemsStr
      ];
      for (let i = 0; i < cells.length; i++) {
        doc.rect(x, y, colWidths[i], rowHeight).stroke();
        doc.text(cells[i], x + 5, y + 5, { width: colWidths[i] - 10 });
        x += colWidths[i];
      }
      y += rowHeight;
    }
    doc.end();
  });
}

app.get('/api/reports/pdf', auth, adminOnly, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from и to обязательны' });

  const start = new Date(from);
  const end   = new Date(to);
  if (isNaN(start) || isNaN(end)) {
    return res.status(400).json({ error: 'Некорректные from/to' });
  }

  let receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  receipts = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const totalSum = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);

  const pdfData = await generatePDFReport(receipts, totalSum, from, to);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename=report_${String(from).slice(0,10)}_${String(to).slice(0,10)}.pdf`);
  res.send(pdfData);
});

app.get('/api/reports/day/:date', auth, adminOnly, async (req, res) => {
  const date = new Date(req.params.date);
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end   = new Date(date); end.setHours(23, 59, 59, 999);
  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  res.json({ totalSum: translated.reduce((s, r) => s + (r.totalCost || 0), 0), count: translated.length, receipts: translated });
});

app.get('/api/reports/week', auth, adminOnly, async (_req, res) => {
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - 7); start.setHours(0, 0, 0, 0);
  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  res.json({ totalSum: translated.reduce((s, r) => s + (r.totalCost || 0), 0), count: translated.length, receipts: translated });
});

app.get('/api/reports/month', auth, adminOnly, async (_req, res) => {
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - 30); start.setHours(0, 0, 0, 0);
  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  res.json({ totalSum: translated.reduce((s, r) => s + (r.totalCost || 0), 0), count: translated.length, receipts: translated });
});

app.get('/api/reports/shift', auth, adminOnly, async (_req, res) => {
  const currentShift = await Shift.findOne({ shiftOpen: true });
  if (!currentShift) return res.json({ totalSum: 0, count: 0, receipts: [] });
  const start = new Date(currentShift.openedAt);
  const end = new Date();
  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  res.json({ totalSum: translated.reduce((s, r) => s + (r.totalCost || 0), 0), count: translated.length, receipts: translated });
});

app.get('/api/reports/range', auth, adminOnly, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from и to обязательны' });

  const start = new Date(from);
  const end   = new Date(to);
  if (isNaN(start) || isNaN(end)) {
    return res.status(400).json({ error: 'Некорректные from/to' });
  }

  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const summary = {
    totalSum: translated.reduce((s, r) => s + (r.totalCost || 0), 0),
    count: translated.length,
    receipts: translated,
  };
  if (mqttClient) mqttClient.publish('reports/output', JSON.stringify(summary), { qos: 0 });
  res.json(summary);
});

app.get('/api/reports/grouped', auth, adminOnly, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from и to обязательны' });

  const start = new Date(from);
  const end   = new Date(to);
  if (isNaN(start) || isNaN(end)) {
    return res.status(400).json({ error: 'Некорректные from/to' });
  }

  const receipts = await Receipt.find({
    timestamp: { $gte: start, $lte: end }
  }).sort({ timestamp: 1 }).lean();

  const PAY_LABELS = {
    cash:          'Наличные',
    card_terminal: 'Карта',
    client_card:   'Карта клиента',
  };

  const days = {};
  let grandTotal = 0;
  let grandCount = 0;

  for (const r of receipts) {
    const dt = new Date(r.timestamp);
    const dayKey =
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

    const pm = PAY_LABELS[r.paymentMethod] || 'Прочее';
    const postId = r.postId;
    const totalCost = Number(r.totalCost) || 0;

    if (!days[dayKey]) {
      days[dayKey] = { date: dayKey, posts: {}, total: 0, count: 0 };
    }
    const d = days[dayKey];

    if (!d.posts[postId]) {
      d.posts[postId] = { postId, paymentMethods: {}, total: 0, count: 0 };
    }
    const p = d.posts[postId];

    if (!p.paymentMethods[pm]) {
      p.paymentMethods[pm] = { paymentMethod: pm, receipts: [], total: 0, count: 0 };
    }
    const pmGroup = p.paymentMethods[pm];

    const items = (r.items || []).map(it => {
      const cost  = Number(it.cost)    || 0;
      const secs  = Number(it.seconds) || 0;
      const price = Number(it.pricePerSecond)
                    || (secs > 0 ? Math.round((cost / secs) * 10000) / 10000 : 0);

      return {
        name:           programNamesRu[it.name] || it.name || '—',
        pricePerSecond: price,
        quantity:       Math.round(secs * 10) / 10,
        unit:           'секунда',
        timeWorkedSec:  Math.round(secs * 10) / 10,
        sum:            Math.round(cost * 100) / 100,
      };
    });

    const receipt = {
      receiptNumber: r.receiptNumber,
      date:          r.timestamp,
      postId,
      paymentMethod: pm,
      kind:          r.kind || 'session',
      isAdvance:     !!r.isAdvance,
      advanceReceiptNumber: r.advanceReceiptNumber ?? null,
      total:         Math.round(totalCost * 100) / 100,
      items,
    };

    pmGroup.receipts.push(receipt);
    pmGroup.total += totalCost;
    pmGroup.count += 1;

    p.total += totalCost;
    p.count += 1;

    d.total += totalCost;
    d.count += 1;

    grandTotal += totalCost;
    grandCount += 1;
  }

  const resultDays = Object.values(days).map(d => ({
    date:  d.date,
    total: Math.round(d.total * 100) / 100,
    count: d.count,
    posts: Object.values(d.posts).map(p => ({
      postId: p.postId,
      total:  Math.round(p.total * 100) / 100,
      count:  p.count,
      paymentMethods: Object.values(p.paymentMethods).map(pm => ({
        paymentMethod: pm.paymentMethod,
        total: Math.round(pm.total * 100) / 100,
        count: pm.count,
        receipts: pm.receipts,
      })),
    })),
  }));

  res.json({
    from, to,
    grandTotal: Math.round(grandTotal * 100) / 100,
    grandCount,
    days: resultDays,
  });
});

app.post('/api/receipts', async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.postId || !Array.isArray(d.items) || !d.items.length) {
      return res.status(400).json({ error: 'postId и items обязательны' });
    }
    const receipt = await createReceipt({
      postId:        d.postId,
      kind:          d.kind || 'session',
      operation:     d.operation || 'sell',
      isAdvance:     !!d.isAdvance,
      advanceReceiptNumber: d.advanceReceiptNumber ?? null,
      items:         d.items,
      totalCost:     d.totalCost,
      balanceAfter:  d.balance,
      paymentMethod: d.paymentMethod || null,
      discountTotal: d.discountTotal || 0,
      correctionInfo: d.correctionInfo || null,
      timestamp:     d.timestamp,
    });
    res.status(201).json({ message: 'Чек сохранён', id: receipt._id, receiptNumber: receipt.receiptNumber });
  } catch (err) {
    console.error('Ошибка сохранения чека:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/cards/:card/release', auth, adminOnly, (req, res) => {
  const cardNumber = req.params.card.toUpperCase();
  let released = false;
  for (const [id, st] of Object.entries(postsState)) {
    if (st && st.clientCard === cardNumber) {
      delete st.clientCard; delete st.clientCardBalance; delete st.clientCardType;
      st._lastEspBalance = null;
      released = true;
      console.log(`🔓 [${id}] Карта ${cardNumber} освобождена`);
    }
  }
  res.json({ ok: true, released });
});

// ============================================================
// Start
// ============================================================
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await loadSettings();
    await initShift();

    setInterval(async () => {
      try { await closeExpiredShiftIfNeeded(); } catch (e) { /* ignore */ }
    }, 60_000);

    setInterval(async () => {
      try { await publishKkmStatus(); } catch (e) { /* ignore */ }
    }, 10_000);

    server.listen(process.env.PORT || 3000, process.env.HOST || '0.0.0.0', () => {
      console.log(`REST API listening on http://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}`);
      console.log(`WebSocket listening on ws://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}/ws`);
    });
  })
  .catch(err => {
    console.warn('MongoDB not connected:', err.message);
    server.listen(process.env.PORT || 3000, process.env.HOST || '0.0.0.0', () => {
      console.log(`REST API listening on http://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}`);
      console.log(`WebSocket listening on ws://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}/ws`);
    });
  });