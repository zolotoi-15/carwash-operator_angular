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

// ── Защита от падения процесса на unhandled rejection ───────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION:', reason);
  if (reason && reason.stack) console.error(reason.stack);
});
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:', err);
  if (err && err.stack) console.error(err.stack);
});
process.on('exit', (code) => console.error(`💀 backend завершился, code=${code}`));

const KKM_DRIVER_URL = process.env.KKM_DRIVER_URL || 'http://127.0.0.1:5001/api/kkm';

// ── Accounting query ────────────────────────────────────────────────
function accountingQuery(range = {}) {
  return {
    ...range,
    kind:   { $ne: 'transfer_post_to_card' },
    status: { $ne: 'void' },
  };
}

// Универсальный билдер фильтра по смене или по диапазону дат.
function buildTimeOrShiftFilter({ shiftNumber, from, to }) {
  if (shiftNumber != null && shiftNumber !== '') {
    const n = Number(shiftNumber);
    if (!Number.isInteger(n)) return { error: 'Некорректный shiftNumber', code: 400 };
    return { filter: { shiftNumber: n }, kind: 'shift', shiftNumber: n };
  }
  if (!from || !to) return { error: 'Укажите shiftNumber или from+to', code: 400 };
  const start = new Date(from); const end = new Date(to);
  if (isNaN(start) || isNaN(end)) return { error: 'Некорректные from/to', code: 400 };
  return { filter: { timestamp: { $gte: start, $lte: end } }, kind: 'range', from, to };
}

function pairIdOf(r) {
  if (!r) return null;
  if (r.isAdvance && r.finalReceiptNumber) return r.receiptNumber;
  if (!r.isAdvance && r.advanceReceiptNumber) return r.advanceReceiptNumber;
  return null;
}

function annotateReceipt(r) {
  const o = typeof r.toObject === 'function' ? r.toObject() : { ...r };
  o.status         = o.status || 'done';
  o.grossTotal     = o.grossTotal ?? null;
  o.advanceApplied = o.advanceApplied ?? 0;
  o.pairId         = pairIdOf(o);
  o.shiftNumber    = o.shiftNumber ?? null;
  return o;
}

// ★ Функция для расчёта среднего чека (только по финальным чекам)
function computeAverageCheck(receipts) {
  const finals = receipts.filter(r =>
    r.status !== 'void' &&
    r.isAdvance !== true &&
    r.kind !== 'transfer_post_to_card' &&
    r.kind !== 'refund'
  );

  if (!finals.length) {
    return { avgCheck: 0, finalCount: 0, finalTotal: 0 };
  }

  const finalTotal = finals.reduce((s, r) => {
    const amount = Number(r.grossTotal != null ? r.grossTotal : r.totalCost) || 0;
    return s + amount;
  }, 0);

  return {
    avgCheck:   Math.round((finalTotal / finals.length) * 100) / 100,
    finalCount: finals.length,
    finalTotal: Math.round(finalTotal * 100) / 100,
  };
}

// ★ Функция для подсчета статистики по способам оплаты (для отчётов и смены)
function calculatePaymentSummary(receipts) {
  let total = 0, cash = 0, card_terminal = 0, client_card = 0;

  for (const r of receipts) {
    if (r.status === 'void' || r.kind === 'transfer_post_to_card') continue;
    
    // Для карт клиента реальная сумма — это grossTotal (totalCost = 0)
    const amount = r.paymentMethod === 'client_card' 
      ? (Number(r.grossTotal) || Number(r.totalCost) || 0) 
      : (Number(r.totalCost) || 0);

    total += amount;
    if (r.paymentMethod === 'cash') cash += amount;
    else if (r.paymentMethod === 'card_terminal') card_terminal += amount;
    else if (r.paymentMethod === 'client_card') client_card += amount;
  }

  const pct = (val) => total > 0 ? Math.round((val / total) * 100) : 0;

  return {
    total: Math.round(total * 100) / 100,
    cash: { total: Math.round(cash * 100) / 100, percent: pct(cash) },
    card_terminal: { total: Math.round(card_terminal * 100) / 100, percent: pct(card_terminal) },
    client_card: { total: Math.round(client_card * 100) / 100, percent: pct(client_card) }
  };
}

// Миграция legacy-финальных чеков: приводим totalCost к нетто,
// чтобы итоги смен не задваивались. Идемпотентно.
async function migrateLegacyReceipts() {
  try {
    const legacy = await Receipt.find({
      kind: 'final',
      advanceReceiptNumber: { $ne: null },
      grossTotal: null,
    }).lean();
    if (!legacy.length) return;
    console.log(`[migrate] Найдено ${legacy.length} legacy-финальных чеков…`);
    let fixed = 0;
    for (const r of legacy) {
      const consumed = await Receipt.find({
        isAdvance: true,
        finalReceiptNumber: r.receiptNumber,
        kind: { $in: ['advance_post', 'topup_post'] },
      }).lean();
      if (!consumed.length) continue;
      const totalAdvance = consumed.reduce((s, a) => s + (Number(a.totalCost) || 0), 0);
      const gross = Number(r.totalCost) || 0;
      const net   = Math.max(0, gross - totalAdvance);
      await Receipt.updateOne(
        { _id: r._id },
        { $set: { grossTotal: gross, advanceApplied: totalAdvance, totalCost: net, status: r.status || 'done' } },
      );
      fixed++;
    }
    console.log(`[migrate] Исправлено ${fixed} legacy-чеков`);
  } catch (e) {
    console.warn('[migrate] Ошибка миграции:', e.message);
  }
}

// Проставляет shiftNumber старым чекам по временным диапазонам смен.
// Идемпотентна: трогает только чеки с shiftNumber == null.
async function migrateReceiptShiftNumbers() {
  try {
    const missing = await Receipt.countDocuments({ shiftNumber: null });
    if (!missing) return;
    console.log(`[migrate-shift] Найдено ${missing} чеков без shiftNumber…`);

    const shifts = await Shift.find({}).sort({ openedAt: 1 }).lean();
    if (!shifts.length) {
      console.log('[migrate-shift] Нет смен — пропускаем');
      return;
    }

    let updated = 0;
    for (let i = 0; i < shifts.length; i++) {
      const s = shifts[i];
      const next = shifts[i + 1];
      const startTime = new Date(s.openedAt);
      const endTime = s.closedAt
        ? new Date(s.closedAt)
        : next
          ? new Date(next.openedAt)
          : new Date('9999-12-31');

      const result = await Receipt.updateMany(
        { shiftNumber: null, timestamp: { $gte: startTime, $lt: endTime } },
        { $set: { shiftNumber: s.shiftNumber } },
      );
      updated += result.modifiedCount || 0;
    }
    console.log(`[migrate-shift] Обновлено ${updated} чеков`);
  } catch (e) {
    console.warn('[migrate-shift] Ошибка:', e.message);
  }
}

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
      settings: { tankLevels: settings.tankLevels, numberOfPosts: settings.numberOfPosts },
      timestamp: Date.now(),
    }));
  } catch (e) { console.warn('WebSocket snapshot error:', e.message); }
  try { await closeExpiredShiftIfNeeded(); } catch { /* ignore */ }
  try {
    const currentShift = await Shift.findOne({ shiftOpen: true });
    if (currentShift) {
      const receipts = await Receipt.find(accountingQuery({ shiftNumber: currentShift.shiftNumber }));
      const total = receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0);
      const { avgCheck } = computeAverageCheck(receipts);
      const paymentMethods = calculatePaymentSummary(receipts);
      ws.send(JSON.stringify({
        type: 'mqtt', topic: 'shift/total',
        payload: JSON.stringify({ shiftNumber: currentShift.shiftNumber, total, count: receipts.length, avgCheck, paymentMethods }),
        timestamp: Date.now(),
      }));
    }
  } catch (e) { console.warn('WebSocket shift/total snapshot error:', e.message); }
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
    ws.send(JSON.stringify({ type: 'mqtt', topic: 'kkm/status', payload: kkmPayload, timestamp: Date.now() }));
  } catch (e) { console.warn('WebSocket kkm/status snapshot error:', e.message); }
  ws.on('close', () => console.log(`🔌 WebSocket: клиент отключился (всего: ${wss.clients.size})`));
  ws.on('error', (err) => console.warn('WebSocket error:', err.message));
});

// ============================================================
// MQTT
// ============================================================
let mqttClient = null;
let mqttSettings = {
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  username: '', password: ''
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
      out = { brokerUrl: `mqtt://${host}:${port}`, username: local.username || '', password: local.password || '' };
    } else {
      out = {
        brokerUrl: mqttCfg.brokerUrl || process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        username: mqttCfg.username || '', password: mqttCfg.password || ''
      };
    }
    fs.writeFileSync(configPath, JSON.stringify(out, null, 2));
    console.log('✅ mqtt-config.json обновлён:', out.brokerUrl);
  } catch (err) {
    console.warn('⚠️ Не удалось сохранить mqtt-config.json:', err.message);
  }
}

function connectMqtt(settings) {
  if (mqttClient) { mqttClient.end(true); mqttClient = null; }
  const mqttCfg = settings || {};
  const local = mqttCfg.local || {};
  let brokerUrl, username, password;
  if (local.host) {
    const host = (local.host && local.host !== '0.0.0.0') ? local.host : 'localhost';
    brokerUrl = `mqtt://${host}:${local.portTcp ?? 1883}`;
    username = local.username || ''; password = local.password || '';
  } else if (mqttCfg.brokerUrl) {
    brokerUrl = mqttCfg.brokerUrl;
    username = mqttCfg.username || ''; password = mqttCfg.password || '';
  } else {
    brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    username = ''; password = '';
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
    mqttClient.subscribe('posts/+/status_relay'); 
    mqttClient.subscribe('tank/levels');
    mqttClient.subscribe('reports/request');
    mqttClient.subscribe('posts/+/config');
    mqttClient.subscribe('posts/+/clientcard');
    mqttClient.subscribe('posts/+/receipt');
    mqttClient.subscribe('posts/+/lwt');
    mqttClient.subscribe('posts/+/receipt_number');
    mqttClient.subscribe('posts/+/clientcardbalance'); 
    
    subscribeRelayTopics();
    refreshRelayRetained();
    if (settings.posts) publishConfigToAllPosts();
  });

  function subscribeRelayTopics() {
    if (!mqttClient || !mqttClient.connected) return;
    const subs = ['+/postnum', '+/udp', '+/status_relay', '+/active', '+/ip', '+/lwt'];
    for (const t of subs) {
      mqttClient.subscribe(t, { qos: 0 }, (err) => {
        if (err) console.warn(`⚠️ Не удалось подписаться на ${t}: ${err.message}`);
      });
    }
    console.log(`📡 Подписка на топики реле активна (${subs.length} шаблонов: +/postnum, +/lwt, …)`);
  }

  function refreshRelayRetained() {
    if (!mqttClient || !mqttClient.connected) return;
    const filters = ['+/lwt', '+/ip', '+/active', '+/status_relay', '+/postnum', '+/udp'];
    for (const subT of filters) {
      try {
        mqttClient.unsubscribe(subT, () => {
          mqttClient.subscribe(subT, { qos: 0 }, (err) => {
            if (err) console.warn(`⚠️ refreshRelayRetained ${subT}: ${err.message}`);
          });
        });
      } catch { /* ignore */ }
    }
    setTimeout(() => discoverRelayMacsFromBroker().catch(() => {}), 1200);
  }

  function getRelayMacForPost(postId) {
    const p = settings.posts?.[postId] || {};
    return (p.relay && p.relay.mac) ? String(p.relay.mac).toUpperCase() : null;
  }

  function publishToPostRelay(postId, subTopic, payloadObj, opts = { qos: 1 }) {
    if (!mqttClient || !mqttClient.connected) return false;
    const mac = getRelayMacForPost(postId);
    if (!mac) return false;
    const topic = subTopic ? `relay_${mac}/${subTopic}` : `relay_${mac}`;
    const payload = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
    mqttClient.publish(topic, payload, opts);
    console.log(`🔌 [RELAY] ${topic} → ${payload}`);
    return true;
  }

  mqttClient.on('message', async (topic, message) => {
    const payload = message.toString();
    broadcast({ type: 'mqtt', topic, payload, timestamp: Date.now() });

    const relayMatch = topic.match(/^relay_([0-9A-Fa-f:]{12})\/?(.*)$/);
    if (relayMatch) {
      const mac = relayMatch[1].toUpperCase();
      const sub = (relayMatch[2] || '').trim();
      try {
        let data;
        try { data = JSON.parse(payload); } catch { data = payload.trim(); }
        relayStates[mac] = relayStates[mac] || { mac, lastSeen: 0 };
        const rs = relayStates[mac];
        rs.lastSeen = Date.now();
        switch (sub) {
          case 'lwt':
            rs.online = parseRelayLwt(payload);
            rs.lwtRaw = payload.length > 64 ? payload.slice(0, 64) + '…' : payload;
            rs.lwtAt = Date.now();
            break;
          case 'ip':
            rs.ip = typeof data === 'string' ? data : (data?.ip ?? data?.value ?? null); break;
          case 'active':
            rs.active = typeof data === 'object' ? data : String(data); break;
          case 'status_relay':
            rs.statusRelay = typeof data === 'object' ? data : String(data); break;
          case 'postnum': {
            const pnRaw = typeof data === 'object' ? (data?.postnum ?? data) : String(data);
            rs.postnum = pnRaw;
            const pn = parseInt(String(pnRaw).trim(), 10);
            if (Number.isInteger(pn) && autoAssignRelayByPostnum(mac, pn)) {
              saveSettings(settings).catch(() => {});
              publishConfigToAllPosts();
              broadcast({ type: 'relay-assigned', postId: pn, mac, timestamp: Date.now() });
            }
            break;
          }
          case 'udp':
            rs.udp = typeof data === 'object' ? data : String(data); break;
          default:
            rs.lastMessage = { topic: sub || '(base)', payload: data, at: Date.now() };
        }
        broadcast({ type: 'relay-status', mac, subTopic: sub, state: rs, timestamp: Date.now() });
      } catch (e) {
        console.warn(`⚠️ Ошибка обработки сообщения реле ${topic}: ${e.message}`);
      }
    }

    if (topic === 'kkm/print') {
      try {
        const receiptData = JSON.parse(payload);
        if (!receiptData.postId) {
          const m = topic.match(/^posts\/(\d+)\//);
          if (m) receiptData.postId = parseInt(m[1], 10);
        }
        if (receiptData.skipDbCreation) return;
        const items = Array.isArray(receiptData.items) ? receiptData.items : [];
        const totalCost = items.reduce((s, it) => s + (Number(it.cost) || 0), 0);
        await createReceipt({
          postId: receiptData.postId || 0,
          kind: receiptData.kind || 'session',
          operation: receiptData.operation || 'sell',
          isAdvance: !!receiptData.isAdvance,
          advanceReceiptNumber: receiptData.advanceReceiptNumber ?? null,
          cardNumber: receiptData.cardNumber || null,
          items,
          totalCost: Math.round(totalCost * 10) / 10,
          balanceAfter: receiptData.balance || 0,
          paymentMethod: receiptData.paymentMethod || null,
          discountTotal: receiptData.discountTotal || 0,
          correctionInfo: receiptData.correctionInfo || null,
          timestamp: receiptData.timestamp,
          paymentAlreadyCounted: receiptData.paymentMethod === 'client_card',
        });
      } catch (err) {
        console.error(`Ошибка сохранения чека из kkm/print:`, err.message);
      }
    }

    if (/^posts\/[^/]+\/receipt$/.test(topic)) {
      try {
        const receiptData = JSON.parse(payload);
        const rPostId = String(receiptData.postId);
        const rState = getPostState(rPostId);
        if (rState._espOfflineAtStart) return;
        if (rState._finalReceiptSentByEsp) return;
        const capturedClientCard = rState.clientCard;
        const capturedInitialBalance = rState._clientCardInitialBalance || 0;
        rState._finalReceiptSentByEsp = true;
        rState._receiptWaitStarted = false;
        (async () => {
          const advances = await Receipt.find({ postId: Number(rPostId), isAdvance: true, finalReceiptNumber: null })
            .sort({ timestamp: -1 }).lean();
          const newestAdvance = advances[0];
          const advanceReceiptNumber = newestAdvance?.receiptNumber || null;
          const advanceAmount = newestAdvance?.totalCost || 0;
          const advancePaymentMethod = newestAdvance?.paymentMethod || null;
          let items = (receiptData.items || []).map(it => ({
            name: it.name || it.program || '?',
            seconds: Number(it.seconds) || 0,
            cost: Number(it.cost) || 0,
            pricePerSecond: Number(it.pricePerSecond) || 0,
          }));
          let totalCost = Math.round(items.reduce((s, i) => s + i.cost, 0) * 100) / 100;
          if (advanceAmount > 0.01 && items.length > 0) {
            const discrepancy = Math.round((advanceAmount - totalCost) * 100) / 100;
            if (discrepancy > 0.001) {
              console.log(
                `[Post ${rPostId}] ℹ️ Аванс ${advanceAmount.toFixed(2)} ₽, ` +
                `израсходовано ${totalCost.toFixed(2)} ₽, ` +
                `возврат клиенту ${discrepancy.toFixed(2)} ₽`
              );
            }
          }
          if (items.length === 0 && advanceAmount > 0) {
            items = [{ name: 'Услуги мойки (аванс)', seconds: 0, cost: advanceAmount, pricePerSecond: 0 }];
            totalCost = advanceAmount;
          }
          if (items.length === 0) return;
          let paymentMethod = advancePaymentMethod;
          let cardNumber = null, initialBalance = 0, remainingBalance = 0;
          if (capturedClientCard) {
            const card = await ClientCard.findOne({ card: capturedClientCard });
            if (card) {
              paymentMethod = 'client_card';
              cardNumber = card.card;
              initialBalance = capturedInitialBalance;
              remainingBalance = card.balance;
            }
          } else if (receiptData.paymentMethod && receiptData.paymentMethod !== 'unknown') {
            paymentMethod = receiptData.paymentMethod;
          }
          const finalReceipt = await createReceipt({
            postId: Number(rPostId), kind: 'final', operation: 'sell', isAdvance: false,
            advanceReceiptNumber, items, totalCost, balanceAfter: 0,
            paymentMethod,
            paymentAlreadyCounted: paymentMethod === 'client_card',
            cardNumber: paymentMethod === 'client_card' ? cardNumber : null,
            timestamp: new Date(),
          });
          const finalNumber    = finalReceipt.receiptNumber;
          const grossTotal     = finalReceipt.grossTotal     ?? finalReceipt.totalCost;
          const advanceApplied = finalReceipt.advanceApplied || 0;
          const netCash        = finalReceipt.totalCost;
          const qrPayload = JSON.stringify({
            postId: Number(rPostId), timestamp: new Date().toISOString(),
            operation: 'Финальный чек по сессии (ESP32)', kind: 'final', isAdvance: false,
            advanceReceiptNumber,
            advanceAmount:   advanceApplied || advanceAmount,
            receiptNumber:   finalNumber,
            shiftNumber:     finalReceipt.shiftNumber,
            grossTotal,
            totalPaid:       advanceApplied || advanceAmount,
            totalCash:       netCash,
            items, balance: 0,
            source: 'esp32', paymentMethod, cardNumber, initialBalance, remainingBalance,
          });
          mqttClient.publish(`posts/${rPostId}/receipt/qr`, qrPayload, { qos: 1 });
          mqttClient.publish('kkm/print', JSON.stringify({ ...JSON.parse(qrPayload), skipDbCreation: true }), { qos: 1 });
          rState.servicesUsage = {};
          rState.receiptCount++;
          publishStatus(rPostId);
        })().catch(err => { console.error(`[Post ${rPostId}] Ошибка обработки чека ESP32: ${err.message}`); });
      } catch (err) {
        console.warn(`⚠️ Ошибка парсинга чека от ESP32: ${err.message}`);
      }
    }

    if (topic.startsWith('posts/') && topic.endsWith('/status_relay')) {
      const postId = topic.split('/')[1];
      try {
        const data = JSON.parse(payload);
        const state = getPostState(postId);
        
        if (typeof data.busy === 'boolean') state.busy = data.busy;
        if (typeof data.paused === 'boolean') state.paused = data.paused;
        if (typeof data.currentProgram === 'string' && data.currentProgram !== '-') {
          state.currentProgram = data.currentProgram;
        }

        if (state.busy && !state.timer && state.currentProgram) {
          console.log(`[Post ${postId}] ⚡ ESP32 started ${state.currentProgram} locally. Starting backend timer.`);
          startTimer(postId);
        }
        
        if (!state.busy && state.timer) {
          console.log(`[Post ${postId}] ⚡ ESP32 stopped locally. Stopping backend timer.`);
          clearInterval(state.timer);
          state.timer = null;
        }
      } catch { /* ignore */ }
    }

    if (topic.startsWith('posts/') && topic.endsWith('/command')) {
      const postId = topic.split('/')[1];
      try {
        const { command } = JSON.parse(payload);
        if (command.startsWith('program ')) handleProgram(postId, command.substring(8).trim());
        else if (command === 'stop') stopPost(postId, true, true);
        else if (command === 'pause') togglePause(postId);
        else if (command.startsWith('add_balance ')) {
          const amount = parseFloat(command.substring(12).trim());
          if (!isNaN(amount) && amount > 0) addBalance(postId, amount);
        } else if (command === 'get_status') publishStatus(postId);
        else if (command === 'reset') resetPost(postId);
        else if (command === 'print_receipt') printReceipt(postId);
      } catch (e) {
        console.error(`Ошибка обработки команды для поста ${postId}:`, e.message);
      }
    }

    if (topic.startsWith('posts/') && topic.endsWith('/status')) {
      const postId = topic.split('/')[1];
      try {
        const data = JSON.parse(payload);
        const state = getPostState(postId);
        const cc = state.clientCard, ccb = state.clientCardBalance, cct = state.clientCardType;
        
        if (typeof data.busy === 'boolean')           state.busy = data.busy;
        if (typeof data.paused === 'boolean')         state.paused = data.paused;
        if (typeof data.currentProgram === 'string')  state.currentProgram = data.currentProgram;
        if (typeof data.elapsedSec === 'number')      state.elapsedSec = data.elapsedSec;
        if (typeof data.totalPaid === 'number')       state.totalPaid = data.totalPaid;
        if (typeof data.receiptCount === 'number')    state.receiptCount = data.receiptCount;
        
        if (!cc && typeof data.balance === 'number') {
          state.balance = data.balance;
        }
        state.lastSeen = Date.now();
        state.clientCard = cc;
        state.clientCardBalance = ccb;
        state.clientCardType = cct;
      } catch { /* ignore */ }
    }

    if (/^posts\/[^/]+\/lwt$/.test(topic)) {
      const postId = topic.split('/')[1];
      const status = (payload || '').trim().toLowerCase();
      const isOnline = (status === 'online');
      const state = getPostState(postId);
      state.online = isOnline;
      if (!isOnline) {
        if (state.clientCard) {
          delete state.clientCard; delete state.clientCardBalance; delete state.clientCardType;
          state.balance = 0; state.postCashBalance = 0; state.busy = false;
        }
      }
    }

    if (/^posts\/[^/]+\/clientcard$/.test(topic)) {
      const postId = topic.split('/')[1];
      try {
        const data = JSON.parse(payload);
        const cardNumber = (data.card || '').toString().trim().toUpperCase();
        const state = getPostState(postId);
        if (!cardNumber || cardNumber === 'NULL') {
          const hadCard = !!state.clientCard;
          delete state.clientCard; delete state.clientCardBalance; delete state.clientCardType;
          state.postCashBalance = 0;
          if (hadCard) {
            state.balance = 0; state.totalPaid = 0; state.receiptCount = 0;
            state.servicesUsage = {}; state.elapsedSec = 0;
            state.busy = false; state.paused = false; state.currentProgram = null;
            if (state.timer) { clearInterval(state.timer); state.timer = null; }
            mqttClient.publish(`posts/${postId}/command`, JSON.stringify({ command: 'reset' }), { qos: 1 });
            publishStatus(postId); publishRelayStatus(postId);
          }
          mqttClient.publish(`posts/${postId}/message`, JSON.stringify({ "": "" }), { qos: 0 });
          return;
        }
        const busyPostId = findPostWithCard(cardNumber, postId);
        if (busyPostId) {
          delete state.clientCard; delete state.clientCardBalance; delete state.clientCardType;
          mqttClient.publish(`posts/${postId}/message`,
            JSON.stringify({ ERR: `КАРТА УЖЕ ИСПОЛЬЗУЕТСЯ НА ПОСТУ ${busyPostId}` }), { qos: 1 });
          broadcast({
            type: 'card-scan', postId, card: cardNumber, balance: 0, cardType: 'busy', known: false,
            error: `Карта уже используется на посту ${busyPostId}`, timestamp: Date.now(),
          });
          return;
        }
        const prevCard = state.clientCard;
        state.clientCard = cardNumber;
        const clientCard = await ClientCard.findOne({ card: cardNumber });
        if (!clientCard) {
          delete state.clientCardBalance; delete state.clientCardType;
          broadcast({
            type: 'card-scan', postId, card: cardNumber, balance: 0, cardType: 'unknown', known: false,
            timestamp: Date.now(),
          });
          return;
        }

        if (!prevCard && typeof state.balance === 'number' && state.balance > 0.01) {
          state.postCashBalance = Math.round(state.balance * 100) / 100;
        }

        const switchingCard = !!prevCard && prevCard !== cardNumber;
        if (switchingCard) {
          mqttClient.publish(`posts/${postId}/command`, JSON.stringify({ command: 'reset' }), { qos: 1 });
          await new Promise(r => setTimeout(r, 300));
          state.postCashBalance = 0;
          state.balance = 0;
        }

        state.clientCardBalance = clientCard.balance;
        state.clientCardType = clientCard.type;
        state._clientCardInitialBalance = clientCard.balance;

        mqttClient.publish(`posts/${postId}/clientcardbalance`,
          JSON.stringify({ card: clientCard.card, balance: clientCard.balance, type: clientCard.type }), { qos: 1 });
        mqttClient.publish(`posts/${postId}/message`, JSON.stringify({ "": "" }), { qos: 0 });
        publishStatus(postId);
        broadcast({
          type: 'card-scan', postId, card: clientCard.card, balance: clientCard.balance,
          postCashBalance: state.postCashBalance || 0,
          cardType: clientCard.type, known: true, timestamp: Date.now(),
        });
      } catch (err) { console.error(`Ошибка обработки posts/${postId}/clientcard:`, err.message); }
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
  Counter, Shift,
  broadcastShiftTotal: (...a) => broadcastShiftTotal(...a),
  publishKkmStatus:    (...a) => publishKkmStatus(...a),
  ensureOpenShift:     (...a) => ensureOpenShift(...a),
});

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
function normalizeDimmerDosing(dimmerMaskMap, dimmerDosingMap, serviceNames) {
  const result = {};
  for (const name of serviceNames) {
    const mask = Number(dimmerMaskMap?.[name]) || 0;
    const saved = (dimmerDosingMap && dimmerDosingMap[name]) || {};
    const dosing = {};
    for (let d = 1; d <= 4; d++) {
      const selected = (mask & (1 << (d - 1))) !== 0;
      if (!selected) dosing[d] = 0;
      else {
        const v = saved[d];
        dosing[d] = (v !== undefined && v !== null && !isNaN(Number(v))) ? Number(v) : 100;
      }
    }
    result[name] = dosing;
  }
  return result;
}

function buildServicesPayloadForPost(postId) {
  const p = settings.posts?.[postId] || {};
  const prices = p.prices || {};
  const relayMask = p.relayMask || {};
  const vfd = p.vfdFrequencies || {};
  const dimmer = p.dimmerMask || {};
  const buttons = p.buttonInputs || {};
  const delays = p.relayDelays || {};
  const rawDosing = p.dimmerDosing || {};
  let services = p.services || [];
  if (!services.length) {
    const names = new Set([
      ...Object.keys(prices),
      ...Object.keys(relayMask).filter(k => !k.includes('_')),
      ...Object.keys(buttons).filter(k => !k.includes('_')),
    ]);
    services = [...names].map(name => ({ name, price: prices[name] ?? 0, free_time_sec: 0, enabled: true }));
  }
  const servicesPayload = services.map(svc => ({
    name: svc.name,
    price: prices[svc.name] ?? svc.price ?? 0,
    free_time_sec: svc.free_time_sec ?? 0,
    relayMask: relayMask[svc.name] ?? 0,
    dimmerMask: dimmer[svc.name] ?? 0,
    vfdFrequency: vfd[svc.name] ?? 40,
    onDelay: delays[svc.name]?.onDelay ?? 100,
    offDelay: delays[svc.name]?.offDelay ?? 200,
    buttonInput: buttons[svc.name] ?? 0,
    enabled: svc.enabled !== false,
  }));
  const serviceNames = servicesPayload.map(s => s.name);
  const dimmerDosing = normalizeDimmerDosing(dimmer, rawDosing, serviceNames);
  return { services: servicesPayload, dimmerDosing };
}

function publishConfigToAllPosts() {
  if (!mqttClient) { console.warn('❌ publishConfigToAllPosts: mqttClient НЕ подключён'); return; }
  if (!mqttClient.connected) { console.warn('❌ publishConfigToAllPosts: mqttClient есть, но не connected'); return; }
  const n = settings.numberOfPosts || 8;
  console.log(`📤 publishConfigToAllPosts: публикуем в ${n} постов`);
  for (let i = 1; i <= n; i++) {
    const payload = buildServicesPayloadForPost(i);
    console.log(`posts/${i}/config → ${payload.services.length} услуг, дозация:`, payload.dimmerDosing);
    mqttClient.publish(`posts/${i}/config`, JSON.stringify(payload), { qos: 1, retain: true });
  }
  console.log(`📤 Конфиг опубликован в posts/*/config (${n} постов)`);
}

async function fetchKkmStatusFromDriver() {
  try {
    const r = await axios.get(`${KKM_DRIVER_URL}/status`, { timeout: 2000 });
    return r.data || null;
  } catch (e) { return null; }
}

async function publishKkmStatus() {
  if (!mqttClient) return;
  try {
    const shift = await Shift.findOne({ shiftOpen: true }).lean();
    const driverData = await fetchKkmStatusFromDriver();
    if (driverData) {
      let changed = false;
      if (driverData.kkNumber && settings.kkmManual.kkNumber !== driverData.kkNumber) { settings.kkmManual.kkNumber = driverData.kkNumber; changed = true; }
      if (driverData.shiftNumber != null && settings.kkmManual.fiscalShiftNumber !== driverData.shiftNumber) { settings.kkmManual.fiscalShiftNumber = driverData.shiftNumber; changed = true; }
      if (driverData.cashierName && settings.kkmManual.cashierName !== driverData.cashierName) { settings.kkmManual.cashierName = driverData.cashierName; changed = true; }
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
  } catch (err) {
    console.warn('publishKkmStatus:', err.message);
  }
}

async function broadcastShiftTotal() {
  try {
    const currentShift = await Shift.findOne({ shiftOpen: true });
    if (!currentShift) {
      const payload = JSON.stringify({ shiftNumber: null, total: 0, count: 0, avgCheck: 0, paymentMethods: {} });
      broadcast({ type: 'mqtt', topic: 'shift/total', payload, timestamp: Date.now() });
      return;
    }
    const receipts = await Receipt.find(accountingQuery({ shiftNumber: currentShift.shiftNumber }));
    const total = receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0);
    const { avgCheck } = computeAverageCheck(receipts);
    const paymentMethods = calculatePaymentSummary(receipts);

    const payload = JSON.stringify({ shiftNumber: currentShift.shiftNumber, total, count: receipts.length, avgCheck, paymentMethods });
    
    if (mqttClient) mqttClient.publish('shift/total', payload, { qos: 0 });
    broadcast({ type: 'mqtt', topic: 'shift/total', payload, timestamp: Date.now() });
  } catch (err) {
    console.warn('broadcastShiftTotal:', err.message);
  }
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
          buttonInputs: {}, relayDelays: {}, dimmerDosing: {},
          services: defaultServices.map(s => ({ ...s }))
        };
      }
      settings.posts = posts;
      doc = new Setting({ key: 'main', value: settings });
      await doc.save();
      console.log('Настройки созданы в БД');
    } else {
      settings = doc.value;
      console.log('[loadSettings] posts[1].services:',
        JSON.stringify(settings.posts?.['1']?.services?.map(s => ({ n: s.name, e: s.enabled }))));
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
            dimmerDosing: {},
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
              buttonInputs: {}, relayDelays: {}, dimmerDosing: {},
              services: defaultServices2.map(s => ({ ...s }))
            };
          } else if (!settings.posts[i].services) {
            settings.posts[i].services = defaultServices2.map(s => ({ ...s }));
          }
          if (!settings.posts[i].dimmerDosing) { settings.posts[i].dimmerDosing = {}; }
          settings.posts[i].services = settings.posts[i].services.map(s => ({ ...s, enabled: s.enabled !== false }));
        }
        await saveSettings(settings);
      }
      console.log('Настройки загружены из БД');
    }
    if (settings.mqtt) { mqttSettings = settings.mqtt; connectMqtt(mqttSettings); }
    else { connectMqtt({ brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883' }); }
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
const relayStates = {};

function parseRelayLwt(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return true;
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s);
      if (typeof o.online === 'boolean') return o.online;
      const st = String(o.state ?? o.status ?? '').toLowerCase();
      if (st) return ['online', 'on', '1', 'true', 'connected', 'up', 'alive'].includes(st);
      const n = Number(Object.values(o)[0]);
      if (Number.isFinite(n)) return n >= 1700000000 ? true : n > 0;
    } catch { /* не JSON */ }
  }
  const low = s.toLowerCase();
  if (['1', 'true', 'on', 'online', 'connect', 'connected', 'up', 'alive', 'ok'].includes(low)) return true;
  if (['0', 'false', 'off', 'offline', 'disconnect', 'disconnected', 'down', 'lost', 'dead'].includes(low)) return false;
  const num = Number(s);
  if (Number.isFinite(num)) return num >= 1700000000 ? true : num > 0;
  return false;
}

function getPostState(postId) {
  let s = postsState[postId];
  if (!s) s = postsState[postId] = {};

  if (typeof s.busy !== 'boolean')             s.busy = false;
  if (typeof s.paused !== 'boolean')           s.paused = false;
  if (typeof s.balance !== 'number')           s.balance = 0;
  if (typeof s.postCashBalance !== 'number')   s.postCashBalance = 0;
  if (s.currentProgram === undefined)          s.currentProgram = null;
  if (typeof s.elapsedSec !== 'number')        s.elapsedSec = 0;
  if (typeof s.totalPaid !== 'number')         s.totalPaid = 0;
  if (typeof s.receiptCount !== 'number')      s.receiptCount = 0;
  if (!s.servicesUsage || typeof s.servicesUsage !== 'object') s.servicesUsage = {};
  if (s.timer === undefined)                   s.timer = null;
  if (typeof s.online !== 'boolean')           s.online = false;
  if (s._espOfflineAtStart === undefined)      s._espOfflineAtStart = false;
  if (s._finalReceiptSentByEsp === undefined)  s._finalReceiptSentByEsp = false;
  if (s._receiptWaitStarted === undefined)     s._receiptWaitStarted = false;
  return s;
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
    balance: Math.round((state.balance || 0) * 100) / 100,
    postCashBalance: Math.round((state.postCashBalance || 0) * 100) / 100,
    clientCard: state.clientCard || null, // ★ ДОБАВЛЕНО: передаем номер карты
    clientCardBalance: typeof state.clientCardBalance === 'number'
      ? Math.round(state.clientCardBalance * 100) / 100
      : null,
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
  console.log(`💳 [Post ${postId}] Списано ${actual.toFixed(2)} ₽ с ${card.card}`);
}

function startTimer(postId) {
  const state = getPostState(postId);
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(async () => {
    if (!state.busy || state.paused) return;
    const service = findService(postId, state.currentProgram);
    if (!service) { stopPost(postId, true, false); return; }

    if (!state.servicesUsage || typeof state.servicesUsage !== 'object') {
      state.servicesUsage = {};
    }

    const pricePerSec = service.price / 60;
    const deltaSec = 1;
    const cost = pricePerSec * deltaSec;

    if (state.clientCard) {
      try {
        const card = await ClientCard.findOneAndUpdate(
          { card: state.clientCard, balance: { $gte: cost } },
          { $inc: { balance: -cost } },
          { new: true }
        );
        if (!card) {
          console.log(`[Post ${postId}] 💳 Карта закончилась. Останавливаем пост.`);
          stopPost(postId, true, true);
          return;
        }
        state.clientCardBalance = card.balance;

        state.elapsedSec += deltaSec;
        if (!state.servicesUsage[service.name]) state.servicesUsage[service.name] = { seconds: 0, cost: 0 };
        state.servicesUsage[service.name].seconds += deltaSec;
        state.servicesUsage[service.name].cost += cost;

        if (mqttClient) {
          mqttClient.publish(`posts/${postId}/clientcardbalance`, JSON.stringify({
            card: card.card, balance: card.balance, type: card.type,
          }), { qos: 1 });
        }
        publishStatus(postId);
      } catch (e) {
        console.error(`[Post ${postId}] Ошибка списания с карты:`, e.message);
      }
    } else {
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
    }
  }, 1000);
}

function handleProgram(postId, programName) {
  const state = getPostState(postId);
  const service = findService(postId, programName);
  if (!service) return;
  if (state.busy) stopPost(postId, false, false);
  const pricePerSec = service.price / 60;
  
  if (!state.clientCard && state.balance < pricePerSec && state.balance < 0.01) return;
  
  if (state.timer) clearInterval(state.timer);
  state.busy = true; state.paused = false; state.currentProgram = service.name;
  state.elapsedSec = 0;
  startTimer(postId);
  publishStatus(postId); publishRelayStatus(postId);
}

function stopPost(postId, publish = true, printReceiptFlag = false) {
  const state = getPostState(postId);
  if (!state.busy && !printReceiptFlag) return;
  if (printReceiptFlag && Object.keys(state.servicesUsage || {}).length > 0) printReceipt(postId);
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
  
  if (state.clientCard) {
    console.warn(`[Post ${postId}] Попытка добавить баланс на пост, но активна карта ${state.clientCard}. Игнорируем.`);
    return;
  }

  const wasZero = state.balance < 0.01;
  state.balance = Math.round((state.balance + amount) * 100) / 100;
  state.totalPaid = Math.round((state.totalPaid + amount) * 100) / 100;
  if (wasZero) {
    state.servicesUsage = {};
    state.receiptCount = 0;
    state.elapsedSec = 0;
    state._espOfflineAtStart = state.online === false;
    state._finalReceiptSentByEsp = false;
    state._receiptWaitStarted = false;
    console.log(`[Post ${postId}] 🆕 Новая сессия (espOfflineAtStart=${state._espOfflineAtStart})`);
  }
  publishStatus(postId);
}

function resetPost(postId) {
  const state = getPostState(postId);
  if (state.timer) clearInterval(state.timer);
  postsState[postId] = {
    busy: false, paused: false, balance: 0, postCashBalance: 0, currentProgram: null,
    elapsedSec: 0, totalPaid: 0, receiptCount: 0, servicesUsage: {}, timer: null,
    online: state.online || false,
    _espOfflineAtStart: false, _finalReceiptSentByEsp: false, _receiptWaitStarted: false
  };
  publishStatus(postId); publishRelayStatus(postId);
}

function printReceipt(postId) {
  const state = getPostState(postId);
  if (!state._espOfflineAtStart && !state._finalReceiptSentByEsp && !state._receiptWaitStarted) {
    state._receiptWaitStarted = true;
    console.log(`[Post ${postId}] ⏳ Ждём чек от ESP32 (2.5с)...`);
    setTimeout(() => {
      state._receiptWaitStarted = false;
      if (!state._finalReceiptSentByEsp) {
        console.warn(`[Post ${postId}] ⏰ ESP32 не прислал чек — используем данные бэкенда`);
        _doPrintReceiptFromBackend(postId).catch(err =>
          console.error(`[Post ${postId}] Ошибка backend-чека: ${err.message}`));
      }
    }, 2500);
    return;
  }
  if (state._finalReceiptSentByEsp) {
    console.log(`[Post ${postId}] ℹ️ Чек ESP32 уже применён, пропускаем backend-печать`);
    return;
  }
  _doPrintReceiptFromBackend(postId).catch(err =>
    console.error(`[Post ${postId}] Ошибка backend-чека: ${err.message}`));
}

async function _doPrintReceiptFromBackend(postId) {
  const state = getPostState(postId);
  const items = [];
  let totalCost = 0;
  for (const [name, usage] of Object.entries(state.servicesUsage || {})) {
    if (usage.seconds > 0.001) {
      items.push({
        name, seconds: Math.round(usage.seconds * 1000) / 1000,
        cost: Math.round(usage.cost * 100) / 100,
        pricePerSecond: Math.round((usage.cost / usage.seconds) * 100) / 100
      });
      totalCost += usage.cost;
    }
  }
  const balanceAfter = Math.round(state.balance * 100) / 100;
  const advances = await Receipt.find({ postId: Number(postId), isAdvance: true, finalReceiptNumber: null })
    .sort({ timestamp: -1 }).lean();
  const newestAdvance = advances[0];
  const advanceReceiptNumber = newestAdvance?.receiptNumber || null;
  const advanceAmount = newestAdvance?.totalCost || 0;
  const advancePaymentMethod = newestAdvance?.paymentMethod || null;
  let paymentMethod = advancePaymentMethod;
  let cardNumber = null, initialBalance = 0, remainingBalance = 0;
  if (state.clientCard) {
    const card = await ClientCard.findOne({ card: state.clientCard });
    if (card) {
      paymentMethod = 'client_card';
      cardNumber = card.card;
      initialBalance = state._clientCardInitialBalance || 0;
      remainingBalance = card.balance;
    }
  }
  totalCost = Math.round(items.reduce((s, i) => s + (i.cost || 0), 0) * 100) / 100;
  if (advanceAmount > 0.01 && items.length > 0) {
    const discrepancy = Math.round((advanceAmount - totalCost) * 100) / 100;
    if (discrepancy > 0.001) {
      console.log(
        `[Post ${postId}] ℹ️ Аванс ${advanceAmount.toFixed(2)} ₽,` +
        `израсходовано ${totalCost.toFixed(2)} ₽,` +
        `возврат клиенту ${discrepancy.toFixed(2)} ₽`
      );
    }
  }
  let finalItems = items;
  if ((!items.length || totalCost < 0.01) && advanceReceiptNumber) {
    finalItems = [{ name: 'Услуги мойки (аванс)', seconds: 0, cost: advanceAmount, pricePerSecond: 0 }];
    totalCost = advanceAmount;
  }
  if (!finalItems.length) return;
  const finalReceipt = await createReceipt({
    postId: Number(postId), kind: 'final', operation: 'sell', isAdvance: false,
    advanceReceiptNumber, items: finalItems, totalCost, balanceAfter,
    paymentMethod,
    paymentAlreadyCounted: paymentMethod === 'client_card',
    cardNumber: paymentMethod === 'client_card' ? cardNumber : null,
    timestamp: new Date(),
  });
  const finalNumber    = finalReceipt.receiptNumber;
  const grossTotal     = finalReceipt.grossTotal     ?? finalReceipt.totalCost;
  const advanceApplied = finalReceipt.advanceApplied || 0;
  const netCash        = finalReceipt.totalCost;

  console.log(
    `[Post ${postId}] 💾 Финальный чек №${finalNumber} (shift=${finalReceipt.shiftNumber}): ` +
    `gross=${grossTotal.toFixed(2)}, advanceApplied=${advanceApplied.toFixed(2)}, net=${netCash.toFixed(2)}`
  );

  const qrPayload = JSON.stringify({
    postId: parseInt(postId), timestamp: new Date().toISOString(),
    operation: 'Финальный чек по сессии', kind: 'final', isAdvance: false,
    advanceReceiptNumber,
    advanceAmount: advanceApplied || advanceAmount,
    receiptNumber: finalNumber,
    shiftNumber:   finalReceipt.shiftNumber,
    grossTotal,
    totalPaid:     advanceApplied || advanceAmount,
    totalCash:     netCash,
    items: finalItems, balance: balanceAfter,
    source: 'backend', paymentMethod, cardNumber, initialBalance, remainingBalance,
  });
  mqttClient.publish(`posts/${postId}/receipt/qr`, qrPayload, { qos: 1 });
  mqttClient.publish('kkm/print', JSON.stringify({ ...JSON.parse(qrPayload), skipDbCreation: true }), { qos: 1 });
  state.servicesUsage = {};
  state.receiptCount++;
  publishStatus(postId);
  console.log(`[Post ${postId}] 📤 QR + печать отправлены с номером №${finalNumber}`);
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
  try {
    const shift = await Shift.findOne({ shiftOpen: true });
    if (!shift) return null;

    const openedTs = shift.openedAt ? new Date(shift.openedAt).getTime() : null;
    if (!openedTs || isNaN(openedTs)) {
      console.warn(`⚠️ Смена №${shift.shiftNumber} имеет битый openedAt — пропускаем авто-закрытие`);
      return shift;
    }
    const autoCloseTs = shift.autoCloseAt
      ? new Date(shift.autoCloseAt).getTime()
      : getShiftAutoCloseAt(shift.openedAt).getTime();
    if (Date.now() < autoCloseTs) return shift;

    const closedAt = new Date();
    shift.shiftOpen = false;
    shift.closedAt = closedAt;
    shift.autoClosed = true;

    let total = 0, count = 0;
    try {
      const receipts = await Receipt.find(accountingQuery({ shiftNumber: shift.shiftNumber }));
      total = receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0);
      count = receipts.length;
    } catch (e) {
      console.warn(`⚠️ [shift ${shift.shiftNumber}] Не удалось посчитать итог: ${e.message}`);
    }
    shift.zReport = { total, count, generatedAt: closedAt, cashier: 'system (auto)' };
    await shift.save();
    console.log(`♻️ Смена №${shift.shiftNumber} автозакрыта (прошло 24 часа)`);

    const nextNumber = await getNextShiftNumber();
    const openedAt = new Date();
    const newShift = await Shift.create({
      shiftNumber: nextNumber, shiftOpen: true, openedAt,
      autoCloseAt: getShiftAutoCloseAt(openedAt), cashier: 'system (auto)',
    });
    console.log(`♻️ Открыта новая смена №${nextNumber}`);

    try { await publishKkmStatus(); } catch (e) { console.warn('publishKkmStatus:', e.message); }
    try { await broadcastShiftTotal(); } catch (e) { console.warn('broadcastShiftTotal:', e.message); }

    return newShift;
  } catch (err) {
    console.error('❌ closeExpiredShiftIfNeeded:', err && err.stack ? err.stack : err);
    return null;
  }
}

async function ensureOpenShift() {
  await closeExpiredShiftIfNeeded();
  let shift = await Shift.findOne({ shiftOpen: true });
  if (shift) return shift;
  const nextNumber = await getNextShiftNumber();
  const openedAt = new Date();
  shift = await Shift.create({
    shiftNumber: nextNumber, shiftOpen: true, openedAt,
    autoCloseAt: getShiftAutoCloseAt(openedAt), cashier: 'system (auto)',
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
      shiftNumber: nextNumber, shiftOpen: true, openedAt,
      autoCloseAt: getShiftAutoCloseAt(openedAt), cashier: 'system',
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
        postsWithCard.push(id);
      }
    }
    if (!postsWithCard.length) return;
    const payload = JSON.stringify({ card: clientCard.card, balance: clientCard.balance, type: clientCard.type });
    for (const postId of postsWithCard) {
      mqttClient.publish(`posts/${postId}/clientcardbalance`, payload, { qos: 1 });
      publishStatus(postId);
      broadcast({
        type: 'card-balance', postId, card: clientCard.card,
        balance: clientCard.balance, cardType: clientCard.type, timestamp: Date.now(),
      });
    }
  } catch (err) { console.error('publishCardBalanceToPosts error:', err.message); }
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
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'secretkey'); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'developer') {
    return res.status(403).json({ error: 'Admin required' });
  }
  next();
}
function viewerOrAdmin(req, res, next) {
  const role = req.user && req.user.role;
  if (role === 'admin' || role === 'developer' || role === 'viewer') return next();
  return res.status(403).json({ error: 'Viewer or admin required' });
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
  } catch { return memoryUsers.find(u => u.username === username); }
}

// ---------- Users API ----------
app.get('/api/users', auth, adminOnly, async (_req, res) => {
  try {
    const users = await User.find({}, { password: 0 }).lean();
    res.json(users.map(u => ({
      _id: u._id, login: u.username, fullName: u.fullName || u.username,
      email: u.email || `${u.username}@carwash.local`, role: u.role,
      group: u.role === 'admin' ? 'Администратор' : u.role === 'developer' ? 'Разработчик' : u.role === 'operator' ? 'Оператор' : 'Пользователь',
      isActive: u.isActive !== false, createdAt: u.createdAt
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
  const token = jwt.sign({ username, role: user.role }, process.env.JWT_SECRET || 'secretkey', { expiresIn: '30d' });
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
        const { timer, ...safeState } = state;
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
app.get('/api/settings', (_req, res) => {
  try { res.json(settings); }
  catch (err) {
    console.error('❌ /api/settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Реле
// ============================================================
function normalizeMac(mac) {
  const s = String(mac || '').trim().toUpperCase();
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(s) ? s : null;
}

function autoAssignRelayByPostnum(mac, postnum) {
  const normMac = normalizeMac(mac);
  if (!normMac) return false;
  const post = Number(postnum);
  if (!Number.isInteger(post) || post < 1 || post > (settings.numberOfPosts || 8)) return false;
  const postId = String(post);
  if (!settings.posts) settings.posts = {};
  if (!settings.posts[postId]) {
    settings.posts[postId] = {
      prices: {}, relayMask: {}, vfdFrequencies: {}, dimmerMask: {},
      buttonInputs: {}, relayDelays: {}, dimmerDosing: {}, services: []
    };
  }
  const currentMac = String(settings.posts[postId]?.relay?.mac || '').toUpperCase();
  if (currentMac === normMac) return false;
  for (const [pid, pdata] of Object.entries(settings.posts)) {
    if (pid !== postId && String(pdata?.relay?.mac || '').toUpperCase() === normMac) {
      delete pdata.relay;
      console.log(`🔁 [AUTO-ASSIGN] Реле ${normMac} снято с поста ${pid} (перепривязка на пост ${postId})`);
    }
  }
  if (currentMac) {
    console.log(`🔁 [AUTO-ASSIGN] Реле ${currentMac} снято с поста ${postId} (заменяется на ${normMac})`);
  }
  settings.posts[postId].relay = { mac: normMac };
  console.log(`✅ [AUTO-ASSIGN] Реле ${normMac} привязано к посту ${postId} (из топика /postnum)`);
  return true;
}

async function discoverRelayMacsFromBroker() {
  if (!mqttClient || !mqttClient.connected) return [];
  const topics = await new Promise((resolve) => {
    const acc = new Map();
    let done = false;
    const finish = () => { if (!done) { done = true; try { mqttClient.removeListener('message', onData); } catch {} resolve(acc); } };
    const collect = (line) => {
      const parts = String(line).trim().split(/\s+/);
      const t = parts[0];
      if (/^relay_[0-9A-Fa-f:]{12}(\/(postnum|udp|status_relay|active|ip|lwt))?$/i.test(t)) {
        acc.set(t, parts.slice(1).join(' '));
      }
    };
    const onData = (topic, payload) => {
      if (!/\bLISTNRET\b/i.test(topic) && !/RETNILTSNI/.test(topic)) return;
      try { String(payload).split(/\r?\n/).forEach(collect); } catch { /* ignore */ }
    };
    try {
      mqttClient.on('message', onData);
      let ok = false;
      for (const req of ['$CONTROL/LISTNREQ', '$CONTROL/RETNILTSNI']) {
        try { mqttClient.publish(req, 'LISTNRET', { qos: 0, retain: false }, () => {}); ok = true; } catch { /* ignore */ }
      }
      if (!ok) return finish();
      setTimeout(finish, 1000);
    } catch { finish(); }
  }).catch(() => new Map());

  const macs = [];
  const macToPostnum = new Map();
  for (const [t, val] of (topics instanceof Map ? topics : [])) {
    const m = t.match(/^relay_([0-9A-Fa-f:]{12})(?:\/(lwt|ip|postnum))?$/i);
    if (!m) continue;
    const mac = m[1].toUpperCase();
    macs.push(mac);
    relayStates[mac] = relayStates[mac] || { mac, lastSeen: 0 };
    const rs = relayStates[mac];
    const sub = (m[2] || '').toLowerCase();
    if (sub === 'lwt') {
      rs.online = parseRelayLwt(val);
      rs.lwtRaw = val.length > 64 ? val.slice(0, 64) + '…' : val;
      rs.lwtAt = Date.now();
    } else if (sub === 'ip' && !rs.ip) {
      rs.ip = val.trim() || null;
    } else if (sub === 'postnum') {
      const pn = parseInt(String(val).trim(), 10);
      if (Number.isInteger(pn)) { rs.postnum = pn; macToPostnum.set(mac, pn); }
    }
  }
  let changed = false;
  for (const [mac, pn] of macToPostnum) {
    if (autoAssignRelayByPostnum(mac, pn)) changed = true;
  }
  if (changed) {
    await saveSettings(settings);
    publishConfigToAllPosts();
    console.log('💾 [AUTO-ASSIGN] Настройки сохранены после автопривязки реле');
  }
  return [...new Set(macs)];
}

async function listKnownRelays() {
  const macs = new Set(Object.keys(relayStates).map(m => m.toUpperCase()));
  if (mqttClient && mqttClient.connected) {
    try { for (const mac of await discoverRelayMacsFromBroker()) macs.add(mac); }
    catch { /* ignore */ }
  }
  {
    const n = settings.numberOfPosts || 8;
    for (let i = 1; i <= n; i++) {
      const rm = normalizeMac(settings.posts?.[i]?.relay?.mac);
      if (rm) macs.add(rm);
    }
  }
  return [...macs].sort().map(mac => {
    const rs = relayStates[mac] || {};
    const assignedPost = (() => {
      const n = settings.numberOfPosts || 8;
      for (let i = 1; i <= n; i++) {
        const rm = settings.posts?.[i]?.relay?.mac;
        if (rm && String(rm).toUpperCase() === mac) return i;
      }
      return null;
    })();
    return {
      mac, topic: `relay_${mac}`,
      online: rs.online ?? null, lwtRaw: rs.lwtRaw ?? null, lwtAt: rs.lwtAt ?? null,
      ip: rs.ip ?? null, statusRelay: rs.statusRelay ?? null,
      active: rs.active ?? null, postnum: rs.postnum ?? null, udp: rs.udp ?? null,
      lastSeen: rs.lastSeen || null, assignedPost,
    };
  });
}

app.get('/api/relays', auth, async (_req, res) => {
  try { res.json({ relays: await listKnownRelays() }); }
  catch (err) { console.error('❌ /api/relays:', err.message); res.status(500).json({ error: err.message }); }
});

app.post('/api/relays/discover', auth, adminOnly, async (_req, res) => {
  try { res.json({ relays: await listKnownRelays() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/posts/:postId/relay', auth, adminOnly, async (req, res) => {
  const postId = String(req.params.postId);
  try {
    const rawMac = req.body?.mac;
    let mac = null;
    if (rawMac !== null && rawMac !== undefined && String(rawMac).trim() !== '') {
      mac = normalizeMac(String(rawMac).replace(/^relay_/, ''));
      if (!mac) return res.status(400).json({ error: `Некорректный MAC реле: ${rawMac}` });
    }
    if (mac) {
      const n = settings.numberOfPosts || 8;
      for (let i = 1; i <= n; i++) {
        if (i !== Number(postId) && String(settings.posts?.[i]?.relay?.mac || '').toUpperCase() === mac) {
          return res.status(409).json({ error: `Реле ${mac} уже назначено посту ${i}` });
        }
      }
    }
    if (!settings.posts) settings.posts = {};
    if (!settings.posts[postId]) {
      settings.posts[postId] = {
        prices: {}, relayMask: {}, vfdFrequencies: {}, dimmerMask: {},
        buttonInputs: {}, relayDelays: {}, dimmerDosing: {}, services: []
      };
    }
    if (mac) settings.posts[postId].relay = { mac };
    else delete settings.posts[postId].relay;
    await saveSettings(settings);
    publishConfigToAllPosts();
    if (mac) publishToPostRelay(postId, 'postnum', { postnum: Number(postId) });
    broadcast({ type: 'relay-assigned', postId: Number(postId), mac, timestamp: Date.now() });
    res.json({ ok: true, postId: Number(postId), relay: mac ? { mac, topic: `relay_${mac}` } : null });
  } catch (err) {
    console.error('❌ PUT /api/posts/:postId/relay:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/relays/:mac/command', auth, adminOnly, (req, res) => {
  const mac = normalizeMac(req.params.mac);
  if (!mac) return res.status(400).json({ error: 'Некорректный MAC' });
  if (!mqttClient || !mqttClient.connected) return res.status(503).json({ error: 'MQTT не подключён' });
  try {
    const sub = String(req.body?.subTopic || '').replace(/^\/+/, '');
    if (sub && !/^(postnum|udp|status_relay|active|ip|lwt)$/.test(sub)) {
      return res.status(400).json({ error: `Недопустимый подтопик: ${sub}` });
    }
    const payload = req.body?.payload ?? {};
    const topic = sub ? `relay_${mac}/${sub}` : `relay_${mac}`;
    mqttClient.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 1 });
    console.log(`🔌 [RELAY API] ${topic}`);
    res.json({ ok: true, topic });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/settings', auth, adminOnly, async (req, res) => {
  try {
    const newSettings = req.body;
    if (newSettings.prices || newSettings.relayMask || newSettings.vfdFrequencies ||
        newSettings.dimmerMask || newSettings.buttonInputs || newSettings.relayDelays ||
        newSettings.services || newSettings.dimmerDosing) {
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
          dimmerDosing: newSettings.dimmerDosing ? { ...newSettings.dimmerDosing } : {},
          services: services.map(s => ({ ...s, enabled: s.enabled !== false }))
        };
      }
      newSettings.posts = posts;
      delete newSettings.prices; delete newSettings.relayMask; delete newSettings.vfdFrequencies;
      delete newSettings.dimmerMask; delete newSettings.buttonInputs; delete newSettings.relayDelays;
      delete newSettings.dimmerDosing; delete newSettings.services;
    }

    settings = { ...settings, ...newSettings };

    if (newSettings.posts) {
      const seenMacs = new Map();
      for (const [postId, postData] of Object.entries(newSettings.posts)) {
        const m = normalizeMac(postData?.relay?.mac);
        if (m) {
          if (seenMacs.has(m)) {
            return res.status(409).json({
              error: `Реле ${m} указано нескольким постам в запросе (${seenMacs.get(m)} и ${postId})`
            });
          }
          seenMacs.set(m, postId);
        }
      }

      for (const [postId, postData] of Object.entries(newSettings.posts)) {
        if (!settings.posts[postId]) {
          settings.posts[postId] = {
            prices: {}, relayMask: {}, vfdFrequencies: {}, dimmerMask: {},
            buttonInputs: {}, relayDelays: {}, dimmerDosing: {}, services: []
          };
        }
        settings.posts[postId] = { ...settings.posts[postId], ...postData };
        if (settings.posts[postId].services) {
          settings.posts[postId].services = settings.posts[postId].services.map(s => ({ ...s, enabled: s.enabled !== false }));
        }
        if (!settings.posts[postId].dimmerDosing) { settings.posts[postId].dimmerDosing = {}; }

        {
          const post = settings.posts[postId];
          const svcNames = (post.services || []).map(s => s.name);
          if (svcNames.length) {
            post.dimmerDosing = normalizeDimmerDosing(post.dimmerMask || {}, post.dimmerDosing || {}, svcNames);
          }
        }

        if ('relay' in postData) {
          const rawMac = postData.relay?.mac;
          if (rawMac) {
            const norm = normalizeMac(String(rawMac).replace(/^relay_/, ''));
            if (!norm) return res.status(400).json({ error: `Некорректный MAC реле для поста ${postId}: ${rawMac}` });
            let conflict = null;
            for (let i = 1; i <= (settings.numberOfPosts || 8); i++) {
              if (String(i) !== String(postId) && !(String(i) in newSettings.posts) &&
                  String(settings.posts[i]?.relay?.mac || '').toUpperCase() === norm) {
                conflict = i; break;
              }
            }
            if (conflict) return res.status(409).json({ error: `Реле ${norm} уже назначено посту ${conflict}` });
            settings.posts[postId].relay = { mac: norm };
            publishToPostRelay(postId, 'postnum', { postnum: Number(postId) });
          } else {
            delete settings.posts[postId].relay;
          }
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
  try {
    console.log('📥 POST /api/publish-config получен');
    publishConfigToAllPosts();
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/publish-config:', err.message);
    res.status(500).json({ error: err.message });
  }
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
    mqttClient.publish(`posts/${req.params.postId}/command`, JSON.stringify({ command }), { qos: 1 });
    console.log(`📤 [API] posts/${req.params.postId}/command → ${command}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ publish error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:postId/pump-dimmer', auth, adminOnly, (req, res) => {
  const postId = String(req.params.postId);
  const dimmer = req.body?.dimmer;
  const percent = req.body?.percent;
  if (!dimmer) return res.status(400).json({ error: 'Параметр dimmer обязателен' });
  if (!mqttClient || !mqttClient.connected) return res.status(503).json({ error: 'MQTT не подключён' });
  try {
    const command = {
      command: 'pump_dimmer',
      dimmer: dimmer,
      percent: percent !== undefined ? Number(percent) : undefined
    };
    mqttClient.publish(`posts/${postId}/command`, JSON.stringify(command), { qos: 1 });
    console.log(`📤 [API] posts/${postId}/command → pump_dimmer ${dimmer} (${percent}%)`);
    res.json({ ok: true, message: `Команда прокачки отправлена на диммер ${dimmer}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Пополнение поста (АВАНС) ----------
app.post('/api/posts/:postId/topup', auth, async (req, res) => {
  const postId = String(req.params.postId);
  const amount = Number(req.body?.amount);
  const paymentMethod = req.body?.paymentMethod || null;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Сумма должна быть положительным числом' });
  if (!['cash', 'card_terminal', 'client_card'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Недопустимый способ оплаты' });
  }
  try {
    const n = settings.numberOfPosts || 8;
    if (Number(postId) < 1 || Number(postId) > n) return res.status(404).json({ error: `Пост ${postId} не найден` });
    const state = getPostState(postId);

    if (state.clientCard) {
      const card = await ClientCard.findOne({ card: state.clientCard });
      if (!card) return res.status(404).json({ error: `Карта ${state.clientCard} не найдена` });

      card.balance = Math.round((card.balance + amount) * 100) / 100;
      await card.save();

      const receipt = await createReceipt({
        postId: Number(postId), kind: 'advance_card', operation: 'topup', isAdvance: true,
        cardNumber: card.card,
        items: [{ name: `Пополнение карты ${card.card}`, seconds: 0, cost: amount, pricePerSecond: 0 }],
        totalCost: amount, balanceAfter: card.balance, paymentMethod,
      });

      state.clientCardBalance = card.balance;
      if (mqttClient) {
        mqttClient.publish(`posts/${postId}/clientcardbalance`, JSON.stringify({
          card: card.card, balance: card.balance, type: card.type,
        }), { qos: 1 });
        publishStatus(postId);
      }
      return res.json({
        ok: true, postId: Number(postId), amount, balance: card.balance,
        paymentMethod, receiptNumber: receipt.receiptNumber, shiftNumber: receipt.shiftNumber,
        kind: 'advance_card', isAdvance: true,
      });
    }

    const expectedNewBalance = Math.round((state.balance + amount) * 100) / 100;
    const receipt = await createReceipt({
      postId: Number(postId), kind: 'advance_post', operation: 'topup', isAdvance: true,
      items: [{ name: 'Аванс: пополнение поста', seconds: 0, cost: amount, pricePerSecond: 0 }],
      totalCost: amount, balanceAfter: expectedNewBalance, paymentMethod,
    });
    if (mqttClient) {
      mqttClient.publish(`posts/${postId}/receipt_number`, JSON.stringify({
        receiptNumber: receipt.receiptNumber, kind: 'advance_post', isAdvance: true,
        amount, paymentMethod, balanceAfter: expectedNewBalance,
        shiftNumber: receipt.shiftNumber,
        timestamp: new Date().toISOString(),
      }), { qos: 1, retain: true });
      mqttClient.publish(`posts/${postId}/command`, JSON.stringify({ command: `add_balance ${amount}` }), { qos: 1 });
    }
    res.json({
      ok: true, postId: Number(postId), amount, balance: expectedNewBalance,
      paymentMethod, receiptNumber: receipt.receiptNumber, shiftNumber: receipt.shiftNumber,
      kind: 'advance_post', isAdvance: true,
    });
  } catch (err) {
    console.error('Ошибка пополнения поста:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Перевод с баланса поста на карту клиента ----------
app.post('/api/posts/:postId/transfer-to-card', auth, async (req, res) => {
  const postId = String(req.params.postId);
  const cardNumber = String(req.body?.card || '').trim().toUpperCase();
  const amountInput = Number(req.body?.amount);
  if (!cardNumber) return res.status(400).json({ error: 'card обязателен' });
  if (!amountInput || amountInput <= 0) return res.status(400).json({ error: 'amount должен быть положительным' });
  try {
    const n = settings.numberOfPosts || 8;
    if (Number(postId) < 1 || Number(postId) > n) return res.status(404).json({ error: `Пост ${postId} не найден` });
    const state = getPostState(postId);
    const cashOnPost = Math.round(
      ((typeof state.postCashBalance === 'number' ? state.postCashBalance : state.balance) || 0) * 100
    ) / 100;
    if (cashOnPost <= 0.01) {
      return res.status(409).json({ error: 'На посте нет средств для перевода' });
    }
    const amount = cashOnPost;
    const card = await ClientCard.findOne({ card: cardNumber });
    if (!card) return res.status(404).json({ error: `Карта ${cardNumber} не найдена` });

    state.postCashBalance = 0;
    state.balance = Math.round((state.balance - amount) * 100) / 100;
    if (state.balance < 0) state.balance = 0;
    card.balance = Math.round((card.balance + amount) * 100) / 100;
    await card.save();

    const receipt = await createReceipt({
      postId: Number(postId), kind: 'transfer_post_to_card', operation: 'transfer', isAdvance: false,
      items: [{ name: 'Перевод с баланса поста на карту клиента', seconds: 0, cost: amount, pricePerSecond: 0 }],
      totalCost: amount, balanceAfter: state.balance, paymentMethod: 'post_balance',
      cardNumber: card.card,
    });
    state.clientCard = card.card;
    state.clientCardBalance = card.balance;
    state.clientCardType = card.type;
    state._clientCardInitialBalance = card.balance;
    if (mqttClient) {
      mqttClient.publish(`posts/${postId}/receipt_number`, JSON.stringify({
        receiptNumber: receipt.receiptNumber, kind: 'transfer_post_to_card',
        amount, paymentMethod: 'post_balance', balanceAfter: state.balance,
        shiftNumber: receipt.shiftNumber,
        timestamp: new Date().toISOString(),
      }), { qos: 1, retain: true });
      mqttClient.publish(`posts/${postId}/clientcardbalance`, JSON.stringify({
        card: card.card, balance: card.balance, type: card.type,
      }), { qos: 1 });
    }
    publishStatus(postId);
    broadcast({
      type: 'card-balance', postId, card: card.card,
      balance: card.balance, cardType: card.type, timestamp: Date.now(),
    });
    console.log(
      `🔁 [Post ${postId}] Перевод ${amount.toFixed(2)} ₽ с баланса поста на карту ${card.card}` +
      ` → баланс поста: ${state.balance.toFixed(2)} ₽, баланс карты: ${card.balance.toFixed(2)} ₽`
    );
    res.json({
      ok: true, postId: Number(postId), card: card.card, amount,
      balance: state.balance, postBalance: state.balance, cardBalance: card.balance,
      receiptNumber: receipt.receiptNumber, shiftNumber: receipt.shiftNumber,
    });
  } catch (err) {
    console.error('Ошибка transfer-to-card:', err.message);
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
        local: {
          host: local?.host ?? '192.168.31.211', portTcp: local?.portTcp ?? 1883,
          portWs: local?.portWs ?? 8083, path: local?.path ?? '/mqtt',
          username: local?.username ?? 'admin', password: local?.password ?? 'Zavulon56'
        },
        remote: {
          host: remote?.host ?? 'm2.wqtt.ru', portTcp: remote?.portTcp ?? 13257,
          portTls: remote?.portTls ?? 13258, portWss: remote?.portWss ?? 13260,
          username: remote?.username ?? 'u_GGENLB', password: remote?.password ?? 'LTHNW22D'
        }
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
  try {
    const { kkNumber, fiscalShiftNumber, cashierName } = req.body;
    if (kkNumber !== undefined) settings.kkmManual.kkNumber = kkNumber;
    if (fiscalShiftNumber !== undefined) settings.kkmManual.fiscalShiftNumber = fiscalShiftNumber;
    if (cashierName !== undefined) settings.kkmManual.cashierName = cashierName;
    await saveSettings(settings);
    if (mqttClient) mqttClient.publish('system/config', JSON.stringify(settings), { qos: 0 });
    await publishKkmStatus();
    res.json(settings.kkmManual);
  } catch (err) {
    console.error('❌ PUT /api/kkm/manual:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kkm/current-shift', auth, async (_req, res) => {
  try {
    await closeExpiredShiftIfNeeded();
    const shift = await Shift.findOne({ shiftOpen: true }).sort({ shiftNumber: -1 }).lean();
    if (!shift) return res.json({ exists: false });
    res.json({
      shiftNumber: shift.shiftNumber, cashier: shift.cashier,
      openedAt: shift.openedAt, autoCloseAt: shift.autoCloseAt,
      fiscalShiftNumber: shift.fiscalShiftNumber, exists: true,
    });
  } catch (err) {
    console.error('❌ /api/kkm/current-shift:', err);
    res.status(500).json({ error: err.message, exists: false });
  }
});

app.get('/api/kkm/shift-status', auth, async (_req, res) => {
  try {
    const shift = await Shift.findOne({ shiftOpen: true });
    res.json({ shiftOpen: !!shift });
  } catch (err) {
    console.error('❌ /api/kkm/shift-status:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kkm/open-shift', auth, adminOnly, async (req, res) => {
  try {
    await closeExpiredShiftIfNeeded();
    if (await Shift.findOne({ shiftOpen: true })) return res.status(400).json({ error: 'Уже есть открытая смена' });
    const nextNumber = await getNextShiftNumber();
    const openedAt = new Date();
    const newShift = await Shift.create({
      shiftNumber: nextNumber, shiftOpen: true, openedAt,
      autoCloseAt: getShiftAutoCloseAt(openedAt), cashier: req.user.username,
    });
    await publishKkmStatus(); await broadcastShiftTotal();
    res.json({
      shiftNumber: newShift.shiftNumber, cashier: newShift.cashier,
      openedAt: newShift.openedAt, autoCloseAt: newShift.autoCloseAt,
    });
  } catch (err) {
    console.error('❌ /api/kkm/open-shift:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kkm/close-shift', auth, adminOnly, async (req, res) => {
  try {
    const shift = await Shift.findOne({ shiftOpen: true });
    if (!shift) return res.status(400).json({ error: 'Нет открытой смены' });
    const closedAt = new Date();
    shift.shiftOpen = false; shift.closedAt = closedAt; shift.autoClosed = false;
    const receipts = await Receipt.find(accountingQuery({ shiftNumber: shift.shiftNumber }));
    const total = receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0);
    shift.zReport = { total, count: receipts.length, generatedAt: closedAt, cashier: req.user.username };
    await shift.save();
    await publishKkmStatus(); await broadcastShiftTotal();
    res.json({ message: 'Смена закрыта', shiftNumber: shift.shiftNumber, total, count: receipts.length });
  } catch (err) {
    console.error('❌ /api/kkm/close-shift:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kkm/x-report', auth, adminOnly, async (req, res) => {
  try {
    const shift = await Shift.findOne({ shiftOpen: true });
    if (!shift) return res.status(404).json({ error: 'Нет открытой смены' });
    const receipts = await Receipt.find(accountingQuery({ shiftNumber: shift.shiftNumber }));
    const total = receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0);
    shift.xReports.push({ timestamp: new Date(), total, count: receipts.length, cashier: req.user.username });
    await shift.save();
    res.json({ message: 'X-отчёт', shiftNumber: shift.shiftNumber, total, count: receipts.length });
  } catch (err) {
    console.error('❌ /api/kkm/x-report:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kkm/z-report', auth, adminOnly, async (req, res) => {
  try {
    const currentShift = await Shift.findOne({ shiftOpen: true });
    if (!currentShift) return res.status(400).json({ error: 'Нет открытой смены' });
    const closedAt = new Date();
    const receipts = await Receipt.find(accountingQuery({ shiftNumber: currentShift.shiftNumber }));
    const total = receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0);
    currentShift.zReport = { total, count: receipts.length, generatedAt: closedAt, cashier: req.user.username };
    currentShift.shiftOpen = false; currentShift.closedAt = closedAt;
    await currentShift.save();
    const nextNumber = await getNextShiftNumber();
    const openedAt = new Date();
    const newShift = await Shift.create({
      shiftNumber: nextNumber, shiftOpen: true, openedAt,
      autoCloseAt: getShiftAutoCloseAt(openedAt), cashier: req.user.username,
    });
    await publishKkmStatus(); await broadcastShiftTotal();
    res.json({
      message: 'Z-отчёт сформирован, смена закрыта',
      closed: { shiftNumber: currentShift.shiftNumber, total, count: receipts.length },
      newShift: { shiftNumber: newShift.shiftNumber, openedAt: newShift.openedAt },
    });
  } catch (err) {
    console.error('❌ /api/kkm/z-report:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kkm/settings', auth, adminOnly, (_req, res) => res.json(settings.kkm));

app.get('/api/shift-total', auth, adminOnly, async (req, res) => {
  try {
    const { shiftNumber } = req.query;

    if (shiftNumber != null && shiftNumber !== '') {
      const n = Number(shiftNumber);
      if (!Number.isInteger(n)) return res.status(400).json({ error: 'Некорректный shiftNumber' });
      const shift = await Shift.findOne({ shiftNumber: n }).lean();
      if (!shift) return res.status(404).json({ error: `Смена №${n} не найдена` });
      const receipts = await Receipt.find(accountingQuery({ shiftNumber: n }));
      
      const { avgCheck, finalCount, finalTotal } = computeAverageCheck(receipts);
      const paymentMethods = calculatePaymentSummary(receipts);

      return res.json({
        shiftNumber: n,
        isOpen: !!shift.shiftOpen,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        total: receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0),
        count: receipts.length,
        avgCheck, finalCount, finalTotal, 
        paymentMethods
      });
    }

    const currentShift = await Shift.findOne({ shiftOpen: true });
    if (!currentShift) return res.json({ shiftNumber: null, total: 0, count: 0, avgCheck: 0, finalCount: 0, finalTotal: 0, paymentMethods: {} });
    const receipts = await Receipt.find(accountingQuery({ shiftNumber: currentShift.shiftNumber }));
    
    const { avgCheck, finalCount, finalTotal } = computeAverageCheck(receipts);
    const paymentMethods = calculatePaymentSummary(receipts);
    
    res.json({
      shiftNumber: currentShift.shiftNumber,
      isOpen: true,
      openedAt: currentShift.openedAt,
      total: receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0),
      count: receipts.length,
      avgCheck, finalCount, finalTotal, 
      paymentMethods
    });
  } catch (err) {
    console.error('❌ /api/shift-total:', err);
    res.status(500).json({ error: err.message });
  }
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
// Смены — список
// ============================================================
app.get('/api/shifts', auth, adminOnly, async (req, res) => {
  try {
    const { limit = 50, page = 1, includeTotals } = req.query;
    const l = Math.min(500, Math.max(1, Number(limit) || 50));
    const p = Math.max(1, Number(page) || 1);

    const [shifts, total] = await Promise.all([
      Shift.find({}).sort({ shiftNumber: -1 }).skip((p - 1) * l).limit(l).lean(),
      Shift.countDocuments({}),
    ]);

    const withTotals = includeTotals !== '0' && includeTotals !== 'false';

    const items = withTotals
      ? await Promise.all(shifts.map(async (s) => {
          const agg = await Receipt.aggregate([
            { $match: accountingQuery({ shiftNumber: s.shiftNumber }) },
            { $group: { _id: null, total: { $sum: '$totalCost' }, count: { $sum: 1 } } },
          ]);
          return {
            shiftNumber: s.shiftNumber,
            openedAt: s.openedAt,
            closedAt: s.closedAt,
            cashier: s.cashier,
            isOpen: !!s.shiftOpen,
            autoClosed: !!s.autoClosed,
            total: Math.round((agg[0]?.total || 0) * 100) / 100,
            count: agg[0]?.count || 0,
          };
        }))
      : shifts.map(s => ({
          shiftNumber: s.shiftNumber,
          openedAt: s.openedAt,
          closedAt: s.closedAt,
          cashier: s.cashier,
          isOpen: !!s.shiftOpen,
          autoClosed: !!s.autoClosed,
        }));

    res.json({ shifts: items, total, page: p, limit: l });
  } catch (err) {
    console.error('❌ GET /api/shifts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Reports
// ============================================================
async function generatePDFReport(receipts, totalSum, header) {
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
    doc.fontSize(12).text(`Период: ${header}`, { align: 'center' });
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
        String(receipts.indexOf(receipt) + 1), String(receipt.postId || ''), dateStr,
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
  const built = buildTimeOrShiftFilter(req.query);
  if (built.error) return res.status(built.code).json({ error: built.error });

  let receipts = await Receipt.find(accountingQuery(built.filter)).sort({ timestamp: -1 });
  receipts = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const totalSum = receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0);

  const header = built.kind === 'shift'
    ? `Смена №${built.shiftNumber}`
    : `${built.from} – ${built.to}`;
  const pdfData = await generatePDFReport(receipts, totalSum, header);
  const filename = built.kind === 'shift'
    ? `report_shift_${built.shiftNumber}.pdf`
    : `report_${String(built.from).slice(0,10)}_${String(built.to).slice(0,10)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(pdfData);
});

app.get('/api/reports/shift/:shiftNumber', auth, adminOnly, async (req, res) => {
  try {
    const n = Number(req.params.shiftNumber);
    if (!Number.isInteger(n)) return res.status(400).json({ error: 'Некорректный shiftNumber' });

    const shift = await Shift.findOne({ shiftNumber: n }).lean();
    if (!shift) return res.status(404).json({ error: `Смена №${n} не найдена` });

    const receipts = await Receipt.find(accountingQuery({ shiftNumber: n }))
      .sort({ timestamp: 1 }).lean();

    const translated = receipts.map(r => {
      const a = annotateReceipt(r);
      a.items = translateReceiptItems(a.items);
      return a;
    });

    const totalSum = translated.reduce((s, r) => s + (Number(r.totalCost) || 0), 0);
    const { avgCheck, finalCount, finalTotal } = computeAverageCheck(translated);
    const paymentSummary = calculatePaymentSummary(translated);

    const byPayment = {};
    for (const r of translated) {
      const pm = r.paymentMethod || 'other';
      if (!byPayment[pm]) byPayment[pm] = { paymentMethod: pm, total: 0, count: 0 };
      byPayment[pm].total += Number(r.totalCost) || 0;
      byPayment[pm].count += 1;
    }
    const byPost = {};
    for (const r of translated) {
      const pid = r.postId;
      if (!byPost[pid]) byPost[pid] = { postId: pid, total: 0, count: 0 };
      byPost[pid].total += Number(r.totalCost) || 0;
      byPost[pid].count += 1;
    }

    res.json({
      shiftNumber: n,
      shift: {
        number: shift.shiftNumber,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        cashier: shift.cashier,
        isOpen: !!shift.shiftOpen,
        autoClosed: !!shift.autoClosed,
      },
      summary: {
        totalSum:   Math.round(totalSum * 100) / 100,
        totalCount: translated.length,
        avgCheck, finalCount, finalTotal, 
        paymentSummary, // ★ ДОБАВЛЕНО
        byPaymentMethod: Object.values(byPayment).map(v => ({
          paymentMethod: v.paymentMethod,
          total: Math.round(v.total * 100) / 100,
          count: v.count,
        })),
        byPost: Object.values(byPost).map(v => ({
          postId: v.postId,
          total: Math.round(v.total * 100) / 100,
          count: v.count,
        })),
      },
      receipts: translated,
    });
  } catch (err) {
    console.error(`❌ GET /api/reports/shift/${req.params.shiftNumber}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/day/:date', auth, adminOnly, async (req, res) => {
  const date = new Date(req.params.date);
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end   = new Date(date); end.setHours(23, 59, 59, 999);
  const receipts = await Receipt.find(accountingQuery({ timestamp: { $gte: start, $lte: end } })).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const paymentSummary = calculatePaymentSummary(translated);
  res.json({ totalSum: translated.reduce((s, r) => s + (Number(r.totalCost) || 0), 0), count: translated.length, paymentSummary, receipts: translated });
});

app.get('/api/reports/week', auth, adminOnly, async (_req, res) => {
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - 7); start.setHours(0, 0, 0, 0);
  const receipts = await Receipt.find(accountingQuery({ timestamp: { $gte: start, $lte: end } })).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const paymentSummary = calculatePaymentSummary(translated);
  res.json({ totalSum: translated.reduce((s, r) => s + (Number(r.totalCost) || 0), 0), count: translated.length, paymentSummary, receipts: translated });
});

app.get('/api/reports/month', auth, adminOnly, async (_req, res) => {
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - 30); start.setHours(0, 0, 0, 0);
  const receipts = await Receipt.find(accountingQuery({ timestamp: { $gte: start, $lte: end } })).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const paymentSummary = calculatePaymentSummary(translated);
  res.json({ totalSum: translated.reduce((s, r) => s + (Number(r.totalCost) || 0), 0), count: translated.length, paymentSummary, receipts: translated });
});

app.get('/api/reports/shift', auth, adminOnly, async (_req, res) => {
  const currentShift = await Shift.findOne({ shiftOpen: true });
  if (!currentShift) return res.json({ totalSum: 0, count: 0, receipts: [] });
  const receipts = await Receipt.find(accountingQuery({ shiftNumber: currentShift.shiftNumber })).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const paymentSummary = calculatePaymentSummary(translated);
  res.json({
    shiftNumber: currentShift.shiftNumber,
    totalSum: translated.reduce((s, r) => s + (Number(r.totalCost) || 0), 0),
    count: translated.length,
    paymentSummary,
    receipts: translated,
  });
});

app.get('/api/reports/range', auth, viewerOrAdmin, async (req, res) => {
  const built = buildTimeOrShiftFilter(req.query);
  if (built.error) return res.status(built.code).json({ error: built.error });

  const receipts = await Receipt.find(accountingQuery(built.filter)).sort({ timestamp: -1 });
  const translated = receipts.map(r => ({ ...r.toObject(), items: translateReceiptItems(r.items) }));
  const paymentSummary = calculatePaymentSummary(translated);
  const summary = {
    filter: built.kind === 'shift' ? { shiftNumber: built.shiftNumber } : { from: built.from, to: built.to },
    totalSum: translated.reduce((s, r) => s + (Number(r.totalCost) || 0), 0),
    count: translated.length,
    paymentSummary,
    receipts: translated,
  };
  if (mqttClient) mqttClient.publish('reports/output', JSON.stringify(summary), { qos: 0 });
  res.json(summary);
});

app.get('/api/reports/grouped', auth, viewerOrAdmin, async (req, res) => {
  const built = buildTimeOrShiftFilter(req.query);
  if (built.error) return res.status(built.code).json({ error: built.error });

  const receipts = await Receipt.find(accountingQuery(built.filter))
    .sort({ timestamp: 1 }).lean();
  const days = {};
  let grandTotal = 0, grandCount = 0, clientCardsReceiptsSum = 0;
  
  for (const r of receipts) {
    const dt = new Date(r.timestamp);
    const dayKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const pmRaw = r.paymentMethod || 'other';
    const postId = r.postId;
    
    // Для карт клиента реальная сумма — это grossTotal
    const totalCost = pmRaw === 'client_card' 
      ? (Number(r.grossTotal) || Number(r.totalCost) || 0) 
      : (Number(r.totalCost) || 0);

    if (pmRaw === 'client_card') clientCardsReceiptsSum += totalCost;
    
    if (!days[dayKey]) days[dayKey] = { date: dayKey, posts: {}, total: 0, count: 0 };
    const d = days[dayKey];
    if (!d.posts[postId]) d.posts[postId] = { postId, paymentMethods: {}, total: 0, count: 0 };
    const p = d.posts[postId];
    if (!p.paymentMethods[pmRaw]) p.paymentMethods[pmRaw] = { paymentMethod: pmRaw, receipts: [], total: 0, count: 0 };
    const pmGroup = p.paymentMethods[pmRaw];
    const items = (r.items || []).map(it => {
      const cost  = Number(it.cost)    || 0;
      const secs  = Number(it.seconds) || 0;
      const price = secs > 0 ? cost / secs : 0;
      return {
        name: programNamesRu[it.name] || it.name || '—',
        pricePerSecond: Math.round(price * 10000) / 10000,
        quantity: Math.round(secs * 10) / 10,
        unit: 'секунда',
        timeWorkedSec: Math.round(secs * 10) / 10,
        sum: Math.round(cost * 100) / 100,
      };
    });
    const receipt = {
      receiptNumber: r.receiptNumber, date: r.timestamp, postId,
      shiftNumber:   r.shiftNumber ?? null,
      paymentMethod: pmRaw, kind: r.kind || 'session', isAdvance: !!r.isAdvance,
      status:          r.status || 'done',
      advanceReceiptNumber: r.advanceReceiptNumber ?? null,
      finalReceiptNumber:   r.finalReceiptNumber   ?? null,
      grossTotal:      r.grossTotal      ?? null,
      advanceApplied:  r.advanceApplied  ?? 0,
      pairId:          pairIdOf(r),
      total: Math.round(totalCost * 100) / 100, items,
    };
    pmGroup.receipts.push(receipt);
    pmGroup.total += totalCost; pmGroup.count += 1;
    p.total += totalCost; p.count += 1;
    d.total += totalCost; d.count += 1;
    grandTotal += totalCost; grandCount += 1;
  }
  
  const resultDays = Object.values(days).map(d => ({
    date: d.date, total: Math.round(d.total * 100) / 100, count: d.count,
    posts: Object.values(d.posts).map(p => ({
      postId: p.postId, total: Math.round(p.total * 100) / 100, count: p.count,
      paymentMethods: Object.values(p.paymentMethods).map(pm => ({
        paymentMethod: pm.paymentMethod, total: Math.round(pm.total * 100) / 100,
        count: pm.count, receipts: pm.receipts,
      })),
    })),
  }));
  
  let totalCardsBalance = 0;
  try {
    const agg = await ClientCard.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]);
    totalCardsBalance = agg[0]?.total || 0;
  } catch (e) { console.error('Ошибка подсчёта баланса карт:', e); }
  
  const paymentSummary = calculatePaymentSummary(receipts);

  res.json({
    filter: built.kind === 'shift' ? { shiftNumber: built.shiftNumber } : { from: built.from, to: built.to },
    grandTotal: Math.round(grandTotal * 100) / 100, grandCount,
    totalCardsBalance: Math.round(totalCardsBalance * 100) / 100,
    clientCardsReceiptsSum: Math.round(clientCardsReceiptsSum * 100) / 100,
    paymentSummary, // ★ ДОБАВЛЕНО
    days: resultDays,
  });
});

app.get('/api/receipts', auth, async (req, res) => {
  try {
    const { shiftNumber, from, to, type = 'all', status = 'all', postId } = req.query;

    const built = buildTimeOrShiftFilter({ shiftNumber, from, to });
    if (built.error) return res.status(built.code).json({ error: built.error });

    const TYPE_QUERY = {
      all:     {},
      advance: { isAdvance: true },
      final:   { kind: 'final' },
      session: { kind: 'session', isAdvance: { $ne: true } },
      topup:   { operation: 'topup' },
      transfer:{ kind: 'transfer_post_to_card' },
    };
    if (!(type in TYPE_QUERY)) return res.status(400).json({ error: `Недопустимый type: ${type}` });
    if (!['all', 'done', 'void'].includes(status)) return res.status(400).json({ error: `Недопустимый status: ${status}` });

    const filterParts = [built.filter, TYPE_QUERY[type]];
    if (postId) filterParts.push({ postId: Number(postId) });
    if (status === 'void')      filterParts.push({ status: 'void' });
    else if (status === 'done') filterParts.push({ status: { $ne: 'void' } });

    const query = filterParts.length > 1 ? { $and: filterParts } : filterParts[0];

    const [rawReceipts, accountingAgg] = await Promise.all([
      Receipt.find(query).sort({ timestamp: -1 }).lean(),
      Receipt.aggregate([
        { $match: accountingQuery(built.filter) },
        { $group: { _id: null, total: { $sum: '$totalCost' }, count: { $sum: 1 } } },
      ]),
    ]);

    const receipts = rawReceipts.map(r => {
      const a = annotateReceipt(r);
      a.items = translateReceiptItems(a.items);
      return a;
    });

    const filteredTotal = receipts.reduce((s, r) => {
      if (r.status === 'void' || r.kind === 'transfer_post_to_card') return s;
      return s + (Number(r.totalCost) || 0);
    }, 0);
    const filteredCount = receipts.filter(r =>
      r.status !== 'void' && r.kind !== 'transfer_post_to_card').length;

    const accountingTotal = accountingAgg[0]?.total || 0;
    const accountingCount = accountingAgg[0]?.count || 0;

    res.json({
      filter: built.kind === 'shift' ? { shiftNumber: built.shiftNumber } : { from: built.from, to: built.to },
      applyFilter: { type, status, postId: postId || null },
      receipts,
      summary: {
        filteredCount,
        filteredTotal:   Math.round(filteredTotal   * 100) / 100,
        accountingCount,
        accountingTotal: Math.round(accountingTotal * 100) / 100,
        matchesAccounting:
          Math.abs(filteredTotal - accountingTotal) < 0.005,
      },
    });
  } catch (err) {
    console.error('❌ GET /api/receipts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/receipts', async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.postId || !Array.isArray(d.items) || !d.items.length) {
      return res.status(400).json({ error: 'postId и items обязательны' });
    }
    const receipt = await createReceipt({
      postId: d.postId, kind: d.kind || 'session', operation: d.operation || 'sell',
      isAdvance: !!d.isAdvance, advanceReceiptNumber: d.advanceReceiptNumber ?? null,
      cardNumber: d.cardNumber || null,
      items: d.items, totalCost: d.totalCost, balanceAfter: d.balance,
      paymentMethod: d.paymentMethod || null, discountTotal: d.discountTotal || 0,
      correctionInfo: d.correctionInfo || null, timestamp: d.timestamp,
      paymentAlreadyCounted: d.paymentAlreadyCounted === true || d.paymentMethod === 'client_card',
    });
    res.status(201).json({
      message: 'Чек сохранён', id: receipt._id,
      receiptNumber: receipt.receiptNumber, shiftNumber: receipt.shiftNumber,
    });
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
      st.postCashBalance = 0;
      released = true;
      console.log(`🔓 [${id}] Карта ${cardNumber} освобождена`);
    }
  }
  res.json({ ok: true, released });
});

// ============================================================
// Health check + глобальный error middleware
// ============================================================
app.get('/api/health', (_req, res) => {
  try {
    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      ts: Date.now(),
      mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      mqtt: mqttClient && mqttClient.connected ? 'connected' : 'disconnected',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`❌ ${req.method} ${req.originalUrl}:`, err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err?.message || 'Internal error', path: req.originalUrl });
});

// ============================================================
// Start
// ============================================================
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    try { await loadSettings(); } catch (e) { console.error('loadSettings:', e.message); }
    try { await initShift(); }    catch (e) { console.error('initShift:', e.message); }

    setInterval(async () => {
      try { await closeExpiredShiftIfNeeded(); } catch (e) { console.error('auto-close-shift:', e.message); }
    }, 60_000);
    setInterval(async () => {
      try { await publishKkmStatus(); } catch (e) { /* ignore */ }
    }, 10_000);

    server.listen(process.env.PORT || 3000, process.env.HOST || '0.0.0.0', () => {
      console.log(`REST API listening on http://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}`);
      console.log(`WebSocket listening on ws://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}/ws`);

      setTimeout(() => {
        migrateLegacyReceipts().catch((e) => console.warn('[migrate] fail:', e.message));
      }, 15_000);
      setTimeout(() => {
        migrateReceiptShiftNumbers().catch((e) => console.warn('[migrate-shift] fail:', e.message));
      }, 45_000);
    });
  })
  .catch(err => {
    console.warn('MongoDB not connected:', err.message);
    server.listen(process.env.PORT || 3000, process.env.HOST || '0.0.0.0', () => {
      console.log(`REST API listening on http://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}`);
      console.log(`WebSocket listening on ws://${process.env.HOST || '0.0.0.0'}:${process.env.PORT || 3000}/ws`);
      setTimeout(() => migrateLegacyReceipts().catch(() => {}), 15_000);
      setTimeout(() => migrateReceiptShiftNumbers().catch(() => {}), 45_000);
    });
  });