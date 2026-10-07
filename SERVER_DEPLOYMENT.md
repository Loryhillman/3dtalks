# Запуск на сервере

Нужны Docker Engine и Docker Compose. На сервере:

```bash
git clone https://github.com/Loryhillman/3dtalks.git
cd 3dtalks
cp .env.example .env
```

Заполните `.env`:

```dotenv
WORLD_URL=http://IP_СЕРВЕРА:3002
DB_PASSWORD='ваш_пароль_базы'
ADMIN_USERNAME=admin
ADMIN_PASSWORD='ваш_пароль_администратора'
BIND_ADDRESS=0.0.0.0
HTTP_PORT=3002
```

Замените адрес и пароли своими. `ADMIN_PASSWORD` — от 12 символов,
до 72 байт UTF-8. Пароли с `$` или `#` заключайте в одинарные кавычки.
`WORLD_NAME` — необязательное название сайта.

```bash
docker compose up -d --build
```

База, первый администратор, секреты и базовый шаблон комнаты создадутся
автоматически. Откройте `http://IP_СЕРВЕРА:3002/`; админка находится на
`/admin_login.html`. В панели хостинга разрешите TCP 3002. База наружу не публикуется.
Для работы микрофона на публичном адресе требуется HTTPS; после настройки
HTTPS укажите соответствующий адрес в `WORLD_URL`.

## Проверка и обновление

```bash
docker compose ps
curl --fail http://127.0.0.1:3002/api/ready
docker compose logs --tail=100 app postgres
```

Ожидаемый ответ проверки: `{"status":"ready"}`. Обновление кода:

```bash
git pull --ff-only
docker compose up -d --build
```

## Существующая установка и данные

На существующем сервере сохраните действующий пароль PostgreSQL и тома:
не заменяйте `.env` примером. При переходе с нашей старой конфигурации перенесите
значения из `.env.server` в `.env`, включая `DB_PASSWORD`, и задайте адрес сайта.
Новая конфигурация использует прежнее имя проекта `virtual-world-local` и
прежние имена томов. Если старая установка запускалась с другим именем проекта,
сохраните его через `COMPOSE_PROJECT_NAME` в `.env`.
Существующие администраторы не пересоздаются; `.env` не сбрасывает их пароли.

База, модели и изображения хранятся в Docker-томах и не входят в Git.
Новая установка создаёт базовый шаблон; для переноса ваших комнат и мебели
потребуются резервная копия базы и загруженные файлы. Пересборка контейнера
не переносит данные с другого компьютера и не заменяет содержимое томов.

`docker compose down` сохраняет данные. **Не выполняйте `docker compose down -v`**
для рабочей установки. Резервируйте базу, тома с файлами и `.env` отдельно.

Если после переноса файлов появляется `EACCES: permission denied` для папок
загрузок, восстановите владельца файлов в существующих томах:

```bash
docker compose exec --user root app chown -R node:node /app/uploads /app/public/uploads /app/public/models /app/public/generated /app/public/uploaded /app/public/scenes /app/public/gallery_content
```

Команда предназначена для серверной установки без `compose.dev.yaml`.
