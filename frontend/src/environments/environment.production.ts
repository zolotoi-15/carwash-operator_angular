export const environment = {
  ...environment,
  production: true,
  apiUrl: 'https://api.carwash.example.com/api',
  wsUrl: `ws://${location.hostname}:3000/ws`  // или ws://ваш-домен/ws через nginx
};