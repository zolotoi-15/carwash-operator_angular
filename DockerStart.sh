# Сборка и запуск
docker compose up --build -d

# Логи
docker compose logs -f frontend
docker compose logs -f backend

# Проверка
curl http://localhost:8080              # отдаёт index.html
curl http://localhost:8080/api/settings # проксируется на backend