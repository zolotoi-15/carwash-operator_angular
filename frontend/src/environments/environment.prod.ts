export const environment = {
  production: true,
  apiUrl: '/api',               // относительный — nginx проксирует на backend:3000
  mqttUrl: '',                   // MQTT берётся из /api/settings (mqtt.local.host)
  wsUrl: '',  // или ws://ваш-домен/ws через nginx
};