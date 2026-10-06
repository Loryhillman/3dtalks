# Локальная разработка переговорных

Работайте в WSL из `~/projects/3d-virtual-world`. Нужен работающий Docker Engine
с Compose. Node.js и PostgreSQL на компьютере отдельно устанавливать не нужно.

## Перед первым запуском

После клонирования перейдите в каталог проекта (имя каталога может отличаться
от приведённого ниже). Потребуются актуальный `db_export.sql` и загруженные
файлы вашей установки: Git их не содержит. Дамп в корне проекта должен быть
доступен для чтения контейнеру PostgreSQL при первом импорте (`chmod 644 db_export.sql`).
Без дампа текущая конфигурация не создаёт полноценную базу с нуля.
После успешного импорта можно вернуть `chmod 600 db_export.sql`.
Перенос файлов в тома описан в [серверной инструкции](SERVER_DEPLOYMENT.md):
для локального запуска используйте функцию
`dc() { docker compose -f docker-compose.local.yml -f docker-compose.dev.yml "$@"; }`.
На уже работающей установке повторный импорт и перенос не нужны.

## Обычный запуск

```bash
cd ~/projects/3d-virtual-world
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml up -d
```

При первом запуске без готового образа добавьте `--build`. Для нашей текущей
установки образ уже существует. Проверка:

```bash
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml ps
curl --fail http://localhost:3002/api/ready
```

Кабинет: http://localhost:3002/ . Админка: http://localhost:3002/admin.html .
Дополнительно подключать `docker-compose.rooms-test.yml` не нужно: dev-конфигурация
уже включает `ROOMS_ENABLED=true` и `APP_MODE=rooms`.

## После изменений

| Изменение | Что делать |
|---|---|
| HTML, CSS, JavaScript браузера, переводы | Сохранить файл и обновить страницу |
| Загруженный сервером JavaScript в src или local-start.js | Node.js автоматически перезапускается |
| SQL-миграции или файлы, которые сервер читает через fs | Перезапустить app вручную |
| Новый модуль, который ещё не подключён через require/import | Подключить его в коде или перезапустить app |
| package.json, package-lock.json, Dockerfile | Пересобрать app |
| Переменные или подключения папок в Compose | Повторить команду up -d |
| Объекты и места через редактор | Сохранить в редакторе |

На первом переходе в dev-режим обновите браузер через Ctrl+Shift+R, чтобы сбросить
старый кеш. В dev-режиме статические файлы отдаются с Cache-Control: no-store.
Автоматической перезагрузки вкладки нет. Перезапуск сервера кратко обрывает
соединения участников: этот режим предназначен для локальной разработки.
Node --watch следит за точкой входа и подключёнными модулями, а не за всеми файлами
проекта. Зависимости берутся из образа.

Перезапуск сервера без сборки:

```bash
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml restart app
```

После изменения зависимостей:

```bash
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml up --build -d app
```

## Где находятся код и модели

`src`, `scripts`, `database` и `public` подключены из рабочей папки к `/app/`
в контейнере. Исходники доступны контейнеру только для чтения; редактируйте их
на компьютере. Это bind mounts: сохранённый файл сразу виден приложению.

Внутри public сохраняются отдельные записываемые Docker-тома для `models`,
`uploads`, `generated`, `uploaded`, `scenes`, `gallery_content`. Они имеют приоритет
над одноимёнными папками проекта. База, `/app/uploads` и `.local-state` также
остаются в прежних томах. Переключение режима не переносит и не заменяет модели.

Мебель загружайте через интерфейс/API сервиса. Простое копирование GLB в локальную
папку public/models не добавит файл в том или запись в библиотеку. Статические
файлы интерфейса и загруженные модели имеют разные способы хранения.

Не используйте `down -v`: эта команда удаляет тома с базой и ресурсами.
Исходный db_export.sql — исторический демонстрационный дамп; он импортируется
только при создании пустого тома PostgreSQL. Он не является чистой начальной базой
нашего сервиса. Обычные перезапуски и пересборки не импортируют его повторно.

## Логи и остановка

```bash
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml logs -f --tail=100 app
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml stop
```

Порт доступен на 127.0.0.1:3002, база не публикуется наружу. Учётные данные
локальной БД задаёт docker-compose.local.yml; локальные секреты авторизации
сохраняются в .local-state. Если старый том выдаёт EACCES для secrets.json:

```bash
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml run --rm --no-deps --user root --entrypoint sh app -c 'chown -R node:node /app/.local-state'
docker compose -f docker-compose.local.yml -f docker-compose.dev.yml restart app
```

## Проверка собранного образа

Чтобы проверить приложение с кодом из образа, без подключённых исходников:

```bash
docker compose -f docker-compose.local.yml -f docker-compose.rooms-test.yml up --build -d
```

Оба режима используют одну локальную базу и модели. После такой проверки
вернитесь к обычной команде dev-запуска. Для VPS эта конфигурация не применяется.
`npm run dev` в старом package.json запускает только Vite и не заменяет этот запуск.

Документация механизмов: [Node.js --watch](https://nodejs.org/docs/latest-v20.x/api/cli.html#--watch),
[Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).

