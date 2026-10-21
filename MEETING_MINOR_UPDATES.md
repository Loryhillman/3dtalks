# Небольшие улучшения переговорной

Ветка codex/meeting-minor-updates, общая исходная версия e60dc7ec
(завершённый этап 2c6660aa и документация веток). WebRTC/SFU не входят.
Пользователь выбрал выполнение пунктов по порядку с отдельными коммитами.

## 1. Приглашение прямо из комнаты — выполнено

Кнопка с иконкой рядом с названием комнаты открывает native dialog.
Не добавляет новую строку toolbar. Доступна активным участникам; создание
такой ссылки не даёт новых прав. Это тот же origin + /join/encodeURIComponent(slug),
что в кабинете, без JWT/claim/session/query. Сервер продолжает проверять
вход, вместимость и закрытие комнаты при переходе приглашённого человека.

Readonly поле можно выделить и скопировать вручную. Кнопка Copy использует
writeText только после явного жеста. При отсутствии API или отказе выбирается
ручной путь; ложный «успех» не показывается. Pending блокирует повторный Copy;
позднее завершение после close не меняет новое окно и не перехватывает фокус.
Никаких чтений clipboard, execCommand, новых endpoints/SQL и отправки сообщений.

QA PASS: test-meeting-ui-browser.js — RU/EN/zh-CN, 320×568/568×320/1280×800,
точный URL, encoded slug, отсутствующий slug, success/denied/missing clipboard,
pending close, focus/Escape и отсутствие WS-команд. Весь HUD проверен в 9 размерах.
test-meeting-startup-browser.js --builtin-v2 — настоящая GLB-комната,
сохранность камеры/посадки/показа. Screenshot просмотрен:
 /tmp/meeting-invite-desktop.png; mobile: /tmp/meeting-invite-mobile.png.
NOT RUN: реальные телефоны/Safari/screen reader/серверная live-проверка.

## 2. Клавиши презентации — выполнено

В открытой панели управления показом ArrowLeft/PageUp вызывают Previous,
ArrowRight/PageDown — Next. Добавлены видимая подсказка RU/EN/zh-CN
и aria-keyshortcuts. Используются существующие кнопки, canControl/session/
revision/pending guards; новые права/протокол/offline-очередь не добавлены.

За пределами этой панели глобальных обработчиков нет. Input/textarea/select,
contenteditable и соответствующие ARIA controls сохраняют клавиши.
Ctrl/Alt/Meta/Shift, repeat, composing и keyCode=229 игнорируются.
Disabled Previous/Next на первой/последней странице или при pending ничего
не отправляют. Закрытие/потеря роли снимают область действия обработчика.
Увеличенный просмотр остаётся локальным: его стрелки/PageUp/PageDown
прокручивают, но не переключают общий слайд.

QA PASS: test-room-presentation-browser.js — все четыре клавиши,
expectedEpoch/revision и подтверждённые страницы; границы/pending/repeat/
модификаторы/IME/input/contenteditable/select/close/role loss; 3 языка,
7 viewport, локальность viewer. test-room-presentation-protocol.js и
test-meeting-startup-browser.js --builtin-v2 пройдены. HUD/приглашение/звук
повторно проверены test-meeting-ui-browser.js. API/WS браузерных тестов —
фикстуры. NOT RUN: физическая клавиатура/Safari и live сервер.

## 3. Замечания пользователя

Конкретных новых замечаний пока нет. Не придумывать за пользователя.
По отдельному поручению 21 октября 2026 развёрнут runtime 7c16866d вместе
с базовым этапом участников/звука. Live-проверка приглашения, синтетического
микрофона и ArrowRight/общего показа пройдена в выделенной комнате с двумя
временными аккаунтами. Это дополняет локальные фикстурные тесты выше;
телефоны/физические микрофоны/Safari остаются ручной проверкой.
Резервная копия и откат описаны в SERVER_DEPLOYMENT.md.


## Исправление навигации браузера

По сообщению пользователя найден пропущенный cleanup: прежний pagehide
вызывал MeetingMain.stop только при persisted=false. При заморозке документа
в back/forward cache socket и присутствие могли оставаться активными.
Теперь любой pagehide вызывает идемпотентный stop: закрываются WS/микрофон,
очереди/retry, показ, участники и рендер. Обычное скрытие вкладки не является
выходом. При pageshow.persisted выполняется reload этой же history entry,
затем штатные auth/admission/посадка/показ с новыми разрешениями сервера.
Нельзя повторно запускать start поверх уничтоженных one-shot сервисов.
Новые endpoints/beacon, токены в URL, beforeunload/unload не добавлены.
При обычном сетевом отключении прежняя краткая бронь места сохраняется;
она не означает, что аватар должен оставаться онлайн.

QA: test-meeting-startup-boundaries.js проверяет оба значения persisted,
идемпотентный stop, очередь, socket/mic/guard и запоздалый ответ API.
Новый test-meeting-history-browser.js запускает настоящий Chromium с включённым
BFCache и настоящие WebSocket: наблюдатель видит уход/возврат при Back/Forward
в обоих направлениях и повторных циклах. Получено 4 pagehide.persisted=true;
каждый возврат повторяет admission, JS errors отсутствуют. Auth/room API,
отрисовка и микрофон в этом отдельном тесте — фикстуры; это не PostgreSQL gate.
Пройдены также test-meeting-startup-browser.js --builtin-v2 (настоящая сцена,
тестовые API), test-voice-lifecycle.js и test-room-presence-stop.js.
