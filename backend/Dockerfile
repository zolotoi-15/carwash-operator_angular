FROM node:20-alpine

WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./

# Устанавливаем только production-зависимости
RUN npm install --omit=dev

# Копируем исходный код
COPY . .

# Открываем порт (должен совпадать с PORT в .env)
EXPOSE 3000

# Запускаем сервер
CMD ["node", "server.js"]