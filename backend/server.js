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
const ClientCard = require('./models/ClientCard');
const cardsRouter = require('./routes/cards');
require('dotenv').config();
require('./local-mqtt-broker');

// ---------- MQTT Client ----------
let mqttClient = null;
let mqttSettings = {
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  username: '',
  password: ''
};

// ---------- Запись mqtt-config.json для симуляторов ----------
function writeMqttConfigFile(settings) {
  try {
    const configPath = path.join(__dirname, '..', 'mqtt-config.json');
    const mqttConfig = {
      brokerUrl: settings.mqtt?.brokerUrl || process.env.MQTT_BROKER_URL || 'ws://localhost:8083',
      username: settings.mqtt?.username || '',
      password: settings.mqtt?.password || ''
    };
    fs.writeFileSync(configPath, JSON.stringify(mqttConfig, null, 2));
    console.log('✅ mqtt-config.json обновлён');
  } catch (err) {
    console.warn('⚠️ Не удалось сохранить mqtt-config.json:', err.message);
  }
}

function connectMqtt(settings) {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }

  const { brokerUrl, username, password } = settings;
  const options = {};
  if (username) options.username = username;
  if (password) options.password = password;

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
    mqttClient.subscribe('posts/+/lwt');         // NEW: LWT постов для освобождения карты

    if (settings.posts) {
      publishConfigToAllPosts();
    }
  });

  mqttClient.on('message', async (topic, message) => {
    const payload = message.toString();

    // ---------- Обработка чеков: kkm/print И posts/{id}/receipt ----------
    if (topic === 'kkm/print' || /^posts\/[^/]+\/receipt$/.test(topic)) {
      try {
        const receiptData = JSON.parse(payload);

        if (!receiptData.postId) {
          const m = topic.match(/^posts\/(\d+)\//);
          if (m) receiptData.postId = parseInt(m[1], 10);
        }

        let timestamp = receiptData.timestamp;
        if (!timestamp || timestamp === 'now' || isNaN(Date.parse(timestamp))) {
          timestamp = new Date();
        } else {
          timestamp = new Date(timestamp);
        }
        const totalCost = receiptData.items.reduce((sum, item) => sum + (item.cost || 0), 0);
        const roundedTotal = Math.round(totalCost * 10) / 10;
        const roundedItems = receiptData.items.map(item => ({
          ...item,
          seconds: Math.round((item.seconds || 0) * 10) / 10,
          cost: Math.round((item.cost || 0) * 10) / 10,
          pricePerSecond: Math.round(((item.cost || 0) / (item.seconds || 1)) * 10) / 10,
          discount: item.discount || 0
        }));

        const receiptNumber = await getNextReceiptNumber();
        const newReceipt = new Receipt({
          postId: receiptData.postId,
          receiptNumber: receiptNumber,
          timestamp: timestamp,
          operation: receiptData.operation || 'sell',
          items: roundedItems,
          totalCost: roundedTotal,
          balanceAfter: Math.round((receiptData.balance || 0) * 10) / 10,
          paymentMethod: receiptData.paymentMethod || null,
          discountTotal: receiptData.discountTotal || 0,
          correctionInfo: receiptData.correctionInfo || null,
          fiscalSent: false
        });
        await newReceipt.save();
        console.log(`✅ Чек №${receiptNumber} сохранён (payment=${newReceipt.paymentMethod || '—'})`);

        if (settings.kkm.enabled && !settings.kkm.mockReceipt) {
          console.log(`Отправка чека в ККТ (${settings.kkm.provider})`);
        }

        const currentShift = await Shift.findOne({ shiftOpen: true });
        if (currentShift) {
          const shiftReceipts = await Receipt.find({ timestamp: { $gte: currentShift.openedAt } });
          const total = shiftReceipts.reduce((sum, r) => sum + (r.totalCost || 0), 0);
          const count = shiftReceipts.length;
          mqttClient.publish('shift/total', JSON.stringify({ total, count }), { qos: 0 });
          console.log(`📊 Опубликована сумма за смену №${currentShift.shiftNumber}: ${total} руб. (${count} чеков)`);
        }
      } catch (err) {
        console.error(`Ошибка сохранения чека из ${topic}:`, err.message);
      }
    }

    // ---------- Команды постов ----------
    if (topic.startsWith('posts/') && topic.endsWith('/command')) {
      const parts = topic.split('/');
      const postId = parts[1];
      try {
        const commandObj = JSON.parse(payload);
        const command = commandObj.command;
        console.log(`📨 Пост ${postId}: ${command}`);
        if (command.startsWith('program ')) {
          const programName = command.substring(8).trim();
          handleProgram(postId, programName);
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
        } else {
          console.warn(`⚠️ Неизвестная команда для поста ${postId}: ${command}`);
        }
      } catch (e) {
        console.error(`Ошибка обработки команды для поста ${postId}:`, e.message);
      }
    }

    // ---------- Статусы постов + расчёт дебета карты ----------
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
        const lastEspBalance = typeof state._lastEspBalance === 'number'
          ? state._lastEspBalance
          : null;

        if (cc && newEspBalance !== null) {
          if (lastEspBalance !== null && lastEspBalance > newEspBalance + 0.001) {
            const delta = Math.round((lastEspBalance - newEspBalance) * 100) / 100;
            const cardBal = typeof ccb === 'number' ? ccb : 0;
            if (delta > 0.001 && delta <= cardBal + 0.01) {
              debitCardForPost(postId, delta).catch((e) =>
                console.warn(`[Post ${postId}] debitCardForPost error: ${e.message}`)
              );
            } else if (delta > cardBal + 0.01) {
              console.warn(
                `⚠️ [Post ${postId}] Пропущен большой дебет: delta=${delta}, ` +
                `остаток карты=${cardBal}`
              );
            }
          }
        }

        Object.assign(state, data, { lastSeen: Date.now() });
        state.clientCard = cc;
        state.clientCardBalance = ccb;
        state.clientCardType = cct;
        state._lastEspBalance = newEspBalance;

        if (cc) {
          state.balance = typeof ccb === 'number' ? ccb : 0;
        }
      } catch (e) {
        // не-JSON — игнорируем
      }
    }

    // ============================================================
    // LWT постов — освобождаем карту, если пост ушёл offline
    // ============================================================
    if (/^posts\/[^/]+\/lwt$/.test(topic)) {
      const postId = topic.split('/')[1];
      const status = (payload || '').trim().toLowerCase();

      if (status === 'offline') {
        const state = postsState[postId];
        if (state && state.clientCard) {
          console.log(
            `📴 Пост ${postId} offline — освобождаем карту ${state.clientCard}`
          );
          delete state.clientCard;
          delete state.clientCardBalance;
          delete state.clientCardType;
          state._lastEspBalance = null;
          state.balance = 0;
          state.busy = false;
        }
      }
    }

    // ---------- Карта клиента ----------
    if (/^posts\/[^/]+\/clientcard$/.test(topic)) {
      const postId = topic.split('/')[1];
      try {
        const data = JSON.parse(payload);
        const cardNumber = (data.card || '').toString().trim().toUpperCase();

        if (!postsState[postId]) postsState[postId] = {};
        const state = postsState[postId];

        // ---------- Снятие карты (NULL) ----------
        if (!cardNumber || cardNumber === 'NULL') {
          console.log(`ℹ️ Пост ${postId}: карта снята (NULL)`);
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

            mqttClient.publish(
              `posts/${postId}/command`,
              JSON.stringify({ command: 'reset' }),
              { qos: 1 }
            );
            publishStatus(postId);
            publishRelayStatus(postId);
            console.log(`🔄 [${postId}] Баланс поста сброшен вместе с картой`);
          }

          // Сбросить экран сообщений на этом посту
          mqttClient.publish(
            `posts/${postId}/message`,
            JSON.stringify({ "": "" }),
            { qos: 0 }
          );
          return;
        }

        // ============================================================
        // Проверяем, не занята ли карта на другом посту
        // ============================================================
        const busyPostId = findPostWithCard(cardNumber, postId);
        if (busyPostId) {
          console.warn(
            `⚠️ Карта ${cardNumber} уже используется на посту ${busyPostId} — ` +
            `отклоняем тап на посту ${postId}`
          );

          delete state.clientCard;
          delete state.clientCardBalance;
          delete state.clientCardType;
          state._lastEspBalance = null;

          mqttClient.publish(
            `posts/${postId}/message`,
            JSON.stringify({ ERR: `КАРТА УЖЕ ИСПОЛЬЗУЕТСЯ НА ПОСТУ ${busyPostId}` }),
            { qos: 1 }
          );
          return;
        }
        // ============================================================

        // ---------- Привязка карты ----------
        const prevCard = state.clientCard;
        state.clientCard = cardNumber;

        const clientCard = await ClientCard.findOne({ card: cardNumber });
        if (!clientCard) {
          console.warn(`⚠️ Пост ${postId}: карта ${cardNumber} не найдена в БД`);
          delete state.clientCardBalance;
          delete state.clientCardType;
          state._lastEspBalance = null;
          return;
        }

        state._lastEspBalance = null;

        const hasForeignBalance = !prevCard && typeof state.balance === 'number' && state.balance > 0.01;
        const switchingCard = prevCard && prevCard !== cardNumber;

        if (hasForeignBalance || switchingCard) {
          mqttClient.publish(
            `posts/${postId}/command`,
            JSON.stringify({ command: 'reset' }),
            { qos: 1 }
          );
          await new Promise(r => setTimeout(r, 300));
        }

        state.clientCardBalance = clientCard.balance;
        state.clientCardType = clientCard.type;
        state.balance = clientCard.balance;

        const balancePayload = {
          card: clientCard.card,
          balance: clientCard.balance,
          type: clientCard.type
        };
        mqttClient.publish(
          `posts/${postId}/clientcardbalance`,
          JSON.stringify(balancePayload),
          { qos: 1 }
        );
        console.log(`📤 [${postId}] clientcardbalance → ${JSON.stringify(balancePayload)}`);

        // На всякий случай очищаем экран сообщений
        mqttClient.publish(
          `posts/${postId}/message`,
          JSON.stringify({ "": "" }),
          { qos: 0 }
        );

        publishStatus(postId);
      } catch (err) {
        console.error(`Ошибка обработки posts/${postId}/clientcard:`, err.message);
      }
    }

    // ---------- Уровни баков ----------
    if (topic === 'tank/levels') {
      try {
        const { tank, level } = JSON.parse(payload);
        if (settings.tankLevels && settings.tankLevels.hasOwnProperty(tank)) {
          const newLevel = Math.min(100, Math.max(0, Math.round(level)));
          if (settings.tankLevels[tank] !== newLevel) {
            settings.tankLevels[tank] = newLevel;
            mqttClient.publish('system/config', JSON.stringify(settings), { qos: 0 });
            console.log(`📊 Датчик: ${tank} -> ${newLevel}%`);
          }
        } else {
          console.warn(`⚠️ Неизвестный бак: ${tank}`);
        }
      } catch (e) {
        console.error('Ошибка обработки tank/levels:', e.message);
      }
    }

    // ---------- Запросы отчётов ----------
    if (topic === 'reports/request') {
      try {
        const request = JSON.parse(payload);
        const { from, to, responseTopic } = request;
        if (!from || !to) return;
        const start = new Date(from); start.setHours(0, 0, 0, 0);
        const end = new Date(to); end.setHours(23, 59, 59, 999);
        const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
        const totalSum = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);
        const translatedReceipts = receipts.map(r => ({
          ...r.toObject(),
          items: translateReceiptItems(r.items)
        }));
        const summary = { totalSum, count: translatedReceipts.length, receipts: translatedReceipts };
        const targetTopic = responseTopic || 'reports/response';
        mqttClient.publish(targetTopic, JSON.stringify(summary), { qos: 0 });
        console.log(`📊 MQTT: отчёт отправлен в ${targetTopic}`);
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

// ---------- MongoDB ----------
const MONGO_URI = process.env.MONGO_URI || 'mongodb://0.0.0.0:27017/carwash';

// ---------- Модели ----------
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: String
});

const receiptSchema = new mongoose.Schema({
  postId: Number,
  receiptNumber: { type: Number, default: null },
  timestamp: { type: Date, default: Date.now },
  operation: String,
  items: [{
    name: String,
    seconds: Number,
    cost: Number,
    pricePerSecond: Number,
    discount: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 }
  }],
  totalCost: Number,
  balanceAfter: Number,
  paymentMethod: { type: String, default: null },
  discountTotal: { type: Number, default: 0 },
  fiscalSent: { type: Boolean, default: false },
  fiscalUuid: { type: String, default: null },
  fiscalDocumentNumber: { type: Number, default: null },
  fiscalSign: { type: String, default: null },
  correctionInfo: {
    type: { type: String, enum: ['self', 'instruction'], default: null },
    baseDate: { type: Date, default: null },
    baseNumber: { type: String, default: null }
  }
});

const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 }
});

const shiftSchema = new mongoose.Schema({
  shiftNumber: { type: Number, required: true },
  shiftOpen: { type: Boolean, default: true },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
  cashier: { type: String, default: '' },
  fiscalShiftNumber: { type: Number, default: null },
  xReports: [{
    timestamp: { type: Date, default: Date.now },
    total: Number,
    count: Number,
    cashier: String
  }],
  zReport: {
    total: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
    generatedAt: { type: Date, default: null },
    cashier: String
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
const Receipt = mongoose.model('Receipt', receiptSchema);
const Counter = mongoose.model('Counter', counterSchema);
const Shift = mongoose.model('Shift', shiftSchema);
const FiscalRegistration = mongoose.model('FiscalRegistration', fiscalRegistrationSchema);
const Setting = mongoose.model('Setting', settingSchema);

// ---------- Настройки ----------
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
      login: process.env.ATOL_LOGIN || '',
      password: process.env.ATOL_PASSWORD || '',
      groupCode: process.env.ATOL_GROUP_CODE || '',
      inn: process.env.ATOL_INN || '000000000000',
      sno: process.env.ATOL_SNO || 'osn',
      paymentAddress: process.env.ATOL_PAYMENT_ADDRESS || 'https://carwash.ru',
      companyEmail: process.env.ATOL_COMPANY_EMAIL || 'company@carwash.ru',
      clientEmail: process.env.ATOL_CLIENT_EMAIL || 'client@carwash.ru'
    },
    shtrihLocal: {
      baseUrl: process.env.SHTRIH_LOCAL_URL || 'http://0.0.0.0:5001/api/kkm'
    }
  },
  kkmManual: {
    kkNumber: "",
    fiscalShiftNumber: null,
    cashierName: ""
  },
  cameras: {
    1: "", 2: "", 3: "", 4: "", 5: "", 6: "", 7: "", 8: ""
  },
  pausePrice: 10,
  pauseFreeTimeSec: 120,
  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    username: '',
    password: ''
  }
};

// ---------- Конфиг постов ----------
function buildServicesPayloadForPost(postId) {
  const postSettings = settings.posts?.[postId] || {};
  const services = postSettings.services || [];
  const prices = postSettings.prices || {};
  const relayMask = postSettings.relayMask || {};
  const vfdFrequencies = postSettings.vfdFrequencies || {};
  const dimmerMask = postSettings.dimmerMask || {};
  const buttonInputs = postSettings.buttonInputs || {};
  const relayDelays = postSettings.relayDelays || {};

  return services.map(svc => {
    const name = svc.name;
    return {
      name,
      price: prices[name] ?? svc.price ?? 0,
      free_time_sec: svc.free_time_sec ?? 0,
      relayMask: relayMask[name] ?? 0,
      dimmerMask: dimmerMask[name] ?? 0,
      vfdFrequency: vfdFrequencies[name] ?? 40,
      onDelay: relayDelays[name]?.onDelay ?? 100,
      offDelay: relayDelays[name]?.offDelay ?? 200,
      buttonInput: buttonInputs[name] ?? 0,
      enabled: svc.enabled !== undefined ? svc.enabled : true
    };
  });
}

function publishConfigToAllPosts() {
  if (!mqttClient) return;
  const numberOfPosts = settings.numberOfPosts || 8;
  for (let i = 1; i <= numberOfPosts; i++) {
    const servicesArray = buildServicesPayloadForPost(i);
    const payload = { services: servicesArray };
    const topic = `posts/${i}/config`;
    mqttClient.publish(topic, JSON.stringify(payload), { qos: 1, retain: true });
  }
  console.log(`📤 Конфиг опубликован в posts/*/config (${numberOfPosts} постов)`);
}

// ---------- Загрузка настроек ----------
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
      const numberOfPosts = settings.numberOfPosts || 8;
      for (let i = 1; i <= numberOfPosts; i++) {
        posts[i] = {
          prices: {}, relayMask: {}, vfdFrequencies: {},
          dimmerMask: {}, buttonInputs: {}, relayDelays: {},
          services: defaultServices.map(s => ({ ...s }))
        };
      }
      settings.posts = posts;
      settings.services = defaultServices;
      doc = new Setting({ key: 'main', value: settings });
      await doc.save();
      console.log('Настройки созданы в БД с индивидуальными постами');
    } else {
      settings = doc.value;

      if (!settings.posts) {
        const numberOfPosts = settings.numberOfPosts || 8;
        const posts = {};
        const services = settings.services || defaultServices;
        for (let i = 1; i <= numberOfPosts; i++) {
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
        delete settings.prices;
        delete settings.relayMask;
        delete settings.vfdFrequencies;
        delete settings.dimmerMask;
        delete settings.buttonInputs;
        delete settings.relayDelays;
        delete settings.services;
        await saveSettings(settings);
        console.log('Настройки мигрированы в формат posts');
      } else {
        const numberOfPosts = settings.numberOfPosts || 8;
        const defaultServices2 = settings.posts[1]?.services || defaultServices;
        for (let i = 1; i <= numberOfPosts; i++) {
          if (!settings.posts[i]) {
            settings.posts[i] = {
              prices: {}, relayMask: {}, vfdFrequencies: {},
              dimmerMask: {}, buttonInputs: {}, relayDelays: {},
              services: defaultServices2.map(s => ({ ...s }))
            };
          } else if (!settings.posts[i].services) {
            settings.posts[i].services = defaultServices2.map(s => ({ ...s }));
          }
          settings.posts[i].services = settings.posts[i].services.map(s => ({
            ...s,
            enabled: s.enable !== undefined ? s.enable : true
          }));
        }
        await saveSettings(settings);
        console.log('Настройки постов обновлены (добавлено enable)');
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
  } catch (err) {
    console.warn('Не удалось загрузить настройки из БД:', err.message);
  }
}

async function saveSettings(newSettings) {
  try {
    await Setting.findOneAndUpdate(
      { key: 'main' },
      { $set: { value: newSettings } },
      { upsert: true }
    );
    console.log('Настройки сохранены в БД');
    writeMqttConfigFile(newSettings);
  } catch (err) {
    console.error('Ошибка сохранения настроек в БД:', err.message);
  }
}

// ---------- Состояние постов ----------
let postsState = {};

function getPostState(postId) {
  if (!postsState[postId]) {
    postsState[postId] = {
      busy: false,
      paused: false,
      balance: 0,
      currentProgram: null,
      elapsedSec: 0,
      totalPaid: 0,
      receiptCount: 0,
      servicesUsage: {},
      timer: null
    };
  }
  return postsState[postId];
}

// ============================================================
// NEW: поиск поста, на котором сейчас активна карта
// ============================================================
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
  const postSettings = settings.posts?.[postId];
  if (postSettings && postSettings.services) {
    return postSettings.services.find(s => s.name.toLowerCase() === name.toLowerCase() && s.enable !== false);
  }
  if (settings.services) {
    return settings.services.find(s => s.name.toLowerCase() === name.toLowerCase() && s.enable !== false);
  }
  return null;
}

function publishStatus(postId) {
  const state = getPostState(postId);
  const status = {
    busy: state.busy,
    paused: state.paused,
    balance: Math.round(state.balance * 100) / 100,
    currentProgram: state.currentProgram,
    elapsedSec: Math.round(state.elapsedSec * 100) / 100,
    totalPaid: Math.round(state.totalPaid * 100) / 100,
    receiptCount: state.receiptCount
  };
  mqttClient.publish(`posts/${postId}/status`, JSON.stringify(status), { qos: 0 });
}

function publishRelayStatus(postId) {
  const state = getPostState(postId);
  const relayMask = state.busy ? 1 : 0;
  mqttClient.publish(`posts/${postId}/status_relay`, JSON.stringify({ busy: state.busy, relayMask }), { qos: 0 });
}

// ============================================================
// Списание с баланса карты в БД
// ============================================================
async function debitCardForPost(postId, amountRub) {
  const state = postsState[postId];
  if (!state || !state.clientCard) return;

  const amount = Math.round(amountRub * 100) / 100;
  if (amount <= 0) return;

  const card = await ClientCard.findOne({ card: state.clientCard });
  if (!card) {
    console.warn(`[Post ${postId}] debitCardForPost: карта ${state.clientCard} не найдена`);
    return;
  }

  const actual = Math.min(amount, card.balance);
  if (actual <= 0.001) return;

  card.balance = Math.round((card.balance - actual) * 100) / 100;
  if (card.balance < 0) card.balance = 0;
  await card.save();

  state.clientCardBalance = card.balance;
  state.balance = card.balance;

  console.log(
    `💳 [Post ${postId}] Списано ${actual.toFixed(2)} ₽ с карты ${card.card} → ` +
    `остаток ${card.balance.toFixed(2)} ₽`
  );
}

// ---------- Таймер (серверный) ----------
function startTimer(postId) {
  const state = getPostState(postId);
  if (state.timer) clearInterval(state.timer);
  const TICK_INTERVAL_MS = 1000;
  state.timer = setInterval(() => {
    if (!state.busy || state.paused) return;
    if (state.clientCard) return;

    const service = findService(postId, state.currentProgram);
    if (!service) { stopPost(postId, true, false); return; }
    const pricePerSec = service.price / 60;
    const deltaSec = TICK_INTERVAL_MS / 1000;
    const cost = pricePerSec * deltaSec;
    if (state.balance >= cost) {
      state.balance -= cost;
      state.elapsedSec += deltaSec;
      if (!state.servicesUsage[service.name]) {
        state.servicesUsage[service.name] = { seconds: 0, cost: 0 };
      }
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
        if (!state.servicesUsage[service.name]) {
          state.servicesUsage[service.name] = { seconds: 0, cost: 0 };
        }
        state.servicesUsage[service.name].seconds += fractionSec;
        state.servicesUsage[service.name].cost += remaining;
        state.servicesUsage[service.name].cost = Math.round(state.servicesUsage[service.name].cost * 100) / 100;
      }
      stopPost(postId, true, true);
    }
  }, TICK_INTERVAL_MS);
}

function handleProgram(postId, programName) {
  const state = getPostState(postId);
  const service = findService(postId, programName);
  if (!service) {
    console.warn(`❌ Пост ${postId}: услуга "${programName}" не найдена или отключена`);
    return;
  }
  if (state.busy) stopPost(postId, false, false);
  const pricePerSec = service.price / 60;
  if (state.balance < pricePerSec && state.balance < 0.01) {
    console.log(`❌ Пост ${postId}: недостаточно средств (${state.balance.toFixed(2)} ₽)`);
    return;
  }
  if (state.timer) clearInterval(state.timer);
  state.busy = true;
  state.paused = false;
  state.currentProgram = service.name;
  state.elapsedSec = 0;
  state.servicesUsage = {};
  startTimer(postId);
  publishStatus(postId);
  publishRelayStatus(postId);
  console.log(`▶️ Пост ${postId}: запущена программа "${service.name}"`);
}

function stopPost(postId, publish = true, printReceiptFlag = false) {
  const state = getPostState(postId);
  if (!state.busy && !printReceiptFlag) return;
  if (printReceiptFlag && Object.keys(state.servicesUsage).length > 0) {
    printReceipt(postId);
  }
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.busy = false;
  state.paused = false;
  state.currentProgram = null;
  state.elapsedSec = 0;
  if (publish) {
    publishStatus(postId);
    publishRelayStatus(postId);
  }
  console.log(`⏹️ Пост ${postId}: остановлен`);
}

function togglePause(postId) {
  const state = getPostState(postId);
  if (!state.busy) return;
  const pauseService = findService(postId, 'Пауза');
  if (pauseService) {
    if (state.currentProgram === 'Пауза') {
      stopPost(postId, true, false);
    } else {
      stopPost(postId, false, false);
      handleProgram(postId, 'Пауза');
    }
  } else {
    stopPost(postId, true, false);
  }
}

function addBalance(postId, amount) {
  const state = getPostState(postId);
  state.balance += amount;
  state.totalPaid += amount;
  state.balance = Math.round(state.balance * 100) / 100;
  publishStatus(postId);
  console.log(`💰 Пост ${postId}: пополнен на ${amount} ₽, баланс: ${state.balance.toFixed(2)} ₽`);
}

function resetPost(postId) {
  const state = getPostState(postId);
  if (state.timer) clearInterval(state.timer);
  postsState[postId] = {
    busy: false,
    paused: false,
    balance: 0,
    currentProgram: null,
    elapsedSec: 0,
    totalPaid: 0,
    receiptCount: 0,
    servicesUsage: {},
    timer: null
  };
  publishStatus(postId);
  publishRelayStatus(postId);
  console.log(`🔄 Пост ${postId}: сброшен`);
}

function printReceipt(postId) {
  const state = getPostState(postId);
  const items = [];
  let totalCost = 0;
  for (const [name, usage] of Object.entries(state.servicesUsage)) {
    if (usage.seconds > 0.001) {
      items.push({
        name: name,
        seconds: Math.round(usage.seconds * 1000) / 1000,
        cost: Math.round(usage.cost * 100) / 100,
        pricePerSecond: Math.round((usage.cost / usage.seconds) * 100) / 100
      });
      totalCost += usage.cost;
    }
  }
  if (items.length === 0 || totalCost < 0.01) {
    console.log(`⚠️ Пост ${postId}: нет данных для чека`);
    return;
  }
  const receiptData = {
    postId: parseInt(postId),
    timestamp: new Date().toISOString(),
    operation: 'Чек по сессии',
    items: items,
    balance: Math.round(state.balance * 100) / 100
  };
  mqttClient.publish('kkm/print', JSON.stringify(receiptData), { qos: 1 });
  state.servicesUsage = {};
  state.receiptCount++;
  publishStatus(postId);
  console.log(`🧾 Пост ${postId}: чек отправлен (${items.length} услуг, сумма ${totalCost.toFixed(2)} ₽)`);
}

// ---------- Вспомогательные ----------
const programNamesRu = {
  water: 'Вода', foam: 'Пена', wax: 'Воск', teflon: 'Тефлон',
  osmosis: 'Осмос', hotWater: 'Горячая вода',
  waterFoam: 'Вода+Пена', turbo: 'Турбо мойка'
};

function translateReceiptItems(items) {
  if (!items || !Array.isArray(items)) return [];
  return items.map(item => ({
    name: programNamesRu[item.name] || item.name || '?',
    seconds: typeof item.seconds === 'number' ? item.seconds : (Number(item.seconds) || 0),
    cost: typeof item.cost === 'number' ? item.cost : (Number(item.cost) || 0),
    pricePerSecond: typeof item.pricePerSecond === 'number' ? item.pricePerSecond : (Number(item.pricePerSecond) || 0)
  }));
}

async function getNextReceiptNumber() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'receiptNumber' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return counter.seq;
}

async function getNextShiftNumber() {
  const counter = await Counter.findByIdAndUpdate(
    'shiftNumber',
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

async function initShift() {
  await Shift.deleteMany({ shiftNumber: { $exists: false } });
  let currentShift = await Shift.findOne({ shiftOpen: true });
  if (!currentShift) {
    const nextNumber = await getNextShiftNumber();
    const newShift = new Shift({
      shiftNumber: nextNumber,
      shiftOpen: true,
      cashier: 'system'
    });
    await newShift.save();
    console.log(`✅ Смена №${nextNumber} создана (открыта, кассир: system)`);
  } else {
    console.log(`✅ Смена №${currentShift.shiftNumber} открыта с ${currentShift.openedAt}, кассир: ${currentShift.cashier || 'system'}`);
  }
}

// ---------- REST API ----------
const app = express();
app.use(cors());
app.use(express.json());

// ---------- Хук: публикация баланса карты во все посты ----------
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

    if (postsWithCard.length === 0) return;

    const payload = JSON.stringify({
      card: clientCard.card,
      balance: clientCard.balance,
      type: clientCard.type
    });

    for (const postId of postsWithCard) {
      mqttClient.publish(`posts/${postId}/clientcardbalance`, payload, { qos: 1 });
      publishStatus(postId);
      console.log(`📤 [${postId}] clientcardbalance (после изменения баланса) → ${payload}`);
    }
  } catch (err) {
    console.error('publishCardBalanceToPosts error:', err.message);
  }
};

// ---------- Роутер карт ----------
app.use('/api/cards', cardsRouter);

// Инициализация администратора
const initAdmin = async () => {
  try {
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      const hashed = await bcrypt.hash('admin123', 10);
      await User.create({ username: 'admin', password: hashed, role: 'admin' });
      console.log('Default admin created: admin/admin123');
    }
  } catch (err) {
    console.log('MongoDB не доступна – админ в памяти');
  }
};
initAdmin();

let memoryUsers = [{ username: 'admin', passwordHash: bcrypt.hashSync('admin123', 10), role: 'admin' }];
async function findUser(username) {
  try {
    if (mongoose.connection.readyState === 1) return await User.findOne({ username });
    else return memoryUsers.find(u => u.username === username);
  } catch { return memoryUsers.find(u => u.username === username); }
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secretkey');
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  next();
}

app.get('/api/mqtt/settings', auth, adminOnly, (req, res) => {
  res.json(settings.mqtt || { brokerUrl: '', username: '', password: '' });
});

app.post('/api/mqtt/settings', auth, adminOnly, async (req, res) => {
  try {
    const { brokerUrl, username, password } = req.body;
    if (!brokerUrl) return res.status(400).json({ error: 'brokerUrl обязателен' });
    settings.mqtt = { brokerUrl, username: username || '', password: password || '' };
    await saveSettings(settings);
    reconnectMqtt(settings.mqtt);
    res.json({ ok: true, message: 'Настройки MQTT обновлены и применены' });
  } catch (err) {
    console.error('Ошибка обновления настроек MQTT:', err);
    res.status(500).json({ error: 'Ошибка обновления настроек MQTT' });
  }
});

app.post('/api/publish-config', auth, adminOnly, async (req, res) => {
  try {
    publishConfigToAllPosts();
    res.json({ ok: true, message: 'Конфиг опубликован' });
  } catch (err) {
    console.error('Ошибка публикации конфига:', err);
    res.status(500).json({ error: 'Ошибка публикации конфига' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
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

app.get('/api/posts', auth, (req, res) => {
  try {
    const numberOfPosts = (typeof settings.numberOfPosts === 'number' && settings.numberOfPosts > 0)
      ? settings.numberOfPosts : 8;
    const result = {};
    for (let i = 1; i <= numberOfPosts; i++) {
      const id = i.toString();
      const state = postsState[id];
      if (state) {
        const { timer, _lastEspBalance, ...safeState } = state;
        if (safeState.clientCard && typeof safeState.clientCardBalance === 'number') {
          safeState.balance = safeState.clientCardBalance;
        }
        result[id] = safeState;
      } else {
        result[id] = { busy: false };
      }
    }
    res.json(result);
  } catch (error) {
    console.error('❌ Ошибка в /api/posts:', error.message);
    console.error(error.stack);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.put('/api/settings', auth, adminOnly, async (req, res) => {
  try {
    const newSettings = req.body;

    if (newSettings.prices || newSettings.relayMask || newSettings.vfdFrequencies ||
      newSettings.dimmerMask || newSettings.buttonInputs || newSettings.relayDelays ||
      newSettings.services) {
      const numberOfPosts = newSettings.numberOfPosts || settings.numberOfPosts || 8;
      const posts = {};
      const services = newSettings.services || settings.posts?.[1]?.services || [];
      for (let i = 1; i <= numberOfPosts; i++) {
        posts[i] = {
          prices: newSettings.prices ? { ...newSettings.prices } : {},
          relayMask: newSettings.relayMask ? { ...newSettings.relayMask } : {},
          vfdFrequencies: newSettings.vfdFrequencies ? { ...newSettings.vfdFrequencies } : {},
          dimmerMask: newSettings.dimmerMask ? { ...newSettings.dimmerMask } : {},
          buttonInputs: newSettings.buttonInputs ? { ...newSettings.buttonInputs } : {},
          relayDelays: newSettings.relayDelays ? { ...newSettings.relayDelays } : {},
          services: services.map(s => ({ ...s, enabled: s.enable !== undefined ? s.enable : true }))
        };
      }
      newSettings.posts = posts;
      delete newSettings.prices;
      delete newSettings.relayMask;
      delete newSettings.vfdFrequencies;
      delete newSettings.dimmerMask;
      delete newSettings.buttonInputs;
      delete newSettings.relayDelays;
      delete newSettings.services;
    }

    settings = { ...settings, ...newSettings };

    if (newSettings.posts) {
      for (const [postId, postData] of Object.entries(newSettings.posts)) {
        if (!settings.posts[postId]) settings.posts[postId] = {};
        settings.posts[postId] = { ...settings.posts[postId], ...postData };
        if (settings.posts[postId].services) {
          settings.posts[postId].services = settings.posts[postId].services.map(s => ({
            ...s, enabled: s.enable !== undefined ? s.enable : true
          }));
        }
      }
    }

    await saveSettings(settings);
    publishConfigToAllPosts();
    mqttClient.publish('system/config', JSON.stringify(settings), { qos: 0 });
    res.json(settings);
  } catch (err) {
    console.error('Ошибка сохранения настроек:', err);
    res.status(500).json({ error: 'Ошибка сохранения настроек' });
  }
});

app.post('/api/posts/:postId/command', auth, adminOnly, (req, res) => {
  const { command } = req.body;
  mqttClient.publish(`posts/${req.params.postId}/command`, JSON.stringify({ command }), { qos: 1 });
  res.json({ ok: true });
});

app.get('/api/relays', auth, (req, res) => res.json(relaysState));
app.get('/api/vfds', auth, (req, res) => res.json(vfdsState));
app.post('/api/tank-levels', auth, adminOnly, (req, res) => {
  const { tank, level } = req.body;
  if (settings.tankLevels.hasOwnProperty(tank)) {
    settings.tankLevels[tank] = level;
    mqttClient.publish('system/config', JSON.stringify(settings), { qos: 0 });
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: 'Invalid tank name' });
  }
});

app.get('/api/kkm/status', auth, adminOnly, async (req, res) => {
  try {
    const response = await axios.get('http://0.0.0.0:5001/api/kkm/status', { timeout: 2000 });
    res.json(response.data);
  } catch (err) {
    res.json({
      ready: true, connected: false, paper: true,
      kkNumber: settings.kkmManual.kkNumber || null,
      shiftNumber: settings.kkmManual.fiscalShiftNumber || null,
      cashierName: settings.kkmManual.cashierName || null,
      errors: ['Драйвер ККМ не отвечает, используются ручные настройки']
    });
  }
});

app.put('/api/kkm/manual', auth, adminOnly, (req, res) => {
  const { kkNumber, fiscalShiftNumber, cashierName } = req.body;
  if (kkNumber !== undefined) settings.kkmManual.kkNumber = kkNumber;
  if (fiscalShiftNumber !== undefined) settings.kkmManual.fiscalShiftNumber = fiscalShiftNumber;
  if (cashierName !== undefined) settings.kkmManual.cashierName = cashierName;
  mqttClient.publish('system/config', JSON.stringify(settings), { qos: 0 });
  res.json(settings.kkmManual);
});

app.get('/api/kkm/current-shift', auth, adminOnly, async (req, res) => {
  const shift = await Shift.findOne({ shiftOpen: true }).sort({ shiftNumber: -1 });
  if (!shift) return res.json({ exists: false });
  res.json({
    shiftNumber: shift.shiftNumber,
    cashier: shift.cashier,
    openedAt: shift.openedAt,
    fiscalShiftNumber: shift.fiscalShiftNumber
  });
});

app.get('/api/kkm/shift-status', auth, adminOnly, async (req, res) => {
  const shift = await Shift.findOne({ shiftOpen: true });
  res.json({ shiftOpen: !!shift });
});

app.post('/api/kkm/open-shift', auth, adminOnly, async (req, res) => {
  const existing = await Shift.findOne({ shiftOpen: true });
  if (existing) return res.status(400).json({ error: 'Уже есть открытая смена' });
  const nextNumber = await getNextShiftNumber();
  const newShift = new Shift({
    shiftNumber: nextNumber,
    shiftOpen: true,
    cashier: req.user.username
  });
  await newShift.save();
  res.json({ shiftNumber: nextNumber, cashier: req.user.username, openedAt: newShift.openedAt });
});

app.post('/api/kkm/close-shift', auth, adminOnly, async (req, res) => {
  const shift = await Shift.findOne({ shiftOpen: true });
  if (!shift) return res.status(400).json({ error: 'Нет открытой смены' });
  shift.shiftOpen = false;
  shift.closedAt = new Date();
  await shift.save();
  res.json({ message: 'Смена закрыта' });
});

app.get('/api/kkm/x-report', auth, adminOnly, async (req, res) => {
  const shift = await Shift.findOne({ shiftOpen: true });
  if (!shift) return res.status(404).json({ error: 'Нет открытой смены' });
  const receipts = await Receipt.find({ timestamp: { $gte: shift.openedAt } });
  const total = receipts.reduce((sum, r) => sum + (r.totalCost || 0), 0);
  const count = receipts.length;
  shift.xReports.push({ timestamp: new Date(), total, count, cashier: req.user.username });
  await shift.save();
  res.json({ message: 'X-отчёт сформирован (промежуточный)', total, count });
});

app.post('/api/kkm/z-report', auth, adminOnly, async (req, res) => {
  const currentShift = await Shift.findOne({ shiftOpen: true });
  if (!currentShift) return res.status(400).json({ error: 'Нет открытой смены' });
  const receipts = await Receipt.find({ timestamp: { $gte: currentShift.openedAt, $lte: new Date() } });
  const total = receipts.reduce((sum, r) => sum + (r.totalCost || 0), 0);
  const count = receipts.length;
  currentShift.zReport = { total, count, generatedAt: new Date(), cashier: req.user.username };
  currentShift.shiftOpen = false;
  currentShift.closedAt = new Date();
  await currentShift.save();
  const nextNumber = await getNextShiftNumber();
  const newShift = new Shift({ shiftNumber: nextNumber, shiftOpen: true, cashier: req.user.username });
  await newShift.save();
  res.json({ message: 'Z-отчёт сформирован, смена закрыта', total, count });
});

app.post('/api/kkm/toggle-shift', auth, adminOnly, async (req, res) => {
  const currentShift = await Shift.findOne({ shiftOpen: true });
  if (currentShift) {
    currentShift.shiftOpen = false;
    currentShift.closedAt = new Date();
    await currentShift.save();
    const nextNumber = await getNextShiftNumber();
    const newShift = new Shift({ shiftNumber: nextNumber, shiftOpen: true, cashier: req.user.username });
    await newShift.save();
    return res.json({ shiftOpen: true, shiftNumber: nextNumber, cashier: req.user.username });
  } else {
    const nextNumber = await getNextShiftNumber();
    const newShift = new Shift({ shiftNumber: nextNumber, shiftOpen: true, cashier: req.user.username });
    await newShift.save();
    return res.json({ shiftOpen: true, shiftNumber: nextNumber, cashier: req.user.username });
  }
});

app.get('/api/kkm/settings', auth, adminOnly, (req, res) => {
  res.json(settings.kkm);
});

app.get('/api/shift-total', auth, adminOnly, async (req, res) => {
  const currentShift = await Shift.findOne({ shiftOpen: true });
  if (!currentShift) return res.json({ total: 0, count: 0 });
  const receipts = await Receipt.find({ timestamp: { $gte: currentShift.openedAt } });
  const total = receipts.reduce((sum, r) => sum + (r.totalCost || 0), 0);
  res.json({ total, count: receipts.length });
});

app.get('/api/kkm/fiscal-registration', auth, adminOnly, async (req, res) => {
  const reg = await FiscalRegistration.findOne();
  res.json(reg || {});
});

app.post('/api/kkm/fiscal-registration', auth, adminOnly, async (req, res) => {
  const { registrationNumber, inn, fnNumber, validUntil } = req.body;
  if (!registrationNumber || !inn || !fnNumber || !validUntil) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  await FiscalRegistration.deleteMany({});
  const newReg = new FiscalRegistration({
    registrationNumber, inn, fnNumber, validUntil: new Date(validUntil)
  });
  await newReg.save();
  res.json(newReg);
});

app.post('/api/kkm/fiscal/open-shift', auth, adminOnly, async (req, res) => {
  res.json({ ok: true, message: 'Открытие смены (заглушка)' });
});
app.post('/api/kkm/fiscal/close-shift', auth, adminOnly, async (req, res) => {
  res.json({ ok: true, message: 'Закрытие смены (заглушка)' });
});
app.get('/api/kkm/fiscal/x-report', auth, adminOnly, async (req, res) => {
  res.json({ total: 0, count: 0, message: 'X-отчёт (заглушка)' });
});
app.post('/api/kkm/fiscal/z-report', auth, adminOnly, async (req, res) => {
  res.json({ message: 'Z-отчёт (заглушка)' });
});

async function generatePDFReport(receipts, totalSum, fromDate, toDate) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const fontPathArial = path.join(__dirname, 'fonts', 'Arial.ttf');
    const fontPathTimes = path.join(__dirname, 'fonts', 'times.ttf');
    if (fs.existsSync(fontPathArial)) {
      doc.registerFont('MainFont', fontPathArial); doc.font('MainFont');
    } else if (fs.existsSync(fontPathTimes)) {
      doc.registerFont('MainFont', fontPathTimes); doc.font('MainFont');
    } else {
      console.warn('⚠️ Шрифт для кириллицы не найден');
      doc.font('Helvetica');
    }

    doc.fontSize(18).text('Отчёт по кассовым чекам', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Период: ${fromDate} – ${toDate}`, { align: 'center' });
    doc.moveDown();
    doc.text(`Всего чеков: ${receipts.length}`, { align: 'left' });
    doc.text(`Общая сумма: ${(Number(totalSum) || 0).toFixed(2)} руб.`, { align: 'left' });
    doc.moveDown();

    const startX = 40;
    let y = doc.y + 10;
    const colWidths = [30, 35, 120, 50, 70, 205];
    const headerHeight = 25;
    const headers = ['№', 'Пост', 'Дата', 'Сумма', 'Оплата', 'Услуги'];

    function drawHeaders(yPos) {
      let x = startX;
      doc.fontSize(10);
      for (let i = 0; i < headers.length; i++) {
        doc.rect(x, yPos, colWidths[i], headerHeight).stroke();
        doc.text(headers[i], x + 5, yPos + 5, { width: colWidths[i] - 10, align: 'left' });
        x += colWidths[i];
      }
      return yPos + headerHeight;
    }
    function drawReceiptRow(yPos, rowHeight, idx, receipt, dateStr, itemsStr) {
      let x = startX;
      doc.rect(x, yPos, colWidths[0], rowHeight).stroke();
      doc.text((idx + 1).toString(), x + 5, yPos + 5);
      x += colWidths[0];
      doc.rect(x, yPos, colWidths[1], rowHeight).stroke();
      doc.text(String(receipt.postId || ''), x + 5, yPos + 5);
      x += colWidths[1];
      doc.rect(x, yPos, colWidths[2], rowHeight).stroke();
      doc.text(dateStr, x + 5, yPos + 5);
      x += colWidths[2];
      doc.rect(x, yPos, colWidths[3], rowHeight).stroke();
      doc.text((Number(receipt.totalCost) || 0).toFixed(2) + ' ₽', x + 5, yPos + 5);
      x += colWidths[3];

      doc.rect(x, yPos, colWidths[4], rowHeight).stroke();
      const pm = receipt.paymentMethod;
      const pmLabel = pm === 'cash' ? 'Наличные'
        : pm === 'card_terminal' ? 'Безнал'
          : pm === 'client_card' ? 'Карта'
            : '—';
      doc.text(pmLabel, x + 5, yPos + 5, { width: colWidths[4] - 10 });
      x += colWidths[4];

      doc.rect(x, yPos, colWidths[5], rowHeight).stroke();
      doc.text(itemsStr, x + 5, yPos + 5, { width: colWidths[5] - 10, align: 'left' });
    }

    y = drawHeaders(y);
    let pageNumber = 1;
    for (let idx = 0; idx < receipts.length; idx++) {
      const receipt = receipts[idx];
      const items = receipt.items || [];
      const itemsStr = items.map(i =>
        `${i.name} (цена сек: ${(Number(i.pricePerSecond) || 0).toFixed(1)}коп, время: ${(Number(i.seconds) || 0).toFixed(1)}с, сумма: ${(Number(i.cost) || 0).toFixed(2)})`
      ).join(', ');
      const textHeight = doc.heightOfString(itemsStr, { width: colWidths[5] - 10 });
      const currentRowHeight = Math.max(20, textHeight + 10);
      const dateStr = new Date(receipt.timestamp).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
      if (y + currentRowHeight > doc.page.height - 50) {
        doc.save();
        doc.fontSize(8);
        const text = `Страница ${pageNumber}`;
        const textWidth = doc.widthOfString(text);
        const xPos = doc.page.width - textWidth - 30;
        const yPos = doc.page.height - 20;
        doc.text(text, xPos, yPos);
        doc.restore();
        doc.addPage();
        pageNumber++;
        y = 50;
        y = drawHeaders(y);
      }
      drawReceiptRow(y, currentRowHeight, idx, receipt, dateStr, itemsStr);
      y += currentRowHeight;
    }
    doc.save();
    doc.fontSize(8);
    const text = `Страница ${pageNumber}`;
    const textWidth = doc.widthOfString(text);
    const xPos = doc.page.width - textWidth - 30;
    const yPos = doc.page.height - 20;
    doc.text(text, xPos, yPos);
    doc.restore();
    doc.end();
  });
}

app.get('/api/reports/pdf', auth, adminOnly, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Параметры from и to обязательны' });
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const end = new Date(to); end.setHours(23, 59, 59, 999);
  let receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  receipts = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const totalSum = receipts.reduce((s, r) => s + (r.totalCost || 0), 0);
  const pdfData = await generatePDFReport(receipts, totalSum, from, to);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=report_${from}_${to}.pdf`);
  res.send(pdfData);
});

app.get('/api/reports/day/:date', auth, adminOnly, async (req, res) => {
  const date = new Date(req.params.date);
  const start = new Date(date.setHours(0, 0, 0, 0));
  const end = new Date(date.setHours(23, 59, 59, 999));
  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const totalSum = translated.reduce((s, r) => s + (r.totalCost || 0), 0);
  res.json({ totalSum, count: translated.length, receipts: translated });
});

app.get('/api/reports/week', auth, adminOnly, async (req, res) => {
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - 7); start.setHours(0, 0, 0, 0);
  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const totalSum = translated.reduce((s, r) => s + (r.totalCost || 0), 0);
  res.json({ totalSum, count: translated.length, receipts: translated });
});

app.get('/api/reports/month', auth, adminOnly, async (req, res) => {
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - 30); start.setHours(0, 0, 0, 0);
  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const totalSum = translated.reduce((s, r) => s + (r.totalCost || 0), 0);
  res.json({ totalSum, count: translated.length, receipts: translated });
});

app.get('/api/reports/shift', auth, adminOnly, async (req, res) => {
  const today = new Date();
  const start = new Date(today.setHours(8, 0, 0, 0));
  const end = new Date(today.setHours(20, 0, 0, 0));
  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const totalSum = translated.reduce((s, r) => s + (r.totalCost || 0), 0);
  res.json({ totalSum, count: translated.length, receipts: translated });
});

app.get('/api/reports/range', auth, adminOnly, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Параметры from и to обязательны' });
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const end = new Date(to); end.setHours(23, 59, 59, 999);
  const receipts = await Receipt.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const totalSum = translated.reduce((s, r) => s + (r.totalCost || 0), 0);
  const summary = { totalSum, count: translated.length, receipts: translated };
  mqttClient.publish('reports/output', JSON.stringify(summary), { qos: 0 });
  res.json(summary);
});

app.post('/api/receipts', async (req, res) => {
  try {
    const receiptData = req.body;
    if (!receiptData.postId || !receiptData.items || !Array.isArray(receiptData.items) || receiptData.items.length === 0) {
      return res.status(400).json({ error: 'Недостаточно данных: postId и items обязательны' });
    }
    const roundedItems = receiptData.items.map((item) => ({
      name: item.name || 'Услуга',
      seconds: Math.round((item.seconds || 0) * 10) / 10,
      cost: Math.round((item.cost || 0) * 10) / 10,
      pricePerSecond: Math.round((item.pricePerSecond || 0) * 10) / 10,
      discount: item.discount || 0,
      discountPercent: item.discountPercent || 0
    }));
    const totalCost = roundedItems.reduce((sum, item) => sum + item.cost, 0);
    const roundedTotal = Math.round(totalCost * 10) / 10;
    let timestamp = receiptData.timestamp;
    if (!timestamp || timestamp === 'now' || isNaN(Date.parse(timestamp))) {
      timestamp = new Date();
    } else {
      timestamp = new Date(timestamp);
    }
    const receiptNumber = await getNextReceiptNumber();
    const newReceipt = new Receipt({
      postId: Number(receiptData.postId),
      receiptNumber: receiptNumber,
      timestamp: timestamp,
      operation: receiptData.operation || 'sell',
      items: roundedItems,
      totalCost: roundedTotal,
      balanceAfter: Math.round((receiptData.balance || 0) * 10) / 10,
      paymentMethod: receiptData.paymentMethod || null,
      discountTotal: receiptData.discountTotal || 0,
      correctionInfo: receiptData.correctionInfo || null,
      fiscalSent: false
    });
    await newReceipt.save();
    console.log(`✅ Чек сохранён через HTTP (payment=${newReceipt.paymentMethod || '—'})`);

    const currentShift = await Shift.findOne({ shiftOpen: true });
    if (currentShift) {
      const shiftReceipts = await Receipt.find({ timestamp: { $gte: currentShift.openedAt } });
      const total = shiftReceipts.reduce((sum, r) => sum + (r.totalCost || 0), 0);
      const count = shiftReceipts.length;
      mqttClient.publish('shift/total', JSON.stringify({ total, count }), { qos: 0 });
    }
    res.status(201).json({ message: 'Чек сохранён', id: newReceipt._id });
  } catch (err) {
    console.error('Ошибка сохранения чека через HTTP:', err.message);
    res.status(500).json({ error: 'Ошибка сервера при сохранении чека' });
  }
});

// ============================================================
// NEW: принудительное освобождение карты оператором
// POST /api/cards/:card/release
// ============================================================
app.post('/api/cards/:card/release', auth, adminOnly, (req, res) => {
  const cardNumber = req.params.card.toUpperCase();
  let released = false;
  for (const [id, st] of Object.entries(postsState)) {
    if (st && st.clientCard === cardNumber) {
      delete st.clientCard;
      delete st.clientCardBalance;
      delete st.clientCardType;
      st._lastEspBalance = null;
      released = true;
      console.log(`🔓 [${id}] Карта ${cardNumber} принудительно освобождена оператором`);
    }
  }
  res.json({ ok: true, released });
});

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await loadSettings();
    await initShift();
    app.listen(process.env.PORT || 3000, process.env.HOST || '0.0.0.0', () => {
      console.log(`REST API listening on http://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}`);
    });
  })
  .catch(err => {
    console.warn('MongoDB not connected, using default settings:', err.message);
    app.listen(process.env.PORT || 3000, process.env.HOST || '0.0.0.0', () => {
      console.log(`REST API listening on http://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}`);
    });
  });
