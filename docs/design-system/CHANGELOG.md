# Changelog — 3DTalks Design System

Формат следует принципам Keep a Changelog; версия документации независима от версии продукта. Не добавлять задним числом неподтверждённые реализации.

## [1.4.1] — 2026-10-20
### Fixed
- При узкой видимой области высотой менее 480 px выбор мест временно
  занимает область toolbar вместо практически нулевой высоты списка.
  Закрытие возвращает toolbar; сохранены прокрутка списка и доступность мест.
- Высота истории чата учитывает visualViewport, чтобы не вытеснять composer
  при раскрытии длинной истории над экранной клавиатурой.

### Validation
- Добавлены частичное 200% text scaling (RU, desktop/mobile) и имитация
  visualViewport 390×360 с offsetTop 0/100, длинной историей и выбором мест.
  Пройдены test-meeting-ui-browser, startup builtin-v2 и room-seat-client.
- Это геометрическая имитация; настоящие клавиатуры/браузерный zoom остаются
  ручной проверкой. Подробности — meeting-hud-redesign.md.

## [1.4.0] — 2026-10-20
### Changed
- Светлые локальные панели встречи, выбор мест и состояния подключения.
- Существующая история чата раскрывается по запросу; поле и микрофон получили
  общие tokens/controls, доступные подписи и состояния RU/EN/zh-CN.
- Адаптивная компоновка сохраняет область сцены; observer/listener cleanup
  подключён к завершению встречи. API, Three.js и команды посадки не изменены.

### Validation
- Chromium: 3 языка, 9 viewport, клавиатура/фокус, контраст, offline draft,
  PTT, reconnect, история, выбор места и очистка UI; полный startup builtin-v2
  с настоящими GLB. Регрессия показа, viewer, голоса и сокетов прошла.
- Границы и ручная приёмка — meeting-hud-redesign.md. Реальные микрофоны,
  телефоны, Safari, axe/screen reader и live-сервер не проверялись.
  Push и развёртывание не выполнялись.

## [1.3.0] — 2026-10-20
### Changed
- RoomPresentation использует light panel, отдельные current/library/command
  состояния, retry, полные имена и контролы по общим tokens/Button variants.
- RoomScreenPreview получил light viewer, resize-aware fit, локальный масштаб,
  доступную клавиатурную прокрутку и очистку ResizeObserver.
- Сохранены API и wire shapes, серверные права, revision/epoch guards, локальность
  zoom и очистка на disconnect. Потеря canControl закрывает панель владельца.
- Добавлены RU/EN/zh-CN подписи; viewer подключён также в редакторе без App Shell.

### Validation
- Chromium: 3 языка, 7 viewport, pending/timeout/conflict, loading/empty/retry/401,
  role loss, fit/resize/zoom/pan, observer cleanup; настоящий редактор и startup
  builtin-v2. Материалы/HUD/protocol регрессия прошла с тестовыми API/WS.
- Результаты и границы — presentation-redesign.md. Внешний HUD/чат, сервер и
  Three.js не перерабатывались; push/развёртывание и ручная приёмка не выполнены.

## [1.2.0] — 2026-10-20
### Changed
- RoomMaterials получил единый light dialog, upload target, квоты, список файлов,
  состояния, desktop preview/mobile reflow и локальное подтверждение удаления.
- Сохранены публичный API, active-presentation guards, лимиты, отмена/очистка;
  401/403 закрывают библиотеку. Escape вопроса отменяет удаление без закрытия списка.
- Native Button variants/Inter вынесены в app-controls.css без App Shell в /play.
  Введены локальный scope панели и переводы RU/EN/zh-CN.

### Validation
- Расширена Chromium-регрессия материалов: две области, 3 языка, 7 viewport,
  focus/confirmation, active delete conflict, offline/retry, cancel upload,
  отказ доступа, empty и частичная проверка 200% CSS text scaling.
- Прошли кабинет, аватар, управление встречей, показ и полный startup builtin-v2
  с тестовыми API/WS. Контраст primary link добавлен в тест кабинета.
- Границы проверок и сценарий ручной приёмки — materials-redesign.md.
  Панель показа/увеличенный экран, backend и Three.js не изменены.

## [1.1.1] — 2026-10-20
### Documented
- Вместо TBD-кандидатов записаны реальные CSS/JS/HTML-реализации, consumers,
  публичные методы, состояния, фокус, локализация и ограничения компонентов.
- Зафиксированы несовместимость прямой подмены окон встречи на AppDialog,
  отсутствие dirty guard в общей обёртке и различия очистки ресурсов.
- Отмечен второй consumer ScreenPreview в редакторе, native disclosure вместо
  ARIA menu и отсутствие готового TemplateCard для кабинета.
- Предложен следующий локальный этап библиотеки материалов без смены API.
  Lifecycle Stable не присваивался; код и стили не менялись.

## [1.1.0] — 2026-10-20
### Added
- Общий изолированный app-tokens.css, совместимые semantic aliases,
  типографические роли, размеры и motion tokens для web UI и будущих панелей.
- Карта токенов, 14 измеренных контрастных пар и отчёт QA в token-integration.md.

### Changed
- app-ui.css импортирует общий источник; текущие размеры и применяемые цвета
  кабинета сохранены. Неиспользуемый secondary text token ссылается на доступный
  muted text вместо референсного примитива.
- Уточнены 22 px DialogTitle для текущего кабинета и 24 px SectionTitle для новых
  разделов. Поля кабинета сохраняют 14 px desktop / 16 px mobile.

### Validation
- Chromium-регрессия кабинета, материалов, аватара и управления встречей прошла
  с тестовыми API. Изоляция tokens от :root/canvas проверена отдельно.
- Сцена, протокол, HTML-панели и продуктовые функции не изменялись.

## [1.0.1] — 2026-10-20
### Added
- Импорт документации в существующий репозиторий без замены корневого AGENTS.md.
- Карта исходников и ограничения проекта в implementation-status.md.
- Исходные инструкции архива сохранены как справочные документы; UI-код не изменён.

### Clarified
- HTML-панели материалов и презентации входят в согласованную область будущего
  редизайна; сцена Three.js и протоколы остаются за её пределами.
- Сохраняются три языка, доступные action-цвета, очистка защищённых материалов
  и немедленная семантика команд показа. Типографические различия требуют
  отдельного решения; глобальная миграция токенов ещё не выполнена.
- Частичный статический аудит не означает соответствия UI или статуса Stable.

## [1.0.0] — 2026-10-20
### Added
- Первоначальная нормативная модульная дизайн-система Light Premium SaaS / Soft Minimal.
- Шесть Design Principles; строгий управляемый процесс расширения.
- Двухуровневые Primitive + Semantic Design Tokens.
- App Shell и четыре шаблона Grid/Data/Form/Workspace.
- Трёхуровневая Component System и требования к полным контрактам.
- UX Patterns: явное сохранение, dirty guard, dialog, toast, loading/empty/error/offline.
- Responsive patterns по четырём диапазонам.
- Строгая Motion System и обязательная WCAG 2.2 AA.
- RU/EN content guidelines, Governance, Design QA и план постепенного внедрения.
- Semantic Versioning и lifecycle Experimental/Stable/Deprecated/Removed.

### Important
- В этой версии **не выполнен аудит исходного кода**, не присвоены статусы Stable конкретным реализациям, не подтверждено наличие UI-библиотек.
- Цветовые пары для контрастных primary controls и вторичного текста остаются предметом измерения в реальном UI перед внедрением.
