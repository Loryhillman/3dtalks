# Материалы переговорной v2: видео и импорт PPTX

Статус: этапы 1–5 реализованы, 28 октября 2026. Видео и PPTX выключены флагами; этап 6 (нагрузка/выпуск PPTX) ещё не выполнен.
База: eb45deb3 и последующие записи о развёртывании. V1 остаётся действующей.
Задача: расширить существующие материалы/общий экран, не возвращая зависимости
глобального мира и не создавая вторую медиатеку. План требует согласования
перед реализацией этапов. Новую разработку вести в codex/room-media-v2.

## 1. Решение и границы

Сначала общий видеопоказ, затем импорт PPTX в существующий PDF-показ.
Управляет владелец; зритель меняет только свою громкость/масштаб.
Видео: первая версия MP4 с H.264, yuv420p и AAC либо без звука. Не принимать
любой кодек только потому, что расширение .mp4. Проверять контейнер/потоки,
время, разрешение и ограничения фактическим ffprobe в изолированном worker.
Предлагаемые начальные лимиты: 40 МиБ, 10 минут, 1920×1080, 30 fps,
один видеопоток/не более одного аудиопотока. Не делать автоматический тяжёлый
transcoding: неподдерживаемый файл получает понятную причину отказа.
Потоковая упаковка/faststart при необходимости — отдельная ограниченная
операция без перекодирования, с учётом размера временной копии.
Эти лимиты — начальный контракт для проверки, не измеренная ёмкость VPS.

PPTX: 20 МиБ входа, до 100 слайдов, результат PDF до 20 МиБ; PPT/PPTM,
пароли и повреждённые архивы не поддерживать. До запуска конвертера проверять
OOXML/ZIP: число записей, суммарный распакованный объём (начально 200 МиБ),
compression ratio, traversal, дубликаты/зашифрованные записи и тип содержимого.
Не распаковывать пользовательские пути в файловую систему. Архивные метаданные
не считать достаточным контролем: ограничить чтение фактически распакованных
данных. Макросы, OLE/внешние ресурсы не исполнять и не загружать.
Показать перед загрузкой: «Преобразуем в PDF. Анимации, переходы и встроенные
видео не сохраняются; шрифты и вёрстка могут отличаться». После обработки —
предпросмотр результата, только затем владелец начинает общий показ.
Внешние URL, iframe/YouTube, live-streaming и делегирование не входят в v2.

## 2. Что сохраняем и что переносим

- roomMedia: reserve/upload/cancel/delete, авторизация, lease, квоты,
  идемпотентность и уборка файлов остаются единым жизненным циклом.
- roomPresentation/Store/Protocol: owner/claim/roomScope, epoch/revision,
  receipts и разрешение текущего материала расширяются для видео.
- roomScreenRenderer: один физический экран и его canvas/texture. Видео
  рисуется в этот canvas с сохранением пропорций; увеличенный просмотр получает
  те же кадры, без второго video/audio и независимой временной шкалы.
- Из galleryRenderer/world переносить только проверенные приёмы video element,
  playsInline и освобождения ресурсов, адаптируя к жизненному циклу комнаты.
  Не подключать GalleryRenderer, _mediaMeshes, старые API/автозапуск по расстоянию.
- Новый roomVideoPlayback.js владеет одним HTMLVideoElement, кадрами,
  синхронизацией и локальным звуком. roomPresentation остаётся оркестратором.
- roomMediaProcessor отделяет диспетчеризацию от специализированных задач.
  Общими оставить отмену/очередь/очистку, но не пытаться одним Node heap-флагом
  ограничить LibreOffice/FFmpeg и всё дерево их дочерних процессов.
- PPTX хранить как source_kind=pptx с подготовленным kind=pdf. Не создавать
  второй PDF-viewer и дополнительный тип общего слайдового протокола.
  Сырой PPTX после успешной обработки удалять с освобождением его charge;
  повторная обработка требует повторной загрузки.

## 3. Серверное состояние видео

Расширить состояние типизированно: slides или video. Для video хранить
assetId, paused/playing, anchorPositionSeconds и anchorServerTime;
вычислять текущее время = anchor + прошедшее время сервера, ограничивая duration.
Play/pause/seek принимаются только от владельца с requestId, expectedEpoch,
expectedRevision; все аргументы конечные, позиция в пределах duration.
Сигнатура receipt включает параметры новых команд. Дубликат не запускает
повторный seek/play; старый запрос возвращает конфликт и актуальное состояние.
Бинарное видео никогда не идёт через WebSocket.

Синхронизация часов: адресный ping/pong с nonce и серверными timestamp,
оценка смещения по нескольким измерениям с малым RTT, без доверия клиентскому
времени при сохранении состояния. На клиенте использовать performance clock;
периодически обновлять оценку. Пересинхронизация после visibilitychange,
reconnect, ready/seeked и смены материала. Ограниченный heartbeat состояния
без постоянного увеличения revision и без SQL-записи на каждый кадр.
Начальные пороги коррекции: <200 мс не трогать, 200–750 мс мягко менять
playbackRate в пределах 0.95–1.05, >750 мс — seek. Уточнить измерениями.
Если клиент буферизует, он догоняет общий таймлайн, а не останавливает всю встречу.
После рестарта процесса видео восстанавливается в паузе на вычисленной позиции;
старые grant/session инвалидируются. Отдельно проверить clock skew и end boundary.

Слайдовые команды и DTO V1 сохранить совместимыми. Возможности клиента
объявляются явно; старый клиент получает понятное требование обновить страницу
при видео, а не невалидный для его strict validator state. До реализации
зафиксировать точный wire-контракт и сценарий смешанных версий клиента/сервера.
Презентационное расширение не меняет голосовой транспорт и посадку.

## 4. Приватная выдача видео

Существующий fetch с Authorization + X-Room-Session подходит PDF/изображениям.
Обычный video.src не умеет добавлять эти заголовки. Не открывать публичную
папку, не класть JWT/room-session в URL и не скачивать весь файл в Blob.

Добавить authenticated grant endpoint: JWT + текущая room-session проверяются
существующей политикой, выдаётся случайный короткий opaque grant в cookie:
HttpOnly, Secure в production, SameSite=Strict, ограниченный Path конкретной
комнаты/материала. Без Domain; no-store; только same-origin. TTL начально
60 секунд с обновлением до истечения через authenticated fetch. Grant привязан
к пользователю, connectionId, roomId, assetId, epoch и текущему показу;
не равен основному токену и не записывается в логи. Владелец получает отдельный
аналогичный scope для личного preview, без прав зрителя на всю библиотеку.
Параллельные комнаты/вкладки проверить на коллизии cookie Path и grant rotation.

Каждый HEAD/GET/Range повторно проверяет grant и действующий claim/сокет.
При stop/end/delete/смене материала/disconnect grant отзывается, активные
потоки прерываются через действующий lease-механизм. Уже переданные браузеру
байты отозвать невозможно — это ограничение зафиксировать, не обещать DRM.
Поддержать один byte range: 200/206/416, Content-Range/Length/Accept-Ranges,
HEAD, корректное завершение запроса, запрет multipart ranges в первой версии.
Разбор Range ограничен по длине и числам; отдача потоковая с backpressure,
без SQL-транзакции на время передачи. Сохранить безопасное открытие файлов.
Лимиты читателей/частоты учитывать для прерываний и повторных range-запросов;
старый лимит 120 секунд пересмотреть для длинного воспроизведения.

## 5. Worker, память и квоты

PPTX преобразовывается закреплённой версией LibreOffice Impress в PDF,
после чего результат проходит существующую проверку PDF.js и её лимиты.
Отдельный worker-контейнер без сети, root, Docker socket, секретов и БД;
read-only rootfs, ограниченная рабочая директория, pids/CPU/memory/time/disk,
уникальные каталог и профиль LibreOffice на задание. Headless сам по себе
не является изоляцией или гарантией запрета макросов/внешних ссылок.
Настройку macro security закрепить образом и проверять вредоносными фикстурами.
Приложение не получает доступ к Docker API: worker забирает ограниченное
задание из выделенного spool с атомарной публикацией manifest/result, lease,
непредсказуемым ID и отменой. Пути/имена не берутся из пользовательских полей.
Один job одновременно; отдельные лимиты для probe и офисной конвертации.
Частичные результаты и дерево процессов удаляются при отмене/тайм-ауте.

Предварительный бюджет конвертера: 384 МиБ, 120 секунд, ограниченный spool;
его пригодность должна быть доказана на целевом сервере. Текущий VPS имеет
1 ГБ RAM, app limit=512 МиБ и PostgreSQL limit=256 МиБ. Просто добавить
конвертер в этот профиль нельзя: агрегированные лимиты не помещаются с ОС.
До включения PPTX провести замер максимальной одновременной нагрузки с
комнатой/загрузкой/конвертацией. Если не проходит — PPTX остаётся выключенным
флагом с предложением PDF до увеличения RAM или размещения worker отдельно.
Не менять лимиты рабочего приложения наугад и не отправлять материалы
сторонним конвертерам без отдельного решения пользователя.

Квоты учитывать по пиковому диску: вход + подготовленная копия/результат +
ограниченные временные данные. Сохранять charge до физического удаления и
закрытия читателей. Прежние 100 МиБ владельца/1 ГиБ сервера автоматически
не увеличивать; UI показывает оставшееся место и причину отказа. Новые
колонки/ограничения мигрировать аддитивно, без изменения старых файлов.

## 6. Интерфейс и lifecycle

Существующие материалы получают иконку/тип/длительность видео, processing,
ready/failed и конкретные ошибки. Управление видео в существующем окне показа:
воспроизведение/пауза, шкала времени и остановить показ. Не плодить плавающие
панели; токены, 44 px, фокус/Tab/Escape, RU/EN/zh-CN и текущий responsive.
Зритель видит время/буферизацию, локальные громкость/mute. Если браузер
блокирует play со звуком — доступная кнопка «Включить видео и звук»;
после жеста пользователя догнать общий таймлайн. Не показывать «идёт показ»,
если локальный play завершился отказом. Окончание видео — общий конечный
кадр/paused; loop только отдельной будущей функцией. Громкость видео не
подменяет микрофон и не анимирует рот аватара.

Использовать requestVideoFrameCallback с fallback на ограниченный rAF;
в фоне останавливать рисование, после возврата догонять общее время.
Закрытие увеличенного просмотра не останавливает общий показ. Выход/смена
материала отменяют fetch, grant renewal, clock sync, события, кадры, очищают
video.src/load, источники звука и связанные ресурсы. Общая screen texture
принадлежит RoomScene и освобождается один раз, а не каждым видеоплеером.

## 7. Последовательность законченных этапов

1. Зафиксировать wire/SQL/media-контракт, миграции и негативные тесты;
   сохранить V1 и подготовить feature flags для независимого включения.
2. Защищённая загрузка/проверка MP4, grant/Range и квоты; без UI общего видео.
3. Общая временная шкала, клиентский playback и встроенный экран/preview.
4. Проверка двух браузеров/комнат, reconnect/restart/фон/автозапуск, нагрузка;
   только после gate — отдельное поручение на выпуск видео.
5. Изолированный PPTX worker, импорт в существующий PDF и предпросмотр.
6. Регрессия/память/миграции/backup/ручная приёмка; отдельное решение о
   доступности PPTX на VPS. После каждого этапа проверки, diff и английский
   commit; следующий этап согласуется. Push/deployment отдельно.

Матрица приёмки: реальная PostgreSQL/HTTP/JWT/WS и Chromium; владелец/зритель/
посторонний; две комнаты и параллельные вкладки; seek races/replays; late join;
истечение/revoke grant и активные читатели; диапазоны вне файла; повреждённые
MP4/ZIP, codec mismatch, zip bomb, fonts, slide overflow, timeout/OOM/cancel;
старые PDF/изображения и комнаты; pending responses после выхода; mic/mouth
не запускаются от видео. Протокольные fixtures не заменяют live-проверку.

## 8. Источники и проверенные ограничения

Репозиторий: roomMedia(.Limits/Processor), roomPresentation(.Store/Protocol),
roomMediaContent, roomScreenRenderer, galleryRenderer.createVideoMaterial,
видеорендер world.js (механизм VideoTexture), compose.production.yaml.
Старые VideoTexture полезны как reference, но активный canvas-экран и его
preview уже используют общий источник; отдельную вторую текстуру не добавлять.

- LibreOffice CLI: https://help.libreoffice.org/latest/en-GB/text/shared/guide/start_parameters.html
- HTTP Range: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests
- Autoplay: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay

Документация подтверждает механизмы конвертации/Range/autoplay, но не
производительность нашего VPS, точность PPTX-вёрстки или выбранные пороги
синхронизации. Их проверяют этапы реализации.


## 9. Этап 1: зафиксированный контракт и результат

Ветка codex/room-media-v2. Дополнения изолированы от работающего V1:

- roomMediaContract.js: общие bounds и проверка метаданных H.264/yuv420p/
  AAC-or-silent; отдельные флаги ROOM_VIDEO_UPLOAD_ENABLED,
  ROOM_VIDEO_PLAYBACK_ENABLED, ROOM_PPTX_IMPORT_ENABLED. Значения по умолчанию
  false, включение только строкой true; playback требует upload.
  Пока это контракт конфигурации: runtime/маршруты его не подключают,
  установка флагов сама по себе не включает незавершённую функцию.
- roomPresentationProtocolV2.js: отдельный opt-in, повторно использует V1
  slides/UUID/revision и roomMediaContract, без дублирования V1-протокола.
  Новый модуль пока не загружается страницей и не принимает серверные команды.
- add_room_media_v2.sql: обязательная повторяемая startup-миграция.
  Форматы/размеры/MIME расширены именованными CHECK, добавлены nullable
  source_format и video_* поля. source_format=pptx допускается только для
  подготовленного PDF. У video нет page_count; ready требует полных
  ограниченных метаданных, MIME/размер/checksum и согласованного charge.
  Старые состояния сохранены. В presentation_state добавлены paused/playing,
  playback_position_ms, playback_anchor_at; пустой показ всегда paused/0/null.
  SQL проверяет форму/общие границы. Совпадение вида/длительности выбранного
  asset и состояния проверяет сервис под блокировками на этапе 3; SQL CHECK
  не обращается к другой таблице и не заменяет авторизацию.

### Wire V2 (реализация транспорта — этап 3)

После существующего допуска/сессии клиент отправляет адресное
ROOM_PRESENTATION_CAPABILITIES {protocolVersion:2}. Сервер отвечает
ROOM_PRESENTATION_CAPABILITIES_RESULT {protocolVersion:2,features:{videoUpload,
videoPlayback,pptxImport}}. До ответа клиент остаётся V1; новое соединение
обязано пройти согласование заново. Флаги сообщают доступность функции,
а не право пользователя управлять комнатой.

В согласованном V2 ROOM_PRESENTATION_COMMAND имеет прежние requestId,
expectedEpoch/expectedRevision и дополнительный protocolVersion:2. Сохраняются
show/page/stop, добавляются play/pause без позиции и seek с целым positionMs.
Позиция ограничена 0..600000 и затем длительностью asset в сервисе.
Receipt signature включает protocolVersion, epoch/revision, type и все
параметры команды (assetId/pageIndex/positionMs); повтор requestId с другой
позицией является REQUEST_ID_REUSED, а не повторным выполнением.

ROOM_PRESENTATION_STATE V2: protocolVersion:2 плюс прежние roomId/epoch/
revision, asset, pageIndex и playback. Для slides playback=null. Для video
asset={id,name,kind:video,durationMs,width,height}, pageIndex=0;
playback={status,positionMs,anchorServerTimeMs}. В paused anchor=null, в playing
anchor — конечное целое Unix-время в миллисекундах, position<duration.
Законченный ролик представлен paused на duration. Revision — десятичная
строка bigint, пользовательских URL/токенов в state нет.

Адресный ROOM_PRESENTATION_CLOCK {protocolVersion:2,nonce:uuid} получает
ROOM_PRESENTATION_CLOCK_RESULT {protocolVersion:2,nonce,receivedAtMs,sentAtMs}.
Сервер ставит оба timestamp, bounded nonce обеспечивает сопоставление ответа;
частоту/число ожидающих запросов ограничивает последующий транспортный этап.

V1 не получает V2 envelope. Для видео legacyState возвращает валидный V1
пустой asset, очищая прежний слайд; отсутствие видео объясняется через
существующее текстовое уведомление комнаты о необходимости обновить вкладку.
Это понадобится потому, что старый meetingSocket игнорирует новые типы событий.
Для slides проекция сохраняет прежние поля без изменений. Старый клиент не
получает video grant; его play/seek/попытка показать video отклоняется.
Эти правила маршрутизации/уведомления зафиксированы, но ещё не реализованы.

### Проверки этапа

PASS: test-room-media-v2-contract.js — CJS и browser exports, версии,
legacy projection, неизвестные/секретные поля, UUID/bigint, отрицательные/
дробные/NaN/Infinity позиции и время, duration/codec/dimensions/fps, caps/clock
и конфигурация по умолчанию. V1-контракт также прошёл прежнюю проверку.

PASS на отдельной временной PostgreSQL 18: check-room-media-v2-postgres.js
(миграция повторно, сохранность старых assets/rooms/state/receipts, ошибочные
ready/metadata/timeline, закрытая загрузка новых форматов), check-room-media.js
(реальные JWT/HTTP/Multer/worker/квоты/очистка), check-room-presentation.js
(реальные SQL/HTTP/WS, шесть зрителей/две комнаты/роли/replay/revoke),
check-room-startup-postgres.js (канонический startup со всеми миграциями дважды).
Временная тестовая БД удалена; рабочая локальная БД не мигрировалась.

PASS: test-room-presentation-browser.js — прежние слайды/изображения,
preview/действия владельца, языки/размеры/фокус и lifecycle с тестовыми HTTP/WS.
Проверены JS syntax и diff. Новые видеофайлы, Range/grants, worker/PPTX,
синхронизация таймлайна и нагрузка VPS ещё не реализованы и не проверены.
Новые Docker-сервисы не запускались, VPS/deployment/GitHub push не выполнялись.
Следующий согласуемый этап — 2: защищённая загрузка/проверка MP4 и Range/grant.


## 10. Этап 2: загрузка MP4 и приватная выдача владельцу

Реализован серверный фундамент видео без интерфейса общего показа.
ROOM_VIDEO_UPLOAD_ENABLED по умолчанию false; при true существующие
reserve/upload/cancel/delete принимают kind=video. Флаг проверяется при
reserve/begin/complete и при выдаче preview grant. ROOM_VIDEO_PLAYBACK_ENABLED
и ROOM_PPTX_IMPORT_ENABLED пока не подключены к runtime. Compose передаёт
три флага с defaults=false, .env.example содержит безопасные значения.
Не включать их на рабочем сервере до завершения UI/синхронизации и release gate.

### Обработка

roomMedia использует тот же жизненный цикл и бюджет, без второго каталога.
Видео сохраняется в приватном room-media по UUID с суффиксом .mp4.
Входные байты проверяются по фактическому содержимому, не MIME/имени загрузки.
В roomVideoProbe.cjs проверяются top-level MP4 boxes, ftyp/бренды/moov/mdat,
границы атомов; далее ffprobe проходит пакеты, проверяет потоки/метаданные.
Допускаются H.264 avc1/avc3 + yuv420p, AAC либо отсутствие аудио, до 40 МиБ,
10 минут, 1920×1080 и 30 fps. Аудио — 1–2 канала, 8–48 кГц. В этой версии
отклоняются fragmented MP4, ненулевой rotation/start offset и посторонние
потоки. Есть отдельный отказ UNSUPPORTED_VIDEO. Повреждение контейнера —
INVALID_VIDEO; отсутствующий ffprobe — PROCESSOR_UNAVAILABLE/503.

Исходный проверенный файл переименовывается без перекодирования/копирования.
Moov в конце допустим: нативный браузер использует Range; проверено настоящим
роликом с такой структурой. Поэтому charge видео равен входному объёму;
80 МиБ из SQL — верхняя допустимая резервная граница, а не обязательная
двойная резервация для этой реализации. На успехе сохраняются duration,
width/height/fps, codec/pixel format/audio codec, checksum и размер.
Проверка пакетов не является полным декодированием каждого кадра: ошибки
воспроизведения ещё должен обрабатывать клиент этапа 3.

Используется существующая очередь одного media worker (4 ожидающих), общий
тайм-аут 10 секунд и heap 96 МиБ. Супервизор теперь считает суммарный RSS
дочерних процессов, порог 256 МиБ с опросом 40 мс; это мониторинг, не жёсткий
cgroup-предел. Ограничено число отслеживаемых процессов. В Linux worker
создаётся как отдельная process group; отмена/тайм-аут/память/close убивают
также нативные дочерние процессы. Завершение worker очищает потомков,
IPC disconnect при смерти приложения также завершает его группу.
FFprobe получает ограниченный JSON output, threads=1, max_alloc=64 МиБ,
protocol_whitelist=file, format_whitelist=mov, enable_drefs=0 и
use_absolute_path=0. Передача секретов через env отсутствует. Эти параметры
ограничивают штатное поведение парсера, но не заменяют OS sandbox.

Dockerfile получил ffmpeg (включает ffprobe). Изменение требует настоящей
пересборки образа, прежний COPY-overlay для выпуска применять нельзя.
Сборка Node 20 Alpine/пакетный FFmpeg и нагрузка VPS в этом этапе не запускались.

### API владельца

POST /api/my/rooms/:id/materials/:assetId/video/grant:
существующий JWT владельца, тело {} или без тела. На успехе возвращаются
только success/expiresInMs. Случайный token передаётся через Set-Cookie
room_video, HttpOnly, SameSite=Strict, Secure в production, Path ровно до
content конкретной комнаты и asset. Domain не задаётся; token не попадает
в URL/JSON/logs. По HTTPS Secure обязателен; на localhost вне production
cookie может быть без Secure. Действует 60 секунд; authenticated renewal
того же owner/room/asset продлевает grant без прерывания текущего потока.

GET/HEAD .../video/content работают по этой cookie, без Authorization на
video.src. Grant хранится в памяти процесса (не переживает рестарт),
проверяется до и после асинхронной SQL-авторизации; каждый запрос заново
проверяет владельца/комнату/ready asset и получает существующий reader lease.
Owner preview не требует места в комнате. Это НЕ grant зрителя; доступ
участникам с привязкой к socket/claim/current show будет подключён в этапе 3.
Один grant может использоваться несколькими вкладками того же владельца
для того же asset; разные комнаты/материалы имеют разные cookie paths.

Максимум 1000 grants на процесс / 20 на пользователя, renewal до 30/мин,
чтение до 120 запросов/мин на grant; текущие ограничения 8 readers процесса /
2 пользователя сохраняются. Максимальный video reader — 630 секунд, каждый
request завершается/освобождает lease отдельно. Grant expiry проверяется также
периодически и прерывает открытые readers. Удаление asset, abortRoom и close
отзывают grants и прерывают потоки. При закрытии preview без отдельного
серверного события grant живёт до expiry; клиентское продление/cleanup — этап 3.
Уже полученные/закешированные самим браузером байты отозвать невозможно.

Поддержаны полный GET 200, HEAD без тела, одиночные bytes ranges (обычные,
open-ended, suffix) с 206 и Content-Range, неверные/множественные ranges —
416 с размером. HEAD игнорирует Range. Числа/длина ограничены, ответы no-store,
nosniff/CORP same-origin, выдача потоковая вне SQL-транзакции. Безопасное
открытие файла O_NOFOLLOW и освобождение lease общие с прежней выдачей.

V1-список материалов скрывает video; owner API с ?protocolVersion=2 получает
video DTO с метаданными, когда upload-флаг включён. Общая использованная квота
при этом учитывает и скрытое видео. V1 show явно допускает только pdf/image;
подготовленное видео не может попасть в старый strict state/renderer.
Клиентский интерфейс в этапе 2 не менялся.

### Проверки этапа

PASS: test-room-video-grants.js — ranges/overflow, scope/expiry, renewal без
обрыва потока, revoke/rate и гонка отзыва во время авторизации.
PASS: test-room-video-processor.js — реальные ffmpeg-фикстуры H.264/AAC и
silent, checksum/размер, tail-moov, неподдерживаемые codec/fps, повреждения,
суммарный RSS и завершение настоящего нативного потомка.
PASS: прежний test-room-media-processor.js (PDF/изображения/тайм-аут/память).

PASS на отдельной временной PostgreSQL 18:
ROOM_VIDEO_BROWSER_CHECK=1 node scripts/check-room-video.js — реальные
HTTP/JWT/Multer/ffprobe, ownership/gate/replay/размер, cookie без token в JSON,
HEAD/full/suffix/open-range/416, чужая комната/дубликат cookie, expiry/delete
revoke, удержание квоты читателем и освобождение после закрытия. Chromium
загрузил H.264/AAC через нативный video.src с HttpOnly-cookie, декодировал,
воспроизвёл и перемотал ролик. Это owner preview, не общий синхронный показ.

Также PASS: check-room-media-v2-postgres.js, прежние check-room-media.js и
check-room-presentation.js (реальные SQL/HTTP/WS), test-room-presentation-browser.js,
контракт V2, syntax/diff и Compose config --quiet. В PostgreSQL регрессии
добавлен запрет V1 show для ready video. Медиатесты/worker выполнены на
Node 22.22.2 и FFmpeg 4.4.2 в WSL; production Node 20 Alpine требует отдельного
gate. Временные schema/БД/файлы удалены. Рабочая БД и VPS не изменены;
новые контейнеры не запускались, GitHub push/deployment не выполнялись.

Источники параметров FFmpeg:
https://ffmpeg.org/ffprobe.html и
https://github.com/FFmpeg/FFmpeg/blob/master/doc/demuxers.texi
(enable_drefs/use_absolute_path). Параметры не доказывают абсолютную изоляцию
нативного парсера или производительность целевого VPS.

Следующий согласуемый этап 3 — owner controls/загрузка в UI, переговорная
video timeline, grant зрителя и единый playback на 3D-экране/увеличенном просмотре.


## 11. Этап 3: общий видеопоказ и интерфейс

Реализован в codex/room-media-v2. Используются прежние roomMedia,
roomPresentation/Store, screen canvas и native dialogs. Отдельная медиатека,
старые world/gallery модули и новый голосовой транспорт не добавлялись.
ROOM_VIDEO_UPLOAD_ENABLED и ROOM_VIDEO_PLAYBACK_ENABLED теперь подключены
к runtime; оба по умолчанию false. PPTX остаётся отдельным следующим этапом.

### Совместимость и сервер

Уточнение handshake к разделу 9: новый сервер сначала посылает адресный
ROOM_PRESENTATION_AVAILABLE {protocolVersion:2}. Только получив это объявление,
новый клиент отправляет CAPABILITIES и получает CAPABILITIES_RESULT.
Поэтому новый клиент не шлёт неизвестные команды старому серверу и остаётся
на V1; старый клиент игнорирует новое объявление. После переподключения
согласование повторяется. Без ответа cap-ожидание ограничено пятью секундами;
кнопка обновления состояния позволяет повторить согласование.

Server Store возвращает канонический V2 для video и прежний V1 для slides.
При synchronize, broadcast и RPC result wireState строится индивидуально
для connectionId. Слайды V2 переиспользуют V1-поля с playback=null;
V1-зрителю во время видео приходит пустой экран и текстовое уведомление
об обновлении вкладки. Никому не передаётся чужой token/grant.

Play/pause/seek, show/stop/page проходят прежние owner/claim/room/epoch/revision
и SQL locks. Новые параметры входят в receipt signature; повтор не перематывает
ролик заново, конкурирующие команды получают конфликт. Seek проверяется
также по длительности выбранного файла. Show video ставит на паузу в начале;
Play в конце запускает ролик заново. Стоп/подтверждённое удаление активного
материала/end/delete сбрасывают timeline атомарно. При startup приложение
ожидает SQL-восстановление: playing переводится в paused на ограниченной
вычисленной позиции, без самопроизвольного звука и без переполнения int даже
при очень старой дате anchor. Новая SQL-миграция сверх этапа 1 не требуется.

CLOCK адресный, имеет отдельный ограниченный socket bucket (1/с, burst 4),
общие packet/bytes/connection limits сохраняются. Это важно: первоначальные
три clock samples не расходуют owner command allowance 2/с, burst 6.
У clock нет SQL/journal-записи. Timeline не обновляется в БД по кадрам;
вместо heartbeat revision используются надёжные WS-команды, clock samples
и явная сверка при восстановлении соединения/возврате вкладки.

### Приватный viewer stream

POST /api/rooms/:slug/presentation/materials/:assetId/video/grant требует JWT,
X-Room-Session, согласованный V2, включённый playback и текущий показ этого
asset. Возвращает contentPath с connectionId (не bearer-secret) и expiresInMs;
секрет выдаётся только в HttpOnly/Secure/SameSite=Strict cookie, Path ровно
к этому connection/material content. GET/HEAD .../video/:viewId/content
используют ту же ограниченную Range-выдачу этапа 2.

Расширен прежний roomVideoGrants: scopeKey учитывает connection и slug;
owner-preview grant остаётся отдельным scope. При каждом запросе проверяются
живой socket, session, user, claim/expiry, epoch, room и текущий asset в SQL.
Renewal каждые 20 секунд обновляет grant без обрыва потока. Disconnect/replaced,
смена материала/stop/end отзывают grant и readers. На reconnect URL/cookie
другие, прежний URL возвращает 403. Локальные source/таймеры/fetch освобождаются
при disconnect/detach/stop/смене материала и закрытии private preview.

### Клиент и дизайн

- RoomVideoPlayback владеет одним native video/audio и callback кадров;
  рисует в прежний screen canvas с сохранением пропорций. RoomScene сохраняет
  владение canvas texture/geometry; второй VideoTexture не создаётся.
- Увеличенный viewer получает те же кадры. Те же volume/enable элементы
  временно перемещаются в dialog и возвращаются, без второго decoder/audio.
  Tab включает range input, Escape/return focus и текущие zoom/pan сохраняются.
- RoomVideoClock измеряет минимум RTT, работает через performance.now(),
  ограничивает pending samples и чистит timers. После начала показа/seek/
  reconnect player догоняет timeline; >750 мс — seek, 200–750 мс — rate
  0.95–1.05, меньше — не корректируется. В скрытой вкладке рисование отменяется,
  звук может продолжаться; при возврате повторяется grant/sync.
- Владелец в прежнем dialog получает Play/Pause, доступный range и время.
  Зритель управляет только своей громкостью; предпочтение сохраняется локально.
  Заблокированный autoplay показывает явную кнопку разрешения; отказ/буферизация
  имеют отдельный статус. Видео не вызывает voice/mouth events.
- RoomMaterials определяет возможности через защищённый owner capabilities API,
  предлагает MP4 при upload-флаге, показывает тип и native private preview.
  Новые данные берутся через protocolVersion=2, старые списки/рендеры не ломаются.
- RU/EN/zh-CN, прежние tokens/UI-button, 44 px targets, focus и существующие
  dialog layouts. Глобальная структура панелей и App Shell не менялись.

Обнаруженный интеграционной проверкой дефект late join исправлен: V1-проекция
и V2-video могут иметь одинаковую revision. Дедупликация теперь учитывает
также protocolVersion/assetId, поэтому первое video state не пропускается.

### Проверки и оставшиеся gate

PASS: test-room-video-timeline.js — clamping/pause/skew, best RTT, unsolicited
clock replies, bounded pending и освобождение timers; test-room-media-v2-contract.js,
test-room-video-grants.js, test-room-socket-policy.js (включая отдельный bucket).

PASS на изолированной PostgreSQL 18: check-room-video-presentation.js с
настоящими HTTP/JWT/WS/Multer/ffprobe и Chromium. Владелец загрузил MP4 через UI,
посмотрел private preview и закрыл его с очисткой source. Два браузера:
show/play/pause/seek, имитация NotAllowedError и enable-жест, независимая
громкость, pixels обычного/увеличенного canvas, один активный decoder для
общего экрана; поздний третий вход, reconnect с новым scope и 403 старого URL,
stop cleanup. Также проверены V1 projection/уведомление, clock, соседняя комната,
запрет зрителю командовать, SQL races/replay/seek bounds, restart pause,
подтверждённое удаление активного видео и завершение комнаты с playing state.
Временные БД/schema/файлы удалены; рабочая БД не мигрировалась.

PASS: прежние check-room-video.js, check-room-media-v2-postgres.js,
check-room-media.js, check-room-presentation.js; браузерные presentation/materials/
screen и полный /play --builtin-v3 --human-avatars (реальные GLB, голос/рот,
камера/сцена/выход, тестовые API). HUD 3 языка/9 размеров и socket regression
также прошли. Просмотрены mobile/desktop скриншоты owner dialog.

Новый общий видеосценарий использует настоящие серверные транспорты/БД и
отгружаемые UI/Three screen canvas, но тестовая оболочка не загружает весь
GLB-офис. Полная GLB-проверка выполнялась отдельно без включённого видео.
Это не проверка шести одновременно декодирующих зрителей, медленной сети,
реальных мобильных устройств/Safari/axe/полного 200% browser zoom.
Node 22.22.2/FFmpeg 4.4.2 WSL; Node 20 Alpine/production HTTPS/нагрузка и
совмещение с полной GLB-комнатой — обязательные gate этапа 4 перед выпуском.
Docker/VPS не запускались и не разворачивались, GitHub push не выполнялся.

Следующий согласуемый этап — 4: общая регрессия, нагрузка и подготовка выпуска
видео. Сам выпуск требует отдельного поручения; PPTX — этапы 5–6.


## 12. Этап 4: проверка видео перед выпуском (27 октября 2026)

### Окружение и воспроизведение проверок

Собран настоящий Dockerfile: Node 20.20.2 Alpine, FFmpeg/ffprobe 8.0.1.
`check-room-video-docker.cjs` создаёт собственные network/PostgreSQL 18/app,
не публикует порты, не подключает рабочую БД или Compose-тома. Зависимости и
runtime-код берутся из образа, актуальные тестовые scripts копируются в
одноразовый контейнер. App: 512 МиБ/768 МиБ со swap/256 pids; PostgreSQL:
256 МиБ/128 pids, production shared_buffers/max_connections/work_mem.
В finally удаляются только созданные контейнеры, их анонимные тома и network.

```sh
docker build -t 3dtalks:video-release-gate .
node scripts/check-room-video-docker.cjs
# Только отдельная временная тестовая БД, не рабочая:
ROOM_TEST_DATABASE_URL=postgresql://... ROOM_VIDEO_RELEASE_CHECK=1 node scripts/check-room-video-presentation.js
node scripts/test-meeting-startup-browser.js --builtin-v3 --human-avatars --video
```

PASS в целевом контейнере: contracts/timeline/grants/processor, повторяемая
V2-миграция, canonical init.sql/startup со всеми миграциями дважды,
upload/HEAD/Range/cookie/квоты, прежние PDF/image media и общий
PDF-показ, V2 SQL/HTTP/JWT/WS команды/изоляция/replay/restart/lifecycle.
В Alpine браузерный helper явно отключается ROOM_VIDEO_BROWSER_CHECK=0;
native Chromium запускается отдельно в glibc WSL. Поэтому серверные лимиты
памяти не включают браузерные декодеры. Это функциональная нагрузочная
проверка одного процесса, не доказательство ёмкости VPS для любого файла.
Финальный kernel memory.peak app-контейнера — 80.6 МиБ; PostgreSQL и
браузеры в этот показатель не входят. Лимит 512 МиБ, OOM не было.
Сообщение cleanup EISDIR ожидаемо: прежний media-тест специально создаёт
каталог вместо файла, проверяет сохранение квоты и повтор очистки.

### Браузер, сеть и полная сцена

PASS: шесть отдельных browser contexts с шестью native H264/AAC плеерами,
1080p/24 fps, 90 секунд, faststart; один decoder на зрителя, без 429/5xx
медиаответов. Низкосложная синяя фикстура проверяет разрешение/декодирование,
но не представляет худший битрейт/движение. Позднему зрителю через CDP заданы
600 мс latency и 32 КиБ/с download/upload с отключённым cache; после
восстановления сети и visibility плеер догоняет остальных. Проверка visibility
вручную меняет document.hidden/событие и не моделирует сон ОС/заморозку вкладки.
Позиции сравниваются с поправкой на время каждого замера, разница <900 мс.
Проверены прежние play/pause/seek, reconnect/старый URL 403, stop cleanup,
локальная громкость и запрет shared-команд зрителя. В headless Chromium
разрешён autoplay; NotAllowedError/кнопка разрешения проверяются явной
имитацией отказа. Это не проверка autoplay-политик реальных устройств.

PASS по HTTPS/WSS с NODE_ENV=production: JWT/нативные cookie/Range, весь
шестиклиентский сценарий. Для проверки использован временный self-signed
localhost certificate: Node доверяет ему через NODE_EXTRA_CA_CERTS, Chromium
в тестовом context разрешает его через ignoreHTTPSErrors. Ключ/сертификат и
БД удалены. Это проверка защищённого транспорта/Secure-cookie, не публичного
сертификата, конфигурации Nginx или сетевого канала рабочего VPS.
Для повторения TLS: ROOM_VIDEO_TLS_KEY/ROOM_VIDEO_TLS_CERT — пути временных
ключа/сертификата; NODE_EXTRA_CA_CERTS — тот же сертификат, NODE_ENV=production.

PASS: настоящая страница /play, стандартные офис/стол/стулья GLB и шесть
человеческих аватаров, встроенный screen canvas/texture и render loop.
Новый --video helper подаёт явные тестовые HTTP/session/state и настоящий
1080p MP4: pixels экрана и увеличенного canvas, один decoder, pause/seek,
при выходе очищены src/кадры и ровно один dispose screen texture. Это один
полный 3D-клиент; шесть полных GLB-клиентов одновременно не проверялись.
SQL/JWT/WS авторизация проверяется отдельным реальным сценарием выше.
Прежние presentation/materials Chromium (3 языка/7 viewport) и реальная
socket-policy регрессия тоже прошли.

### Исправление и границы выпуска

Во время проверки обнаружена гонка /proc: дочерний FFmpeg может завершиться
между чтениями status/children, Linux возвращает ESRCH вместо ENOENT.
Monitor теперь допускает оба признака исчезновения процесса. EACCES и другие
ошибки остаются fail-closed; отдельный тест воспроизводит оба случая.
Лимиты RSS/timeout/очереди и убийство всей группы не ослаблены.

Оба видеофлага остаются false по умолчанию. Рабочая локальная БД не
мигрировалась, рабочий сервис не перезапускался, VPS/push не выполнялись.
Перед включением: копия БД/файлов, штатный startup с аддитивной V2-миграцией,
оба video-флага, HTTPS/Secure-cookie через реальный proxy и личная проверка
двух устройств с реальным звуком. Откат UI-флагами без отката схемы; перед
выключением остановить активные видеопоказы. Схему/готовые файлы не удалять.
Safari/реальные мобильные устройства/плохой Wi-Fi/максимальный битрейт,
полный accessibility-аудит и ресурсы рабочего VPS не подтверждены.
PPTX не реализован: следующий отдельный согласуемый этап 5 — защищённый
OOXML import/converter. Прежние PDF/изображения сохраняются.


## 13. Этап 5: PPTX → PDF (28 октября 2026)

### Контракт и повторное использование

`reserve` принимает прежний kind=pdf и дополнительный sourceFormat=pptx.
В SQL сохраняются kind=pdf/source_format=pptx: новые тип показа, медиатека и
PDF viewer не создаются. Используется уже выпущенная add_room_media_v2.sql,
новой миграции нет. Прежние запросы PDF/image/video не меняются.
DTO библиотеки содержит sourceFormat только для импорта. RequestId сверяет
также исходный формат, исключая повтор того же ID как обычного PDF.

До 20 МиБ входа, 100 слайдов, 20 МиБ подготовленного PDF. Один importer
одновременно на процесс; общие ограничения transfers/SQL owner/server quotas
сохраняются. Во время импорта резервируется 2×вход + 2×максимальный PDF,
то есть до 80 МиБ прежней квоты владельца 100 МиБ. Это покрывает исходник
приложения, spool-копию и две PDF-копии при переносе результата. Размер
процессных данных/профиля дополнительно ограничен tmpfs/памятью контейнера.
После физической очистки spool/исходника и PDF-проверки charge становится
размером готового PDF. При ошибке/отмене charge сохраняется до cleanup.

### Конвертер и границы изоляции

`workers/pptx/Dockerfile`: Debian bookworm-slim закреплён digest,
libreoffice-impress 4:7.4.7-1+deb12u14 (реальный пакет Debian security updates),
Python stdlib; Liberation/DejaVu/Noto CJK. Отдельный `compose.pptx.yaml`,
profile pptx. По умолчанию основного Compose конвертер не запускается.
Профиль не включает флаг автоматически и не применяется к production.

Контейнер: UID/GID1000, network=none, read-only root, cap_drop ALL,
no-new-privileges, 384 МиБ без swap, 0.75 CPU, 64 pids, /tmp tmpfs128 МиБ.
Общий spool — отдельный tmpfs128 МиБ UID1000/mode0700; в нём только задания,
без БД/секретов/Docker socket/исходников приложения. Worker сериализует
обработку flock; дочерний job получает уникальный профиль и process group.
Общий deadline120 секунд включает preflight и LibreOffice; родитель
проверяет cancel/deadline и убивает группу до публикации terminal ack.
После успеха/ошибки/отмены профиль удаляется, дочерние процессы не остаются.
Это контейнерная изоляция одного доверенного конвертера, не отдельная VM на
документ и не доказательство защиты от всех неизвестных уязвимостей LibreOffice.
Масштабирование нескольких приложений/общая удалённая очередь сюда не входит.

`roomPptxImport` не запускает Docker/офисные процессы. Он атомарно публикует
manifest с UUID/deadline, использует только фиксированные локальные имена,
ограниченные JSON/файлы и O_NOFOLLOW. Readiness — свежий heartbeat worker;
одного флага без worker недостаточно для capabilities/reserve/begin.
Cancel/timeout оставляют spool и charge, пока нет terminal ack. Janitor
сначала получает подтверждение/удаляет spool, затем удаляет файлы и освобождает
квоту. При потерянном worker вернуть его, чтобы он завершил/отклонил старые
задания; не удалять spool/charge вручную. После рестарта приложения потерянный
upload не возобновляется: lease/cleanup завершат его как failed. Mount нужно
сохранить до очистки незавершённых импортов, даже если флаг выключен.
Готовые PDF читаются и удаляются без работающего конвертера.

### Проверка OOXML и результата

До LibreOffice ZIP читается без извлечения пользовательских путей: максимум
4096 записей, 200 МиБ фактического распакованного потока, 8 МиБ на XML,
compression ratio200; проверяются CRC, пути/дубликаты/шифрование/методы/symlink,
content types/корень presentation/число slide IDs/parts и наличие внутренних
relationship targets в самом архиве. DTD/entities (в том
числе UTF16/32), VBA/ActiveX/OLE/встроенные документы/видео/аудио и внешние
загружаемые ресурсы отвергаются. Некоторые сложные валидные PPTX поэтому не
поддерживаются: предлагается вручную сохранить PDF. PPT/PPTM/парольные файлы
не поддерживаются; разрешён обычный transitional PPTX.

Безопасные HTTP/HTTPS/mailto гиперссылки допускаются как данные. В LibreOffice
7.4 PDFViewSelection=3 не удаляет все URI-аннотации: исходящий PDF может их
содержать. Приложение, как и для обычных PDF, рисует только canvas через
закреплённый PDF.js без annotation/link layer и не выполняет переходов/действий.
Тест с реальной URL-аннотацией не обращается к внешнему адресу. Не называть
подготовленный файл универсально «очищенным PDF» для произвольного PDF-reader.

В свежем профиле до загрузки файла задан MacroSecurityLevel=3 с пустыми
trusted locations ([официальная справка](https://help.libreoffice.org/latest/en-GB/text/shared/optionen/macrosecurity_sl.html)),
Java отключена настройкой. Это дополнительная мера к
preflight/network isolation, не их замена. Вывод — impress_pdf_Export,
без notes pages/transition effects/form fields; hidden slides включены.
Результат повторно проходит существующий supervised PDF.js worker: header,
нешифрованный PDF/число страниц/размеры/checksum/лимиты. После этого исходник
удаляется и материал атомарно переходит в ready; исходный PPTX не выдаётся.

### Интерфейс

Когда флаг и worker доступны, RoomMaterials добавляет .pptx/20 МиБ, предупреждение
о потере анимаций/отличиях шрифтов/неподдерживаемых объектах и временной квоте.
После загрузки автоматически выбирается PDF-preview; ready-строка сообщает
«PDF из PPTX», в том числе на мобильном, где прежний type badge скрыт.
Общий показ владелец запускает прежней командой вручную. Дополнительный
серверный preview-ack между вкладками не вводился. Использованы прежние tokens,
Dialog/buttons/status/pager/cleanup; RU/EN/zh-CN. Расширение Experimental 1.7.0.

### Проверки и следующий gate

PASS: Python preflight fixtures — корректная кириллица/2 slides, external file
resource, macro marker, traversal/backslash/symlink/duplicate/CRC, ZIP bomb,
DTD и 101 slides. `test-room-pptx-spool.js`: bounded copy, no-follow output,
нет worker/terminal cleanup, timeout с удержанием spool, recovery и cancel ack.

PASS `check-room-pptx-docker.cjs`: настоящий PostgreSQL18/JWT/HTTP/Multer,
app Node20 Alpine и отдельный LibreOffice при указанных ограничениях. Проверены
флаги/ownership/replay, реальный PDF с 2 страницами и кириллицей, private content,
удаление исходника/spool, квоты при успехе/ошибках, негативные PPTX, отмена после
старта worker и отсутствие потомков/профилей, чтение/удаление при выключенном
флаге. Прежние media/V2-schema и presentation SQL/HTTP/WS прошли. Простая
фикстура: app peak около75 МиБ, converter peak около167 МиБ по cgroup. Это
не замер тяжёлой презентации/100 слайдов/совместной нагрузки и не бюджет VPS.

PASS Chromium --pptx: настоящий результат LibreOffice подан тестовым HTTP,
автоматический PDF preview, badge/notice/доступность; прежние 3 языка/7 размеров,
200% text/reflow, cancel/offline/focus/logout. Скриншоты mobile/desktop просмотрены.
Полная /play с GLB/6 avatars/голосом/камерой/выходом прошла отдельно; видео/общий
PDF не изменялись. Временные контейнеры/тома/БД удалены, рабочий Compose/БД/VPS
не менялись, push не выполнялся.

Воспроизведение (только изолированные тесты):
```sh
python3 scripts/room-pptx-fixtures.py scripts/fixtures/room-pptx
python3 workers/pptx/test_validate.py
node scripts/test-room-pptx-spool.js
docker build -f workers/pptx/Dockerfile -t 3dtalks:pptx-worker .
docker build -t 3dtalks:pptx-gate-app .
node scripts/check-room-pptx-docker.cjs
node scripts/test-room-materials-browser.js --pptx
```

Опциональный ROOM_PPTX_TEST_ARTIFACT=/absolute/temp/file.pdf сохраняет
синтетический результат теста; ROOM_PPTX_TEST_PDF подаёт его browser fixture.
Это не экспорт пользовательского материала.

Этап 6 остаётся отдельным: тяжёлые/реальные decks, timeout/OOM/restart worker,
совместная нагрузка с активной комнатой/загрузкой, общий RAM/tmpfs/disk budget,
шрифты/сложные объекты и ручная приёмка. Бюджет app512+DB256+worker384
уже больше1ГБ без ОС: на нынешнем VPS PPTX включать нельзя. Нужны измерения и
отдельное решение об увеличении RAM/размещении worker; внешний сторонний
конвертер не используется. Флаг false, основная локальная установка не
перезапускалась. Push/развёртывание/включение — только отдельным поручением.


## 14. Этап 6: полученные результаты и переход к ручной проверке (28 октября)

По решению пользователя дальнейшие стресс-прогоны остановлены: стенд тестовый.
Для **новых загрузок** введены временные ограничения: MP4 20 МиБ/180 секунд,
PPTX 5 МиБ/20 слайдов. Они проверяются сервером, а PPTX — также до LibreOffice;
клиент показывает те же значения на трёх языках. Стандартные PDF/изображения
не изменены. До 50 МиБ квоты резервируется на одну конвертацию PPTX; готовый
PDF по-прежнему ограничен 20 МиБ. Сервер повторно проверяет готовый результат.
Выпущенные v2 wire/SQL-границы не снижались: старые готовые видео до 10 минут
и PDF до 100 страниц остаются пригодными для чтения/показа.

До этого решения на прежних пределах уже прошёл изолированный синтетический
прогон: 100 текстовых слайдов (2.70 секунды), 100 слайдов с изображениями
(18.11 МиБ исходник, 3.77 МиБ PDF, 8.95 секунды). Во время обработки шесть
настоящих WS/JWT-клиентов читали текущий PDF: 498 ping samples, p95 2.70 мс,
max 4.80 мс; HTTP PDF p95 46.82 мс, max 99.25 мс. Это локальные синтетические
измерения, не гарантия ёмкости VPS; голос подменён, шесть GLB-браузеров и
реальные микрофоны в этом прогоне не участвовали.

Проверены deadline, перезапуск worker с оставленным частичным PDF, настоящий
cgroup OOM нативного LibreOffice и успешная следующая конвертация. При OOM
импорт получил PPTX_CONVERSION_FAILED. Отдельный pg_dump/restore тестовой схемы
с копией готового файла подтвердил владельца, source_format, размер и SHA-256.
Это восстановление в покое, не проверка согласованного online backup.
До инъекции максимумы cgroup: app 182.93 МиБ, worker 166.99 МиБ, PostgreSQL
96.57 МиБ; это отдельные пики, не одновременный максимум. При инъекции worker
достиг лимита 384 МиБ; основной стек не затрагивался.

Уточнение прежних выводов о ресурсах: WSL сообщает MemoryLimit=true,
SwapLimit=false. memory-swap задан, но отсутствие swap здесь не подтверждено.
Для реального OOM тестовый контроллер временно использовал повышенный memlock
и давление памятью внутри отдельного worker; этот ulimit не добавлен в Compose.
Страницы spool/tmpfs уже учитываются cgroup записывающего процесса, поэтому
их нельзя повторно прибавлять к сумме лимитов. Даже без этого app512+DB256+
worker384=1152 МиБ превышают 1 ГБ до ОС. Уменьшение размера файла само по себе
не подтверждает возможность включения PPTX на таком VPS.

После снижения лимитов пройдены только короткие проверки: контракт v2 и
серверный отказ резервирования файлов выше лимита; preflight PPTX 20/21 слайд
и 5 МиБ+1; spool lifecycle; настоящий ffprobe и видео 180/181 секунд, 20 МиБ+1;
Chromium материалов --pptx (тестовые API), git diff --check. Дополнительный
нагрузочный прогон не выполнялся. Опциональные stress/recovery-фикстуры теперь
соответствуют 20 слайдам/5 МиБ; их обновлённая версия повторно не прогонялась.
Полный Docker gate после изменения лимитов также не повторялся.

Ручная приёмка реальных пользовательских PPTX и MP4 — следующий этап по
сценарию README. Рабочий localhost/Compose, база и VPS не обновлены, флаги
по умолчанию выключены, push не выполнялся. Временные контейнеры прошлых
прогонов удалены. Включение/развёртывание — отдельное поручение.


## 15. Превью текущего слайда у ведущего

По отзыву пользователя управление показом дополнено настоящим превью текущего
PDF/PPTX→PDF/изображения. Оно копирует уже подтверждённый отрисованный кадр;
второй PDF renderer, повторный fetch и отдельное состояние листания не создаются.
Номер и изображение следуют серверному состоянию. Пока новый материал/слайд
загружается, прежний кадр скрыт; stop, disconnect и потеря роли очищают просмотр.
При закрытии диалога backing canvas освобождается. Видео сохраняет свой
существующий интерфейс управления, миниатюра видео этим изменением не добавлена.

На широком экране превью и листание находятся слева, выбор материала и
управление показом — справа; на мобильном экране — одна колонка, сначала
текущий кадр и листание. Прежние дизайн-токены, focus trap, Escape, клавиатурные
стрелки/PageUp/PageDown, запрет команд во время pending и серверные права
сохранены. Новых endpoint/пакетов/миграций нет.

PASS test-room-presentation-browser.js: реальные PDF.js/canvas в Chromium,
пиксели превью после переходов, отсутствие повторного fetch, скрытие старого
кадра при загрузке/stop, 3 языка/7 размеров, bounds, фокус, гонки/выход и прежняя
регрессия. Просмотрены desktop/mobile скриншоты. Рабочий dev localhost отдаёт
изменённые JS/CSS, /api/ready успешен; достаточно Ctrl+Shift+R.
Проверка настоящих двух аккаунтов остаётся ручной; VPS/push не выполнялись.


## 16. Совместимость обычных MP4 и диагностика отказов

По отзыву пользователя проверен Phone.mp4: 2.34 МиБ, 6.042 секунды,
H.264/yuv420p + AAC, с дополнительной attached_pic MJPEG. Прежняя проверка
ошибочно считала обложку второй видеодорожкой. Теперь разрешена одна явно
помеченная attached_pic JPEG/PNG до 4 миллионов пикселей; её fps/длительность
не влияют на метаданные ролика. Исходник сохраняется побайтово, без remux или
перекодирования. Общий размер файла по-прежнему ограничен 20 МиБ.

Проверены и исправлены соседние случаи:
- вертикальное видео до 1080×1920 (как и горизонтальное до 1920×1080);
- поворот через display matrix кратно 90°: в DTO передаются размеры после
  поворота, фактическую ориентацию при воспроизведении применяет браузер;
- отсутствующий/нулевой nominal fps при доступном measured fps: используется
  известное положительное значение; при двух значениях берётся большее;
- короткий повреждённый файл получает INVALID_VIDEO вместо «слишком большой»;
- отдельные локализованные ошибки: кодек/HDR, звук/каналы, fps, разрешение,
  поворот и лишние дорожки. Общая ошибка повреждения больше не советует
  проверять интернет для некорректного файла.

Не расширялись лимиты RAM/веса/длительности, разрешённые playable кодеки,
сетевые протоколы ffprobe или число настоящих видео/аудиодорожек. HEVC/HDR,
4K/60 fps, произвольный наклон и многодорожечный монтаж требуют обычного
экспорта в совместимый MP4; автоматического тяжёлого transcoding нет.

Новая обязательная аддитивная миграция add_room_video_portrait.sql расширяет
только SQL-проверку размеров. Такое же выражение внесено в add_room_media_v2.sql:
canonical startup повторяет ранние миграции при каждом запуске, поэтому старая
проверка высоты иначе блокировала бы запуск после сохранения portrait-видео.
Контракт metadata и v2-state согласованы с SQL; версия wire/формат полей прежние.
Откат на старые клиенты требует учёта новых portrait-материалов (старые клиенты
отклоняют их DTO); пользовательские файлы/записи автоматически не удалять.

PASS: test-room-video-processor (настоящие ffmpeg/ffprobe и supervised worker,
JPEG/PNG covers, portrait, rotation, лишняя видеодорожка, fps/размер/длительность,
обложка с посторонними fps/duration, недостающий fps, каналы и cleanup);
test-room-media-v2-contract; PostgreSQL 18 check-room-media-v2-postgres и
check-room-video в отдельной временной БД, удалённой после проверки. Повторное
применение обеих миграций с готовым portrait-активом проверено дважды.
Phone.mp4 прошёл настоящий HTTP upload/processor локального приложения;
временный материал удалён. Сам файл не добавлен в Git и никуда не отправлялся.
Native Chromium воспроизвёл его как 736×400, без media error. Это проверка
обычного декодирования, не двухклиентская синхронизация этого конкретного файла.
Регрессии Chromium материалов --pptx и показа (3 языка/7 размеров) прошли.
Локальный dev обслуживает изменения; VPS этим этапом не обновлялся, push нет.
