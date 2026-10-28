# Участники и настройки звука — этап 1

Дата: 20 октября 2026. Ветка codex/meeting-room-controls.
Общий контракт/дорожная карта: [MEETING_ROOM_EVOLUTION.md](../../MEETING_ROOM_EVOLUTION.md).
Область: список участников, запись/воспроизведение, предпочтение микрофона,
локальный тест и входящий звук. Потоковый транспорт и модерация не реализованы.

## Реальные компоненты

- public/js/meetingRoster.js: серверный bounded store; себя показываем первым,
  snapshot заменяет набор, повтор join обновляет имя, неизвестный voice id
  не создаёт пользователя. Recording TTL 70 с, playback учитывает перекрытие
  источников. Reconnect очищает activity и помечает данные stale.
- public/js/meetingAudioSettings.js: локальный deviceId, точные constraints,
  enumerate без capture, тест через AudioContext/AnalyserNode без destination.
  Pending grant/AudioContext.resume защищены generation; tracks/timers/context
  освобождаются при отмене/тайм-ауте/закрытии/выходе.
- public/js/meetingRoomPanel.js: два native dialog, один открыт одновременно.
  Короткая шапка, scrollable focusable body, Tab/Escape/return focus,
  camera input propagation остановлен. Предпочтение применяется сразу;
  нет лишнего Save, истории тестовых записей или удалённой передачи.
- public/css/meeting-room-controls.css: shared controls/tokens, локальная область,
  позиционирование по visualViewport, контролы 44 px, select 16 px.
- public/js/voiceChat.js: existing clip transport сохранён, добавлены exact
  device, generations отмены, фактические playback events, immediate incoming
  mute, cleanup при отказе recorder/устройства и server congestion deny.
- meetingSocket/Main/UI/RoomSeating: lifecycle и данные; протокол/SQL/API/GLB
  не менялись. Старый режим не загружает активные meeting services.

## Design QA Report

- Visual: PASS — просмотрены actual Chromium screenshots roster/sound
  поверх встроенной GLB-комнаты в mobile. Отдельные UI fixture screenshots
  /tmp/meeting-participants.png, /tmp/meeting-sound-settings.png.
  Настоящая сцена: /tmp/meeting-controls-room-mobile.png,
  /tmp/meeting-sound-room-mobile.png (MEETING_UI_SCREENSHOTS=1).
- Functional: PASS — authoritative roster/dedup/rename/leave, snapshot/reconnect,
  recording/playback overlap, microphone exact device, enumerate без capture,
  test/stop, denied/timeout/visibility, старые/new permission races,
  recorder start failure/device ended, pending decoder и входящий mute.
- Responsive: PASS — HUD 1366×768, 1920×1080, 1280×800, 768×1024, 430×932,
  375×812, 390×844, 320×568, 568×320. Новый roster dialog — 320×568, 375×812,
  768×1024, 1280×800, 568×320. Scroll/фокус сохраняют обязательные действия.
- Localization: PASS — RU/EN/zh-CN, настоящий механизм {{count}}/{{number}},
  длинные имена и literal HTML. Пользовательский текст не парсится как HTML.
- Accessibility: PASS для проверенных focus trap/Escape/возврата, keyboard scroll
  body, native select/checkbox/progress labels; общие contrast tokens сохранены.
  NOT RUN: axe/screen reader/реальные touch-устройства, полный browser zoom.
- Regression: PASS — команды перечислены в разделе 25 основного плана.
  Браузер использует реальные capture/MediaRecorder/decode со fake audio input;
  он не обращается к физическому микрофону. HTTP/WS тестовые.
- Build: статические скрипты/стили, новая сборочная система не требуется;
  JS/JSON syntax и git diff --check проверены.
- NOT RUN: серверная live-приёмка/реальные устройства. Docker/VPS и deployment
  этой порцией не выполнялись. Новые npm зависимости/миграции отсутствуют.

## Ручная приёмка после разрешённого развёртывания

1. В двух аккаунтах открыть одну комнату: правильные имена/число/«Вы»,
   reload/выход второго аккаунта, восстановление WS без старых записей.
2. Удержать микрофон: у другого «Записывает сообщение», после отправки
   во время звука — «Воспроизводится сообщение». Это не realtime speaking.
3. Открыть «Звук»: выбрать USB/Bluetooth/default, проверить уровень,
   Stop/Escape/скрытие вкладки. Проверить аппаратный индикатор микрофона.
4. Отказать в permission, разрешить через browser settings, повторить тест.
   Закрыть окно до ответа на prompt — позднее разрешение не должно оставлять
   микрофон активным.
5. Отключить выбранный микрофон во время теста/записи, выбрать новый.
   Неподключённое выбранное устройство не должно подменяться молча.
6. Выключить «Слышать участников» во время сообщения: звук прекращается;
   включение не воспроизводит накопленные старые сообщения.
7. Проверить keyboard Tab/Shift+Tab/Escape, mobile landscape и масштаб 200%.

После первого этапа остановиться. Следующий шаг — SFU spike и инфраструктурная
проверка по основному документу, с отдельным согласованием.
