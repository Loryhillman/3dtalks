# Развёртывание 3dtalks на сервере

Многопользовательский 3D-мир с редактором, персонажами, портальными переходами,
чатом и голосовыми сообщениями. Основан на
[3d-virtual-world](https://github.com/miduo100/3d-virtual-world);
авторские уведомления, [LICENSE](LICENSE) и [EULA](EULA.md) сохранены.

## Запуск после клонирования

Нужны работающие **Docker Engine и Docker Compose**. Все команды ниже выполняются
из каталога клонированного репозитория на Linux-сервере.

### 1. Добавьте данные мира

Положите в корень проекта **актуальный** `db_export.sql` вашей установки.
Каталог с файлами предыдущей установки положите в `transfer/assets/`: например,
`transfer/assets/public/uploads/` и `transfer/assets/public/models/`.

**Без дампа эта Compose-конфигурация не создаст работающий мир.** Если дамп
есть, а файлов моделей нет, игра запустится, но часть персонажей и объектов
будет отсутствовать. `git clone` ничего не пропустил: файлы, загруженные в
работающий сервис после публикации кода, не входят в репозиторий.

```bash
# Только для первого импорта: PostgreSQL в контейнере должен читать файл.
chmod 644 db_export.sql
```

### 2. Настройте сервер

Для новой установки с пустым томом базы сгенерируйте пароль и создайте конфигурации.
На существующей установке сохраните текущий пароль и файлы конфигурации.
Замените `IP_СЕРВЕРА` своим адресом в `WORLD_URL`:

```bash
printf 'DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" > .env.server
chmod 600 .env.server

cat > docker-compose.server.yml <<'YAML'
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
  app:
    environment:
      DB_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
      NODE_ENV: production
      WORLD_NAME: 3dtalks
      WORLD_URL: "http://IP_СЕРВЕРА:3002"
      ROOMS_ENABLED: "true"
      APP_MODE: "rooms"
      AUTO_CONNECT_CENTRAL: "false"
      TRUST_PROXY: "false"
YAML

cat > docker-compose.ip.yml <<'YAML'
services:
  app:
    ports: !override
      - "0.0.0.0:3002:3002"
YAML
```

Файлы `.env.server`, `docker-compose.server.yml`, `docker-compose.ip.yml` и
`db_export.sql` в Git не добавляйте. Если нужен доступ только с самого сервера,
не создавайте `docker-compose.ip.yml` и не подключайте его в командах ниже.

### 3. Соберите и запустите

```bash
# Короткое имя для всех команд ниже; действует в текущем терминале.
dc() { docker compose --env-file .env.server -f docker-compose.local.yml -f docker-compose.server.yml -f docker-compose.ip.yml "$@"; }

dc up --build -d
dc ps
curl -i http://127.0.0.1:3002/api/ready
```

Если переносите существующий мир, скопируйте его файлы в тома контейнера:

```bash
APP_CONTAINER=$(dc ps -q app)
for dir in uploads models generated uploaded scenes gallery_content; do
  if [ -d "transfer/assets/public/$dir" ]; then
    docker cp "transfer/assets/public/$dir/." "$APP_CONTAINER:/app/public/$dir/"
  fi
done
for dir in uploads .local-state; do
  if [ -d "transfer/assets/$dir" ]; then
    docker cp "transfer/assets/$dir/." "$APP_CONTAINER:/app/$dir/"
  fi
done
docker exec -u root "$APP_CONTAINER" sh -c 'chown -R node:node /app/public/uploads /app/public/models /app/public/generated /app/public/uploaded /app/public/scenes /app/public/gallery_content /app/uploads /app/.local-state'
dc restart app
```

Повторите проверку `curl` после копирования. Ожидаемый ответ — HTTP 200 и
`{"status":"ready"}`. Первый импорт базы может
занять несколько минут. Если приложение не готово:

```bash
dc logs --tail=100 postgres app
```

После **успешного первого импорта** ограничьте доступ к дампу:

```bash
chmod 600 db_export.sql
```

Важно: если первичный импорт завершился ошибкой, PostgreSQL может оставить
инициализированную, но пустую базу. Повторный `up` дамп автоматически не
импортирует. Не удаляйте volumes с данными; сначала проверьте логи.

### 4. Проверьте сайт

- Кабинет пользователя: `http://IP_СЕРВЕРА:3002/`
- Вход в админку: `http://IP_СЕРВЕРА:3002/admin_login.html`
- Редактор шаблонов: админка → «Мир и сцены» → «Комнаты» → «Шаблоны переговорных».

В панели хостинга разрешите входящий **TCP 3002**. PostgreSQL наружу открывать
не нужно. Для микрофона на публичном адресе потребуется HTTPS: браузеры обычно
не предоставляют доступ к нему по обычному HTTP на IP.

### Обновление

```bash
git pull --ff-only
dc up --build -d
```

Обычный `down` сохраняет базу и модели. **Не используйте `down -v`**, если
нужны ваши данные. Модели, база и секреты должны входить в резервную копию
отдельно от Git.


## Модели и данные

Git хранит код, но не вашу базу, загруженную мебель и изображения.
Переносите актуальный дамп и файлы своей установки; автоматически скачивать
весь демонстрационный контент исходного проекта не требуется.
Дамп импортируется только при первом запуске PostgreSQL с пустым томом.
Сохранённые комнаты и опубликованные шаблоны находятся в базе.
