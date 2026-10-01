# Этап 1: Сборка Angular приложения
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY . .

# Собираем production-версию
RUN npm run build -- --configuration production

# Этап 2: Раздача через Nginx
FROM nginx:stable-alpine

# Копируем собранные файлы из первого этапа
COPY --from=builder /app/dist/carwash-operator-angular/browser /usr/share/nginx/html

# Копируем конфиг Nginx (создадим ниже)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]