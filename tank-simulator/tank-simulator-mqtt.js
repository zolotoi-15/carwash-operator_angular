const mqtt = require('mqtt');
const { getMqttConfig } = require('../config');

// Получаем настройки из общего файла
const config = getMqttConfig();
const client = mqtt.connect(config.brokerUrl, {
  username: config.username,
  password: config.password
});

const tanks = ['water', 'foam', 'wax', 'teflon', 'osmosis'];

// Начальные уровни (можно взять из настроек, но для простоты зададим)
let currentLevels = {
  water: 80,
  foam: 65,
  wax: 45,
  teflon: 90,
  osmosis: 30
};

// Функция случайного изменения (от -5 до +5, но не выходить за 0..100)
function randomChange(current) {
  let delta = (Math.random() - 0.5) * 10; // -5..5
  let newVal = current + delta;
  if (newVal < 0) newVal = 0;
  if (newVal > 100) newVal = 100;
  return Math.round(newVal);
}

client.on('connect', () => {
  console.log('✅ Симулятор датчиков уровней подключён к MQTT');
  console.log('📊 Начальные уровни:', currentLevels);

  setInterval(() => {
    tanks.forEach(tank => {
      const newLevel = randomChange(currentLevels[tank]);
      if (newLevel !== currentLevels[tank]) {
        const payload = JSON.stringify({ tank, level: newLevel });
        client.publish('tank/levels', payload);
        console.log(`📤 ${tank}: ${currentLevels[tank]}% → ${newLevel}%`);
        currentLevels[tank] = newLevel;
      }
    });
  }, 10000); // каждые 10 секунд
});

client.on('error', (err) => {
  console.error('MQTT ошибка:', err);
});

process.on('SIGINT', () => {
  console.log('Завершение симулятора уровней');
  client.end();
  process.exit();
});
