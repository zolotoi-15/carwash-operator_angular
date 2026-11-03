// backend/kkm-bridge.js
// HTTP-bridge для драйвера ККТ Штрих-М через PowerShell.
// Не требует нативных модулей, node-gyp и Visual Studio.

const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = Number(process.env.KKM_BRIDGE_PORT) || 5001;
const HOST = process.env.KKM_BRIDGE_HOST || '127.0.0.1';

// Драйвер Штрих-М 4.15 — 32-битный COM.
// Поэтому используем SysWOW64 (32-битный PowerShell).
// Если у вас 64-битный драйвер — замените на System32.
const POWERSHELL =
  process.env.POWERSHELL_PATH ||
  'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe';

const PS_SCRIPT = path.join(__dirname, 'kkm-query.ps1');

const COM_NUMBER = Number(process.env.SHTRIH_COM_NUMBER) || 1;
const BAUD_RATE  = Number(process.env.SHTRIH_BAUD) || 115200;

const USE_MOCK = process.env.KKM_BRIDGE_MOCK === 'true';

// ============================================================
// ЗАПУСК POWERSHELL
// ============================================================
function runPs(action, receipt = null) {
  return new Promise((resolve) => {
    if (!fs.existsSync(PS_SCRIPT)) {
      return resolve({
        ready: false, connected: false, paper: false,
        kkNumber: '', shiftNumber: 0, cashierName: '',
        driverOnline: false,
        errors: [`PowerShell-скрипт не найден: ${PS_SCRIPT}`],
      });
    }

    const args = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', PS_SCRIPT,
      '-Action', action,
      '-ComNumber', String(COM_NUMBER),
      '-BaudRate', String(BAUD_RATE),
    ];

    if (receipt) args.push('-ReceiptJson', JSON.stringify(receipt));

    console.log(`[KKM] ${action} ...`);

    execFile(POWERSHELL, args, {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        console.error('[KKM] PS error:', err.message);
        if (stderr) console.error('[KKM] PS stderr:', stderr);
        return resolve({
          ready: false, connected: false, paper: false,
          kkNumber: '', shiftNumber: 0, cashierName: '',
          driverOnline: false,
          errors: [err.message, stderr].filter(Boolean),
        });
      }

      const out = (stdout || '').trim();
      if (!out) {
        return resolve({
          ready: false, connected: false, paper: false,
          kkNumber: '', shiftNumber: 0, cashierName: '',
          driverOnline: false,
          errors: ['Пустой вывод PowerShell'],
        });
      }

      try {
        const start = out.indexOf('{');
        const end = out.lastIndexOf('}');
        const json = start !== -1 && end !== -1 ? out.slice(start, end + 1) : out;
        const parsed = JSON.parse(json);
        console.log(`[KKM] ${action} OK`);
        resolve(parsed);
      } catch (e) {
        console.error('[KKM] JSON parse error:', e.message);
        console.error('[KKM] raw output:', out.slice(0, 500));
        resolve({
          ready: false, connected: false, paper: false,
          kkNumber: '', shiftNumber: 0, cashierName: '',
          driverOnline: false,
          errors: ['Некорректный JSON от PowerShell', out.slice(0, 200)],
        });
      }
    });
  });
}

// ============================================================
// MOCK
// ============================================================
function mockStatus() {
  return {
    ready: true, connected: true, paper: true,
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
app.get('/api/kkm/status', async (_req, res) => {
  if (USE_MOCK) return res.json(mockStatus());
  const status = await runPs('status');
  res.json(status);
});

app.post('/api/kkm/open-shift', async (_req, res) => {
  if (USE_MOCK) return res.json({ ok: true, message: 'Mock' });
  const r = await runPs('open-shift');
  res.status(r.ok ? 200 : 500).json(r);
});

app.post('/api/kkm/x-report', async (_req, res) => {
  if (USE_MOCK) return res.json({ ok: true, message: 'Mock' });
  const r = await runPs('x-report');
  res.status(r.ok ? 200 : 500).json(r);
});

app.post('/api/kkm/z-report', async (_req, res) => {
  if (USE_MOCK) return res.json({ ok: true, message: 'Mock' });
  const r = await runPs('z-report');
  res.status(r.ok ? 200 : 500).json(r);
});

app.post('/api/kkm/print', async (req, res) => {
  if (USE_MOCK) return res.json({ ok: true, message: 'Mock' });
  const r = await runPs('print', req.body || {});
  res.status(r.ok ? 200 : 500).json(r);
});

app.get('/api/kkm/ping', (_req, res) => {
  res.json({
    ok: true,
    mode: USE_MOCK ? 'mock' : 'real',
    powershell: POWERSHELL,
    powershellExists: fs.existsSync(POWERSHELL),
    psScript: PS_SCRIPT,
    psScriptExists: fs.existsSync(PS_SCRIPT),
    com: { port: `COM${COM_NUMBER}`, baud: BAUD_RATE },
    ts: Date.now(),
  });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, HOST, () => {
  console.log(`🔌 KKM bridge запущен на http://${HOST}:${PORT}/api/kkm`);
  console.log(`   Режим:         ${USE_MOCK ? 'MOCK' : 'REAL'}`);
  console.log(`   PowerShell:    ${POWERSHELL}`);
  console.log(`   PowerShell:    ${fs.existsSync(POWERSHELL) ? '✅' : '❌ не найден'}`);
  console.log(`   PS-скрипт:     ${PS_SCRIPT}`);
  console.log(`   PS-скрипт:     ${fs.existsSync(PS_SCRIPT) ? '✅' : '❌ не найден'}`);
  console.log(`   COM-порт:      COM${COM_NUMBER} @ ${BAUD_RATE}`);
});