// frontend/src/environments/environment.prod.ts
export const environment = {
  production: true,

  /** Базовый URL REST API. Относительный — nginx проксирует /api на backend:3000. */
  apiUrl: '/api',

  /** URL MQTT-брокера (WebSocket). Пусто — MQTT-настройки берутся из /api/settings. */
  mqttUrl: '',

  /**
   * URL WebSocket для RealtimeService.
   * Пусто  → собирается автоматически: ws(s)://<location.host>/ws
   *         (протокол выбирается по location.protocol — https → wss)
   * Задано → используется как есть, например 'wss://carwash.example.com/ws'.
   */
  wsUrl: '',
};