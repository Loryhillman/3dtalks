# 3dtalks — виртуальный 3D-мир

Браузерный многопользовательский мир на Three.js, Node.js/Express и PostgreSQL.
В этой версии добавлены русская локализация, заготовки комнаты и мебели,
а также коллизии стен с открытым входом. Есть редактор мира, импорт моделей,
группировка объектов, порталы, текстовый чат и голосовое общение.

Исходный проект: [miduo100/3d-virtual-world](https://github.com/miduo100/3d-virtual-world).
Авторские уведомления и условия [LICENSE](LICENSE) и [EULA](EULA.md) сохранены.

## Важно перед запуском

**Одного клонирования недостаточно для восстановления существующего мира.**
Код хранится в Git, а комната, мебель, порталы и аккаунты — в PostgreSQL.
Загруженные модели и медиа находятся в отдельных файловых хранилищах.

В репозиторий намеренно не включены:

- рабочие файлы с паролями и секретами;
- `db_export.sql` — SQL-дамп базы;
- загруженные модели, анимации и медиа;
- `node_modules` — зависимости устанавливаются при сборке Docker.

Ниже описан перенос **уже работающего мира**. Для запуска новой копии без
собственных данных требуется отдельно получить совместимый начальный дамп
и соответствующие ему модели. Инструкция не предполагает, что проект умеет
полностью инициализировать пустую базу одной командой.

## 1. Требования

Нужны Git, работающий Docker Engine и Docker Compose. На Linux/WSL Docker
Desktop не обязателен. Проверка:

```bash
git --version
docker info
docker compose version
```

В WSL с установленным Docker Engine и без systemd можно запустить службу:

```bash
ulimit -Sn 1024
service docker start
docker info
```

Эти команды рассчитаны на текущую среду Ubuntu/WSL с правами root.
Если Docker уже работает, перезапускать его не нужно.

## 2. Подготовить перенос на текущем компьютере

Выполняйте из **работающего проекта**, в нашем случае `~/projects/3d-virtual-world`.
На время копирования остановите приложение, чтобы база и файлы не менялись.
PostgreSQL продолжает работать.

```bash
cd ~/projects/3d-virtual-world
mkdir -p transfer/assets/public
chmod 700 transfer

docker compose -f docker-compose.local.yml stop app

docker compose -f docker-compose.local.yml exec -T postgres \
  pg_dump -U postgres -d virtual_world --no-owner --no-privileges \
  > transfer/db_export.sql

APP_CONTAINER=$(docker compose -f docker-compose.local.yml ps -aq app)
```

Убедитесь, что `pg_dump` завершился без ошибки, а дамп не пуст:

```bash
test -s transfer/db_export.sql && ls -lh transfer/db_export.sql
```

Скопируйте данные из контейнера, включая подключённые volumes:

```bash
for directory in uploads .local-state; do
  docker cp "$APP_CONTAINER:/app/$directory" transfer/assets/
done

for directory in uploads models generated uploaded scenes gallery_content; do
  docker cp "$APP_CONTAINER:/app/public/$directory" transfer/assets/public/
done

docker compose -f docker-compose.local.yml start app
```

Проверьте ошибки каждой команды. Если какой-либо каталог отсутствует, убедитесь,
что он действительно не используется в вашем мире; остальные каталоги нужно перенести.
`.local-state` содержит ключи подписи и шифрования текущей локальной установки:
они нужны для сохранения доступа к зашифрованным настройкам. Если ключи задавались
через переменные окружения, сохраните их отдельно защищённым способом.

Папка `transfer` содержит приватные данные. **Не добавляйте её в Git.** Передайте
её на сервер через SSH/SCP или другой защищённый канал. Например, из WSL:

```bash
scp -r transfer USER@SERVER:/home/USER/3dtalks-transfer
```

Замените `USER` и `SERVER` своими значениями. На сервере ограничьте доступ к копии.

## 3. Клонировать код и подготовить базу

На целевом компьютере или сервере:

```bash
git clone https://github.com/Loryhillman/3dtalks.git
cd 3dtalks

cp /home/USER/3dtalks-transfer/db_export.sql ./db_export.sql
chmod 600 db_export.sql
```

Для локальной проверки достаточно основной Compose-конфигурации.
Для сервера сначала выполните настройку из следующего раздела.

## 4. Настройки сервера

`docker-compose.local.yml` публикует приложение только на `127.0.0.1:3002`.
База снаружи недоступна. Для серверного запуска используйте тот же стек с
локальным файлом переопределения и собственным паролем.

Создайте `.env.server`:

```dotenv
DB_PASSWORD=REPLACE_WITH_LONG_RANDOM_PASSWORD
WORLD_URL=https://talks.example.com
```

Задайте собственный пароль; например, сгенерируйте его через `openssl rand -hex 32`.
Домен замените своим. Затем создайте `docker-compose.server.yml`:

```yaml
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD in .env.server}
  app:
    environment:
      DB_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD in .env.server}
      NODE_ENV: production
      WORLD_NAME: 3dtalks
      WORLD_URL: ${WORLD_URL:?Set WORLD_URL in .env.server}
      AUTO_CONNECT_CENTRAL: "false"
      TRUST_PROXY: "1"
```

```bash
chmod 600 .env.server
```

Секреты приложения берутся из восстановленного `.local-state`; при отсутствии
сохранённых секретов скрипт `local-start.js` создаёт их в отдельном volume.
Если прежняя установка использовала ключи из окружения, передайте те же ключи
приложению через защищённый env-файл, а не через Git.

В командах ниже показан локальный запуск. **Для сервера в каждой команде Compose
используйте полный префикс:**

```bash
docker compose --env-file .env.server \
  -f docker-compose.local.yml -f docker-compose.server.yml
```

Например, сборка на сервере:

```bash
docker compose --env-file .env.server \
  -f docker-compose.local.yml -f docker-compose.server.yml build app
```

Пароль PostgreSQL применяется при создании нового volume. Изменение переменной
не меняет пароль в уже инициализированной базе. Этот сценарий рассчитан на новый
целевой стек, а не на перезапись существующей серверной базы.

## 5. Восстановить файлы и запустить

Сначала соберите приложение и создайте его контейнер без запуска:

```bash
docker compose -f docker-compose.local.yml build app
docker compose -f docker-compose.local.yml create --no-deps app

APP_CONTAINER=$(docker compose -f docker-compose.local.yml ps -aq app)
docker cp /home/USER/3dtalks-transfer/assets/. "$APP_CONTAINER:/app/"
```

Восстановите права на каталоги volumes:

```bash
docker compose -f docker-compose.local.yml run --rm --no-deps \
  --user root --entrypoint sh app -c \
  'chown -R node:node /app/.local-state /app/uploads /app/public/uploads /app/public/models /app/public/generated /app/public/uploaded /app/public/scenes /app/public/gallery_content'
```

Запустите стек:

```bash
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml ps
curl -i http://localhost:3002/api/ready
```

На первом старте PostgreSQL импортирует `db_export.sql` в **новый** volume.
Повторный запуск или пересборка приложения дамп заново не импортируют.
Импорт большой базы может занять время; следите за логами:

```bash
docker compose -f docker-compose.local.yml logs --tail=100 postgres app
```

Ожидаемый результат: оба сервиса `healthy`, `/api/ready` отвечает HTTP 200
и `{"status":"ready"}`. `/api/health` проверяет HTTP-процесс, а `/api/ready`
дополнительно проверяет доступность основной структуры базы.

Локальные адреса:

- игра: <http://localhost:3002/>;
- админка: <http://localhost:3002/admin.html>;
- вход администратора: <http://localhost:3002/admin_login.html>;
- редактор мира: <http://localhost:3002/world_editor.html>.

При переносе используются аккаунты из вашей базы. После импорта чужого начального
дампа смените административные пароли до открытия внешнего доступа.

## 6. Домен, HTTPS и WebSocket

На публичном сервере поставьте обратный прокси перед `127.0.0.1:3002` и настройте
HTTPS с действительным сертификатом. HTTPS нужен в том числе для доступа к
микрофону браузера вне `localhost`. Открывайте наружу порты 80/443, а не PostgreSQL.

HTTP и игровой WebSocket в текущем коде обслуживаются **одним портом 3002**.
Отдельно публиковать порт 3001 для этого сценария не требуется.
Прокси должен передавать WebSocket Upgrade, включая запросы к корневому пути `/`.

Пример конфигурации Nginx после установки сертификата (домен и пути замените):

```nginx
server {
    listen 80;
    server_name talks.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name talks.example.com;
    ssl_certificate /etc/letsencrypt/live/talks.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/talks.example.com/privkey.pem;
    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```

`TRUST_PROXY=1` соответствует одному обратному прокси. В текущем коде это
переключатель доверия заголовкам и число переходов, а не список доверенных сетей.
Поэтому приложение должно оставаться доступным только через локальный порт и
ваш прокси. Для запуска без прокси оставьте `false`.

## 7. Проверка после переноса

- Войти в админку и в игру своим аккаунтом.
- Проверить комнату, стол, шесть стульев и коллизии стен.
- Проверить прямой и обратный порталы.
- Войти вторым аккаунтом из другого браузера: проверить движение и чат.
- Проверить микрофоны через HTTPS с наушниками.
- Если видны синие кубы, проверить URL модели в Network: HTTP 404 означает,
  что файл отсутствует по нужному пути. Одного переноса базы недостаточно.

## 8. Обновление и остановка

В каталоге развёрнутой копии:

```bash
git pull --ff-only
docker compose -f docker-compose.local.yml up --build -d
```

Для сервера используйте полный префикс с `.env.server` и двумя Compose-файлами.
После обновления браузерных файлов обновите страницу через `Ctrl+Shift+R`.

```bash
# Остановка с сохранением данных
docker compose -f docker-compose.local.yml down
```

**Не используйте `down -v`: эта команда удаляет volumes с базой, моделями и ключами.**
Для обновления кода перезапуск самой службы Docker не требуется.

## Документация

- [Создание комнаты и настройка порталов](ROOM_CREATION_RU.md)
- [Статус русификации](I18N_RU.md)
- [Возможности и ограничения проекта](PROJECT_CAPABILITIES_REPORT_RU.md)
- [Обзор для менеджеров](PROJECT_OVERVIEW_FOR_MANAGEMENT_RU.md)
- [Восстановление моделей исходного мира](RESTORE_WORLD_MODELS_RU.md)
- [Особенности публикационной копии](PUBLISHING_RU.md)

Сценарий локальной работы проверялся в WSL. Перенос на публичный сервер и
конфигурация прокси требуют проверки в выбранной серверной среде.
