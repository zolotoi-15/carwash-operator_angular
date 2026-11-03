# ---------- 1. BUILD ANGULAR ----------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Прод-сборка. --configuration production использует environment.prod.ts
RUN npm run build -- --configuration production

# ---------- 2. RUNTIME NGINX ----------
FROM nginx:1.27-alpine

# Angular 17+ кладёт билд в dist/<project>/browser
COPY --from=builder /app/dist/carwash-operator/browser /usr/share/nginx/html

# Конфиг nginx с proxy на backend:3000
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]