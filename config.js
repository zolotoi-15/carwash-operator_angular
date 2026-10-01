const fs = require('fs');
const path = require('path');

/**
 * Возвращает конфигурацию MQTT из файла mqtt-config.json,
 * либо значения по умолчанию, если файл отсутствует.
 */
function getMqttConfig() {
  const configPath = path.join(__dirname, 'mqtt-config.json');
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(data);
    return {
      brokerUrl: config.brokerUrl || 'ws://localhost:8083',
      username: config.username || '',
      password: config.password || ''
    };
  } catch (err) {
    // Файла нет – используем переменные окружения или значения по умолчанию
    return {
      brokerUrl: process.env.MQTT_BROKER_URL || 'ws://localhost:8083',
      username: process.env.MQTT_USERNAME || '',
      password: process.env.MQTT_PASSWORD || ''
    };
  }
}

module.exports = { getMqttConfig };
