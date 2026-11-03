const mqtt = require('mqtt');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { getMqttConfig } = require('../config');

// Получаем настройки из общего файла
const config = getMqttConfig();
const client = mqtt.connect(config.brokerUrl, {
  username: config.username,
  password: config.password
});

const ORGANIZATION = {
  name: "ООО 'Мойка Самообслуживания'",
  inn: "123456789012",
  address: "г. Москва, ул. Примерная, д. 1",
  phone: "+7 (495) 123-45-67",
  website: "example-carwash.ru"
};

const receiptsDir = path.join(__dirname, 'receipts');
if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir);

let lastReceiptTime = null;

client.on('connect', () => {
  console.log('✅ ККМ симулятор подключён');
  client.subscribe('kkm/print');
  client.subscribe('kkm/command');
  setInterval(() => {
    const status = {
      connected: true,
      ready: true,
      lastReceipt: lastReceiptTime,
      paper: true,
      errors: []
    };
    client.publish('kkm/status', JSON.stringify(status));
  }, 5000);
});

client.on('message', (topic, message) => {
  if (topic === 'kkm/print') {
    try {
      const data = JSON.parse(message.toString());
      generateReceipt(data);
      lastReceiptTime = new Date().toISOString();
    } catch (e) { console.error('Ошибка чека:', e.message); }
  } else if (topic === 'kkm/command') {
    const cmd = message.toString();
    if (cmd === 'get_status') {
      const status = {
        connected: true,
        ready: true,
        lastReceipt: lastReceiptTime,
        paper: true,
        errors: []
      };
      client.publish('kkm/status', JSON.stringify(status));
    }
  }
});

function generateReceipt(data) {
  const { postId, items, balance, operation, timestamp = new Date() } = data;
  const date = new Date(timestamp);
  const fiscalSign = Math.floor(Math.random() * 1000000000);
  const receiptNumber = Math.floor(Math.random() * 1000);
  const shiftNumber = 1;

  let itemsHtml = '';
  let totalCost = 0;
  items.forEach(item => {
    const pricePerSec = item.pricePerSecond.toFixed(2);
    const cost = item.cost.toFixed(2);
    totalCost += item.cost;
    itemsHtml += `
      <div>${item.name}</div>
      <div>Время: ${item.seconds.toFixed(3)} сек × ${pricePerSec} руб/сек = ${cost} руб.</div>
      <div class="line" style="margin: 2px 0;"></div>
    `;
  });

  const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Кассовый чек</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; margin: 0 auto; padding: 5px; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .line { border-top: 1px dashed #000; margin: 5px 0; }
  .qr { text-align: center; margin: 10px 0; }
  .qr img { width: 80px; height: 80px; }
  .small { font-size: 10px; }
</style>
</head>
<body>
  <div class="center bold">${ORGANIZATION.name}</div>
  <div class="center">ИНН: ${ORGANIZATION.inn}</div>
  <div class="center">${ORGANIZATION.address}</div>
  <div class="center">Тел: ${ORGANIZATION.phone}</div>
  <div class="center">Сайт: ${ORGANIZATION.website}</div>
  <div class="line"></div>
  <div class="center bold">КАССОВЫЙ ЧЕК</div>
  <div class="center">ПРИХОД</div>
  <div class="line"></div>
  <div>Пост №${postId}</div>
  <div>${date.toLocaleString()}</div>
  <div>Смена №${shiftNumber}</div>
  <div>Чек №${receiptNumber}</div>
  <div class="line"></div>
  <div class="bold">Оказанные услуги:</div>
  ${itemsHtml}
  <div class="line"></div>
  <div class="bold">ИТОГО: ${totalCost.toFixed(2)} руб.</div>
  <div>Остаток на балансе: ${balance.toFixed(2)} руб.</div>
  <div class="line"></div>
  <div>Форма оплаты: ЭЛЕКТРОННЫМИ</div>
  <div>НДС: Без НДС</div>
  <div>Система налогообложения: УСН (Доходы)</div>
  <div class="line"></div>
  <div>Фискальный признак: ${fiscalSign}</div>
  <div class="line"></div>
  <div class="center small">Сайт ФНС: www.nalog.ru</div>
  <div class="center small">QR-код для проверки чека</div>
  <div class="qr" id="qrcode"></div>
  <div class="center small">Спасибо за покупку!</div>
</body>
</html>`;

  const qrData = `t=${date.getTime()}&s=${totalCost.toFixed(2)}&fn=9999078900000013&i=${receiptNumber}&fp=${fiscalSign}&n=1`;
  const qrFileName = `qr_${postId}_${Date.now()}.png`;
  const qrFilePath = path.join(receiptsDir, qrFileName);

  QRCode.toFile(qrFilePath, qrData, { width: 200 }, (err) => {
    if (err) return console.error('QR-ошибка:', err);
    const finalHtml = htmlContent.replace('<div class="qr" id="qrcode"></div>',
      `<div class="qr"><img src="${qrFileName}" alt="QR-код"></div>`);
    const receiptFileName = `receipt_${postId}_${Date.now()}.html`;
    const receiptFilePath = path.join(receiptsDir, receiptFileName);
    fs.writeFileSync(receiptFilePath, finalHtml);
    console.log(`\n🧾 ЧЕК СОЗДАН\nФайл: ${receiptFilePath}\nПост: ${postId}, Услуг: ${items.length}, Сумма: ${totalCost.toFixed(2)} руб.\n`);
  });
}

process.on('SIGINT', () => {
  console.log('Завершение ККМ симулятора');
  client.end();
  process.exit();
});

console.log('✅ ККМ симулятор АТОЛ запущен');
