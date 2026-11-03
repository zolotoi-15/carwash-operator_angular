FROM node:20-alpine

WORKDIR /app

# Прод-зависимости
COPY package*.json ./
RUN npm ci --omit=dev

# Исходники
COPY . .

# Папки, которые server.js пытается писать/читать
RUN mkdir -p /app/fonts

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["node", "server.js"]