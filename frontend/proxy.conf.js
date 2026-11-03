const http = require('http');

module.exports = {
  "/api": {
    "target": "http://localhost:3000",
    "secure": false,
    "changeOrigin": true,
    "logLevel": "debug"
  },
  "/ws": {
    "target": "ws://localhost:3000",
    "ws": true,
    "secure": false,
    "changeOrigin": true,
    "agent": new http.Agent({ keepAlive: true }),
    "configure": (proxy) => {
      proxy.on('error', (err) => {
        console.warn('[Proxy WS] Ошибка соединения (проигнорировано):', err.message);
      });
    }
  }
};