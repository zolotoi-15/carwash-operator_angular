const mqtt = require('mqtt');
const { getMqttConfig } = require('../config');

const config = getMqttConfig();
const client = mqtt.connect(config.brokerUrl, {
  username: config.username,
  password: config.password
});

const POST_IDS = [2, 3, 4, 5, 6, 7, 8];

let pricePerMinute = {
  water: 30, foam: 40, wax: 50, teflon: 60,
  osmosis: 70, hotWater: 35, waterFoam: 45, turbo: 80
};

const postsState = {};
POST_IDS.forEach(id => {
  postsState[id] = {
    busy: false, paused: false, balance: 0, currentProgram: '-',
    elapsedSec: 0, totalPaid: 0, servicesUsage: {}, timerInterval: null
  };
});

// ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (определяем до вызовов) ----------
function publishStatus(postId) {
  const state = postsState[postId];
  const status = {
    busy: state.busy,
    paused: state.paused,
    balance: state.balance,
    currentProgram: state.currentProgram,
    elapsedSec: Math.round(state.elapsedSec * 100) / 100,
    totalPaid: state.totalPaid
  };
  client.publish(`posts/${postId}/status`, JSON.stringify(status));
}

function handleProgram(postId, program) {
  const state = postsState[postId];
  console.log(`🎯 Пост ${postId}: программа ${program}`);
  const pricePerSec = pricePerMinute[program] / 60;
  if (state.balance >= pricePerSec || state.balance > 0) {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.busy = true;
    state.paused = false;
    state.currentProgram = program;
    state.elapsedSec = 0;
    startTimer(postId);
  } else {
    console.log(`❌ Пост ${postId}: баланс = 0, нельзя запустить`);
  }
  publishStatus(postId);
}

function addBalance(postId, amount) {
  const state = postsState[postId];
  console.log(`💰 Пост ${postId}: +${amount} руб. (было ${state.balance})`);
  state.balance += amount;
  state.totalPaid += amount;
  publishStatus(postId);
}

function togglePause(postId) {
  const state = postsState[postId];
  if (!state.busy) return console.log(`Пост ${postId} не активен`);
  state.paused = !state.paused;
  if (state.paused) {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = null;
    console.log(`⏸️ Пост ${postId}: пауза`);
  } else {
    console.log(`▶️ Пост ${postId}: возобновление`);
    startTimer(postId);
  }
  publishStatus(postId);
}

function stopPost(postId, publish = true, printReceipt = false) {
  const state = postsState[postId];
  console.log(`⏹️ Пост ${postId}: остановка`);
  if (printReceipt && Object.keys(state.servicesUsage).length > 0) {
    sendReceipt(postId, true);
  }
  state.busy = false;
  state.paused = false;
  state.currentProgram = '-';
  state.elapsedSec = 0;
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = null;
  if (publish) publishStatus(postId);
}

function resetPost(postId) {
  const state = postsState[postId];
  console.log(`🔄 Пост ${postId}: полный сброс`);
  if (state.timerInterval) clearInterval(state.timerInterval);
  postsState[postId] = {
    busy: false, paused: false, balance: 0, currentProgram: '-',
    elapsedSec: 0, totalPaid: 0, servicesUsage: {}, timerInterval: null
  };
  publishStatus(postId);
}

function startTimer(postId) {
  const state = postsState[postId];
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (state.busy && !state.paused) {
      const prog = state.currentProgram;
      const pricePerSec = pricePerMinute[prog] / 60;
      if (state.balance >= pricePerSec) {
        state.balance -= pricePerSec;
        state.elapsedSec++;
        if (!state.servicesUsage[prog]) state.servicesUsage[prog] = { seconds: 0, cost: 0 };
        state.servicesUsage[prog].seconds++;
        state.servicesUsage[prog].cost += pricePerSec;
        publishStatus(postId);
      } else if (state.balance > 0) {
        const remaining = state.balance;
        const fraction = remaining / pricePerSec;
        state.balance = 0;
        state.elapsedSec += fraction;
        if (!state.servicesUsage[prog]) state.servicesUsage[prog] = { seconds: 0, cost: 0 };
        state.servicesUsage[prog].seconds += fraction;
        state.servicesUsage[prog].cost += remaining;
        state.servicesUsage[prog].cost = Math.round(state.servicesUsage[prog].cost * 100) / 100;
        publishStatus(postId);
        console.log(`⚠️ Пост ${postId}: списано последние ${remaining.toFixed(2)} руб. (${fraction.toFixed(3)} сек). Остановка.`);
        if (Object.keys(state.servicesUsage).length > 0) sendReceipt(postId, true);
        stopPost(postId, true, false);
      } else {
        if (Object.keys(state.servicesUsage).length > 0) sendReceipt(postId, true);
        stopPost(postId, true, false);
      }
    }
  }, 1000);
}

function sendReceipt(postId, clearUsage = true) {
  const state = postsState[postId];
  const items = [];
  for (const [program, data] of Object.entries(state.servicesUsage)) {
    if (data.seconds > 0) {
      items.push({
        name: program,
        seconds: Math.round(data.seconds * 1000) / 1000,
        cost: data.cost,
        pricePerSecond: data.cost / data.seconds
      });
    }
  }
  if (items.length === 0) {
    console.log(`⚠️ Пост ${postId}: нет услуг для печати чека.`);
    return;
  }
  const receiptData = {
    postId,
    timestamp: new Date().toISOString(),
    operation: clearUsage ? 'Окончательный чек (обнуление баланса)' : 'Промежуточный чек (по запросу)',
    items: items,
    balance: state.balance
  };
  client.publish('kkm/print', JSON.stringify(receiptData));
  console.log(`📤 Пост ${postId}: отправлен чек с ${items.length} услугами, общая сумма ${items.reduce((s, i) => s + i.cost, 0).toFixed(2)} руб.`);
  if (clearUsage) state.servicesUsage = {};
}

// ---------- ПОДКЛЮЧЕНИЕ И ОБРАБОТЧИКИ ----------
client.on('connect', () => {
  console.log('✅ Мульти-симулятор подключён');
  client.subscribe('posts/+/command');
  client.subscribe('posts/+/config');
  POST_IDS.forEach(id => publishStatus(id));
});

client.on('message', (topic, message) => {
  // Обработка конфига
  if (topic.endsWith('/config')) {
    try {
      const parts = topic.split('/');
      const postId = parts[1]; // например "3"
      const payload = JSON.parse(message.toString());
      const services = payload[postId]?.services;
      if (services && Array.isArray(services)) {
        services.forEach(service => {
          if (pricePerMinute[service.name] !== undefined) {
            pricePerMinute[service.name] = service.price;
            console.log(`📥 Цена обновлена для поста ${postId}: ${service.name} = ${service.price} руб/мин`);
          }
        });
      } else {
        console.warn(`⚠️ Неверный формат конфига для поста ${postId}:`, payload);
      }
    } catch (e) {
      console.error('Ошибка обработки конфига:', e);
    }
    return;
  }
  // Обработка команд
  const match = topic.match(/^posts\/(\d+)\/command$/);
  if (!match) return;
  const postId = parseInt(match[1]);
  const state = postsState[postId];
  if (!state) return;

  try {
    const parsed = JSON.parse(message.toString());
    const command = parsed.command;
    console.log(`📨 Пост ${postId}: ${command}`);

    if (command.startsWith('program ')) {
      const program = command.split(' ')[1];
      if (state.busy) stopPost(postId, false, false);
      handleProgram(postId, program);
    }
    else if (command === 'pause') togglePause(postId);
    else if (command.startsWith('add_balance ')) {
      const amount = parseInt(command.split(' ')[1]);
      if (!isNaN(amount)) addBalance(postId, amount);
    }
    else if (command === 'stop') stopPost(postId, true, true);
    else if (command === 'reset') resetPost(postId);
    else if (command === 'print_receipt') sendReceipt(postId, true);
    else console.log(`⚠️ Пост ${postId}: неизвестная команда: ${command}`);
  } catch (e) { console.error(`Ошибка JSON для поста ${postId}:`, e.message); }
});

process.on('SIGINT', () => {
  console.log('Завершение мульти-симулятора');
  POST_IDS.forEach(id => {
    if (postsState[id].timerInterval) clearInterval(postsState[id].timerInterval);
  });
  client.end();
  process.exit();
});
