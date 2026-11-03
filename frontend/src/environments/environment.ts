// frontend/src/environments/environment.ts
export const environment = {
  production: false,

  /** Базовый URL REST API. Относительный — dev-сервер (vite) проксирует /api на backend:3000. */
  apiUrl: '/api',

  /** URL MQTT-брокера (WebSocket). Пусто — MQTT-настройки берутся из /api/settings (mqtt.local.host). */
  mqttUrl: '',

  /**
   * URL WebSocket для RealtimeService.
   * Пусто  → собирается автоматически: ws://<location.host>/ws
   * Задано → используется как есть.
   */
  wsUrl: '',
};