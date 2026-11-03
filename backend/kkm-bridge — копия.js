// backend/kkm-bridge.js
// HTTP-bridge для драйвера ККТ Штрих-М 4.15 (COM-объект AddIn.DrvFR).
// Запускать на Windows-ПК, где установлен драйвер Штрих-М.
// Слушает http://127.0.0.1:5001/api/kkm

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = Number(process.env.KKM_BRIDGE_PORT) || 5001;
const HOST = process.env.KKM_BRIDGE_HOST || '127.0.0.1';

// ============================================================
// НАСТРОЙКИ ДРАЙВЕРА
// ============================================================
const COM_PROG_ID = process.env.SHTRIH_COM_PROG_ID || 'AddIn.DrvFR';
const COM_NUMBER  = Number(process.env.SHTRIH_COM_NUMBER) || 1;         // COM1
const BAUD_RATE   = Number(process.env.SHTRIH_BAUD) || 115200;
const TIMEOUT_MS  = Number(process.env.SHTRIH_TIMEOUT) || 5000;

// Если true — драйвер не опрашивается, отдаются фиксированные данные.
// Используйте для отладки связки backend ↔ bridge без железа.
const USE_MOCK = process.env.KKM_BRIDGE_MOCK === 'true';

// ============================================================
// ПОДКЛЮЧЕНИЕ К COM
// ============================================================
// Установите одну из библиотек:
//   npm install node-activex     (рекомендуется)
//   npm install win32ole         (устаревшая, но иногда работает)
//
// Обе библиотеки требуют Windows и 64-битную разрядность процесса Node.js,
// совпадающую с разрядностью COM-объекта драйвера.

let ActiveXLib = null;
let ActiveXConstructor = null;

function loadActiveX() {
  if (ActiveXConstructor) return ActiveXConstructor;

  try {
    const mod = require('node-activex');
    ActiveXLib = 'node-activex';
    ActiveXConstructor = mod.ActiveXObject || mod;
    console.log(`[KKM] Библиотека COM: node-activex`);
    return ActiveXConstructor;
  } catch (e) {
    console.warn(`[KKM] node-activex не установлен: ${e.message}`);
  }

  try {
    const mod = require('win32ole');
    ActiveXLib = 'win32ole';
    ActiveXConstructor = mod;
    console.log(`[KKM] Библиотека COM: win32ole`);
    return ActiveXConstructor;
  } catch (e) {
    console.warn(`[KKM] win32ole не установлен: ${e.message}`);
  }

  throw new Error(
    'Не найдена COM-библиотека. Установите: npm install node-activex'
  );
}

/**
 * Создаёт COM-объект драйвера Штрих-М и открывает порт.
 * Возвращает объект device.
 */
function openShtrihDevice() {
  const ActiveXObject = loadActiveX();
  const device = new ActiveXObject(COM_PROG_ID);

  // Настройки подключения
  device.ComNumber = COM_NUMBER;
  device.BaudRate = BAUD_RATE;
  device.Timeout = TIMEOUT_MS;

  // Открыть порт
  device.OpenPort();

  return device;
}

/** Закрывает порт и COM-объект, глотает ошибки */
function closeShtrihDevice(device) {
  if (!device) return;
  try { device.ClosePort(); } catch { /* ignore */ }
  try { device = null; } catch { /* ignore */ }
}

// ============================================================
// ЗАПРОС СТАТУСА
// ============================================================
function queryShtrihCom() {
  let device = null;

  try {
    device = openShtrihDevice();

    // Запрос состояния — заполняет свойства объекта
    device.GetECRStatus();

    const resultCode = Number(device.ResultCode) || 0;
    const connected = resultCode === 0;

    // Если порт открылся, но команда не прошла — тоже считаем offline
    if (!connected) {
      return {
        ready: false,
        connected: false,
        paper: false,
        kkNumber: '',
        shiftNumber: 0,
        cashierName: '',
        driverOnline: true,   // мост жив, но ККТ не отвечает
        errors: [`ResultCode=${resultCode}`],
      };
    }

    const kkNumber = String(device.SerialNumber || '').trim();
    const shiftNumber = Number(device.ShiftNumber) || 0;
    const paper = Number(device.PaperPresent) === 1;

    return {
      ready: true,
      connected: true,
      paper,
      kkNumber,
      shiftNumber,
      cashierName: process.env.SHTRIH_CASHIER || 'Оператор',
      driverOnline: true,
      errors: [],
    };
  } catch (e) {
    console.error('[KKM] queryShtrihCom error:', e.message);
    return {
      ready: false,
      connected: false,
      paper: false,
      kkNumber: '',
      shiftNumber: 0,
      cashierName: '',
      driverOnline: false,
      errors: [e.message],
    };
  } finally {
    closeShtrihDevice(device);
  }
}

// ============================================================
// КОМАНДЫ
// ============================================================

/** Открыть смену на ККТ */
function comOpenShift() {
  let device = null;
  try {
    device = openShtrihDevice();

    // В драйвере Штрих-М смена открывается неявно при первом чеке.
    // У некоторых версий есть метод OpenSession() или PrintZReport() для Z.
    // Проверьте документацию драйвера — здесь вызываем OpenSession, если метод есть.
    if (typeof device.OpenSession === 'function') {
      device.OpenSession();
    } else {
      // Иначе просто проверяем связь — смена откроется при первом чеке.
      device.GetECRStatus();
    }

    return { ok: true, message: 'Смена открыта на ККТ' };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    closeShtrihDevice(device);
  }
}

/** X-отчёт */
function comXReport() {
  let device = null;
  try {
    device = openShtrihDevice();

    if (typeof device.PrintXReport === 'function') {
      device.PrintXReport();
    } else if (typeof device.XReport === 'function') {
      device.XReport();
    } else {
      throw new Error('Метод X-отчёта не найден в COM-объекте драйвера');
    }

    return { ok: true, message: 'X-отчёт сформирован' };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    closeShtrihDevice(device);
  }
}

/** Z-отчёт (закрывает смену) */
function comZReport() {
  let device = null;
  try {
    device = openShtrihDevice();

    if (typeof device.PrintZReport === 'function') {
      device.PrintZReport();
    } else if (typeof device.ZReport === 'function') {
      device.ZReport();
    } else if (typeof device.CloseSession === 'function') {
      device.CloseSession();
    } else {
      throw new Error('Метод Z-отчёта не найден в COM-объекте драйвера');
    }

    return { ok: true, message: 'Z-отчёт сформирован, смена закрыта' };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    closeShtrihDevice(device);
  }
}

/**
 * Печать чека.
 * Body: { postId, items: [{ name, seconds, cost }], balance }
 */
function comPrintReceipt(receipt) {
  let device = null;
  try {
    const items = Array.isArray(receipt.items) ? receipt.items : [];
    if (!items.length) throw new Error('Список позиций чека пуст');

    device = openShtrihDevice();

    // Открыть чек
    if (typeof device.OpenCheck === 'function') {
      device.OpenCheck();
    } else if (typeof device.OpenReceipt === 'function') {
      device.OpenReceipt();
    } else {
      throw new Error('Метод открытия чека не найден в COM-объекте драйвера');
    }

    // Добавить позиции
    for (const it of items) {
      const name = String(it.name || 'Услуга').slice(0, 40);
      const cost = Number(it.cost) || 0;
      const qty = 1;
      const sum = Math.round(cost * qty * 100) / 100;

      device.StringForPrinting = name;
      device.Price = sum;
      device.Quantity = qty;

      if (typeof device.Sale === 'function') {
        device.Sale();
      } else if (typeof device.Registration === 'function') {
        device.Registration();
      } else {
        throw new Error('Метод регистрации позиции не найден в COM-объекте драйвера');
      }
    }

    // Закрыть чек
    const total = items.reduce((s, it) => s + (Number(it.cost) || 0), 0);
    device.Summ1 = Math.round(total * 100) / 100;

    if (typeof device.CloseCheck === 'function') {
      device.CloseCheck();
    } else if (typeof device.CloseReceipt === 'function') {
      device.CloseReceipt();
    } else {
      throw new Error('Метод закрытия чека не найден в COM-объекте драйвера');
    }

    return { ok: true, message: `Чек на ${total.toFixed(2)} ₽ напечатан` };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    closeShtrihDevice(device);
  }
}

// ============================================================
// MOCK
// ============================================================
function mockStatus() {
  return {
    ready: true,
    connected: true,
    paper: true,
    kkNumber: process.env.MOCK_KK_NUMBER || '0000111118041361',
    shiftNumber: 0,
    cashierName: 'Оператор',
    driverOnline: true,
    errors: [],
  };
}

// ============================================================
// HTTP API
// ============================================================
app.get('/api/kkm/status', (_req, res) => {
  const status = USE_MOCK ? mockStatus() : queryShtrihCom();
  res.status(200).json(status);
});

app.post('/api/kkm/open-shift', (_req, res) => {
  const r = USE_MOCK ? { ok: true, message: 'Mock' } : comOpenShift();
  res.status(r.ok ? 200 : 500).json(r);
});

app.post('/api/kkm/x-report', (_req, res) => {
  const r = USE_MOCK ? { ok: true, message: 'Mock' } : comXReport();
  res.status(r.ok ? 200 : 500).json(r);
});

app.post('/api/kkm/z-report', (_req, res) => {
  const r = USE_MOCK ? { ok: true, message: 'Mock' } : comZReport();
  res.status(r.ok ? 200 : 500).json(r);
});

app.post('/api/kkm/print', (req, res) => {
  const r = USE_MOCK ? { ok: true, message: 'Mock' } : comPrintReceipt(req.body || {});
  res.status(r.ok ? 200 : 500).json(r);
});

app.get('/api/kkm/ping', (_req, res) => {
  res.json({
    ok: true,
    mode: USE_MOCK ? 'mock' : 'real',
    com: {
      progId: COM_PROG_ID,
      port: `COM${COM_NUMBER}`,
      baud: BAUD_RATE,
      timeout: TIMEOUT_MS,
    },
    library: ActiveXLib || null,
    ts: Date.now(),
  });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, HOST, () => {
  console.log(`🔌 KKM bridge запущен на http://${HOST}:${PORT}/api/kkm`);
  console.log(`   Режим:            ${USE_MOCK ? 'MOCK' : 'REAL'}`);
  console.log(`   COM ProgID:       ${COM_PROG_ID}`);
  console.log(`   Порт:             COM${COM_NUMBER} @ ${BAUD_RATE}`);
  console.log(`   Таймаут:          ${TIMEOUT_MS} мс`);
  console.log(`   Библиотека COM:   ${ActiveXLib || '(ещё не загружена — загрузится при первом запросе)'}`);
  console.log(``);
  console.log(`   Проверка:  curl http://${HOST}:${PORT}/api/kkm/status`);
  console.log(`   Ping:      curl http://${HOST}:${PORT}/api/kkm/ping`);
});