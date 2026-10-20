# Реестр UI-компонентов

Версия документации: 1.1.1. Аудит: 2026-10-20, ветка `codex/room-presentations`.
Область: кабинет, оболочка аватара и HTML-интерфейс материалов/презентации.
Это подтверждённая карта исходников, а не декларация полного соответствия
дизайн-системе. Lifecycle Stable/Experimental/Deprecated не присвоен:
соответствие всех контрактов, устройств и assistive technology не проверено.

## Стек и границы

Рассматриваемый интерфейс — обычный HTML, CSS и browser JavaScript, глобальные
экспорты через window и скрипты в HTML. React и другие пакеты в package.json
не означают, что эти страницы построены на них. Фреймворк для редизайна не нужен.
`/rooms` и `/join/:slug` используют `public/rooms.html`; оболочка аватара —
`public/avatar.html`. `/play` формируется из `public/index.html` через
`src/services/meetingPage.js`. Редактор — `public/room_editor.html`.
Сам renderer Three.js не является UI-компонентом этого реестра.

Общий источник токенов — `public/css/app-tokens.css`; стили элементов кабинета —
`public/css/app-ui.css`, область `.app-ui`. `.meeting-ui` пока зарезервирован
для отдельных панелей и содержит только токены. Подключение и измерения:
[token-integration.md](token-integration.md).

## Краткая карта

| Компонент | Уровень | Реализация | Факт / основное ограничение |
|---|---|---|---|
| Button / IconButton | Primitive | `public/css/app-ui.css` | CSS + native button/link; самостоятельной JS-фабрики IconButton нет |
| Input / Select / Field | Primitive / композиция | `public/css/app-ui.css`, `public/rooms.html` | Native поля и label; общего FormField API нет |
| AppDialog | Composite | `public/js/app-ui.js` | Статические диалоги кабинета; не универсальная обёртка встречи |
| AppToasts | Composite | `public/js/app-ui.js` | Очередь до 3; success/info/error; только кабинет как подтверждённый consumer |
| AppShell | Layout | `public/js/appShell.js`, `public/css/app-shell.css` | Кабинет/приглашения/аватар; не подключать в /play |
| RoomCard / RoomStatus | Domain | `public/js/roomsLobby.js`, `public/css/rooms-ui.css` | Внутренняя DOM-композиция, не экспортируемый класс |
| Room actions disclosure | Composite / Domain | `public/js/roomsLobby.js` | Native details/summary; не ARIA menu с управлением стрелками |
| RoomMaterials | Domain | `public/js/roomMaterials.js`, `public/css/room-materials.css` | Собственный native dialog, загрузки и приватный preview |
| RoomPresentation panel | Domain | `public/js/roomPresentation.js`, `public/css/room-presentation.css` | UI связан с подтверждаемыми WS-командами и состоянием показа |
| RoomScreenPreview | Domain | `public/js/roomScreenPreview.js` | Локальная canvas-копия и zoom; собственный жизненный цикл |
| TemplateCard | Кандидат Domain | отдельной реализации для кабинета не найдено | В старом `public/world_editor.html` есть одноимённые CSS-правила; это не компонент выбора шаблона кабинета |

## Button / IconButton

- API: native button (type, disabled, aria-busy), ссылка для навигации;
  класс `.ui-button`. Варианты: базовый bordered, `--primary`, `--ghost`,
  `--destructive` (контур), `--danger` (заливка).
- Consumers: `public/rooms.html`, `public/avatar.html`, `public/js/appShell.js`,
  кнопки `public/js/roomsLobby.js`, `public/js/roomMaterials.js`.
- State owner: вызывающий модуль; CSS показывает hover/active/focus/disabled.
  aria-busy меняет cursor, а защита от повторной отправки находится в JS.
- Токены: action, foreground, border-control, focus-ring, radius-control,
  spacing, control-height/touch-size, motion-fast. Высоты 40 px desktop,
  44 px при viewport <=767; это не проверка всех устройств с coarse pointer.
- Icon-only реализован композицией img + aria-label/sr-only в конкретном месте;
  доступное имя должен задавать caller. Не добавлять role=button на обычную ссылку.
- Клавиатура: native button Enter/Space; ссылка Enter. Disabled недоступен Tab.
  CSS сам по себе не блокирует ссылку с aria-disabled — это обязанность caller.
- Тексты передают consumers из i18n; переносы разрешены. Размер кнопки не равен
  гарантированному target 44x44 для всех вариантов (например toast close).
- Проверки: `scripts/test-rooms-design-browser.js`,
  `scripts/test-avatar-editor-browser.js`, `scripts/test-room-materials-browser.js`.
- Gap: стили `.app-ui .ui-button` не применяются к самостоятельной панели
  `.meeting-ui`. Следующий редизайн должен согласованно адаптировать область
  существующих правил, а не копировать их отдельной палитрой.

## Input / Select / Field

- API: native input/select/textarea и HTML label; отдельного window.FormField нет.
  Статические потребители — `public/rooms.html`, `public/avatar.html`.
  Материалы создают file input в оборачивающем label; презентация — select.
- State owner: форма/контроллер. Требования required/min/max/type проверяются
  native HTML и логикой caller; стили поддерживают aria-invalid и disabled.
- Токены: surface, text-primary/muted, border-control, danger-action,
  focus-ring, radius-control, control-height/touch-size.
- AppDialog.fieldError использует aria-describedby как ID одного output;
  это не универсальный resolver списка нескольких ID.
- RU/EN/zh-CN находятся в `public/i18n/ru-RU.json`, `en-US.json`, `zh-CN.json`.
  Не вводить отдельные hardcoded подписи; динамическое переключение при открытом
  окне проверять отдельно, наличие ключей не доказывает обновление DOM.
- Кабинет: 14 px desktop / 16 px mobile, height 40/44; новые панели используют
  роль FormControl 16 px. Textarea/checkbox/switch не объявлены готовой общей
  системой только из-за наличия нормативного перечня в components.md.
- Проверки: сценарии форм в `scripts/test-rooms-design-browser.js` и
  `scripts/test-avatar-editor-browser.js`.

## AppDialog

- Экспорт: `window.AppDialog`; constructor(dialog, fallbackFocus, onSettled).
  Методы: open(opener), close(force), fieldError(field,text), clearErrors(),
  submit(fn,onError), restore(). Владеет busy, opener, scroll lock и восстановлением.
- Consumers: create-dialog, edit-dialog, confirm-dialog в `public/rooms.html`,
  три экземпляра в `public/js/roomsLobby.js`.
- Обязательная разметка: `[data-dialog-error]`; `[data-dialog-close]` связываются
  при создании экземпляра. clearErrors() требует существующий error node.
- Варианты CSS: `.ui-dialog`, `--compact`, heading/close/actions/error;
  ширина 560/440 px с ограничением viewport, mobile padding/max-height.
  Токены surface/text/border/radius-modal/shadow-dialog/motion-dialog.
- submit блокирует button/input/select, сохраняет их предыдущие disabled,
  ставит aria-busy и вызывает onSettled после завершения. Ошибка остаётся
  внутри открытого диалога через переданный onError.
- showModal, начальный autofocus, Tab/Shift+Tab, Escape, возврат opener или
  fallback. Escape блокируется при busy; close(true) применяется при смене сессии.
  Закрытие по клику на backdrop отдельным обработчиком не реализовано.
- Gap: dirty guard отсутствует; busy не означает dirty. Отмена несохранённой
  формы не получает автоматического подтверждения. Нет общего AbortController,
  destroy() или изоляции событий камеры. submit не отключает textarea.
- Нельзя напрямую заменять им RoomMaterials/Presentation/ScreenPreview:
  там иная структура DOM, отмена запросов, очистка canvas и disposable-окна.
- Проверки: `scripts/test-rooms-design-browser.js`, включая фокус, busy и ошибки.

## AppToasts

- Экспорт: `window.AppToasts`; constructor(closeLabel), show(text,type), clear().
  queue/active/timers принадлежат экземпляру; host добавляется в body.
  Подтверждённый consumer: один экземпляр в `public/js/roomsLobby.js`.
- Варианты: success 4000 ms, info 5000 ms, error до закрытия; максимум 3
  активных, остальные в очереди. Неизвестный type становится info.
- role=status для success/info, role=alert для error, icon aria-hidden,
  кнопка закрытия имеет aria-label из caller. При закрытии фокусированного toast
  фокус переходит к следующей кнопке либо #app-content.
- pagehide вызывает clear; удаляет toast и таймеры, очищает queue, но не host.
  Отдельного destroy API нет. Не создавать новые экземпляры при каждом открытии окна.
- Стили `.app-ui .ui-toasts/.ui-toast`, status pairs, viewport-limited scroll,
  safe-area отступы, 200 ms вход/выход; reduced motion обрабатывается CSS и JS.
- Gap: aria-label уже показанной кнопки не пересчитывается при смене языка;
  соответствие screen reader и всех размеров touch target не подтверждено.
  Ошибки загрузки/доступа материалов не заменять только исчезающими toast.
- Проверки: очередь, lifetimes, ручное закрытие и reduced motion в
  `scripts/test-rooms-design-browser.js`.

## AppShell

- `public/js/appShell.js` — самозапускающийся скрипт, публичного конструктора нет.
  Выполняется только с main и body.app-shell. Consumers: rooms.html, avatar.html.
- Создаёт header/sidebar, навигацию, account details и language select;
  переиспользует существующие language/logout кабинета.
- State: collapsed в localStorage, mobile drawer в памяти. Desktop sidebar
  248/64 px, header 64 px; breakpoint 767 px, на mobile drawer с backdrop.
- Drawer управляет inert основного контента, scroll lock, Tab и возвратом фокуса;
  Escape/outside click закрывают account disclosure. Labels через appShell i18n.
- Не переносить AppShell в переговорную, не использовать как modal manager.
  Нет публичного mount/unmount; рассчитан на жизнь страницы.
- Проверки: `scripts/test-rooms-design-browser.js` (drawer/брейкпоинт/фокус),
  `scripts/test-avatar-editor-browser.js` (страница аватара).

## RoomCard / RoomStatus

- Внутренний DOM-builder списка в `public/js/roomsLobby.js`; публичного класса
  RoomCard, props или независимого mount/unmount нет. State owner — lobby,
  источник rooms/quota — API. Список перестраивается при обновлении.
- article.ui-card.room-card; статическая иллюстрация
  `public/images/room-covers/neutral-v1.svg`, caption, fallback при image error.
  Это общая иллюстрация, не реальный снимок шаблона и не WebGL preview.
- Имя через textContent; вместимость, active/held/available, статус — из DTO.
  closed + !allow_rejoin отображается как ended; неизвестный status получает
  draft CSS-вариант, но текст остаётся переводом исходного status.
- Действия зависят от status/allow_rejoin: вход, приглашение, меню,
  материалы, переименование, capacity, open/close/end/delete.
  UI-ограничения не заменяют серверную авторизацию.
- CSS `public/css/rooms-ui.css`: auto-fill сетка с минимумом карточки 300 px
  и одной колонкой на mobile, cover 16:9, перенос длинных
  имён, action grid. Shared ui-card + локальные правила/цвета RoomStatus.
  Не считать все status colors автоматически переведёнными на semantic tokens.
- Loading/empty/error/offline/stale/quota — состояния списка, не самой карточки:
  .room-skeleton внутри #rooms, #rooms-empty, #rooms-error, #offline-notice, #quota-notice.
- Проверки: `scripts/test-rooms-design-browser.js` и
  `scripts/test-room-lobby.js`. Последний не проверяет визуальный дизайн.

## Room actions disclosure

- Внутренняя roomMenu(room) в `public/js/roomsLobby.js`; native details/summary,
  текстовые кнопки действий. Нет role=menu и контракта ArrowUp/ArrowDown.
- State owner: openRoomMenu; открывается только одно меню. Уход фокуса,
  выбор действия, внешний click закрывают; Escape возвращает фокус на summary.
- Fixed-position список в `public/css/rooms-ui.css` перепозиционируется при
  scroll/resize и visualViewport events, ограничивает height/width viewport.
- Summary имеет aria-label с названием комнаты; иконка декоративная.
  Обычный Tab используется для прохода кнопок. Не добавлять menu roles без
  полноценной реализации соответствующей клавиатурной модели.
- Проверки: `scripts/test-rooms-design-browser.js`.

## RoomMaterials

- Экспорт: `window.RoomMaterials={open(room,trigger),close}`. Один current dialog;
  повторное open закрывает предыдущий. Consumers: roomsLobby и library-действие
  RoomPresentation. Native dialog строится при каждом открытии и удаляется при close.
- State: текущая сессия/token, controller, transfer, uploadId, busy,
  previewEpoch/selected/page и RoomMediaRenderer. Сервер остаётся источником
  списка, состояний материалов и квот; UI получает приватные owner endpoints.
- Состояния: загрузка списка/ошибка/пусто; reserved/uploading/checking/ready/
  failed/cancelled; pending/cancel; local preview и pager. act блокирует
  input и повторные act, но не все кнопки; preview использует собственный epoch.
- Удаление — browser confirm; MATERIAL_IN_USE вызывает второе подтверждение
  stopShowing+delete с requestId/expectedEpoch/expectedRevision. Сохранить эту
  последовательность и отказ при конфликте; не заменять простым DELETE.
- При close отменяются fetch/upload, резервирование, renderer, таймер проверки
  сессии и listeners. storage/pagehide/смена token закрывают окно; запоздалый
  preview не должен обновлять новый dialog. Безопасность проверяет сервер.
- label/file input, title aria-labelledby, status role=status, строки role=group
  с именем файла, native Escape, Tab и возврат trigger. Keydown остановлен;
  полный набор pointer/wheel/touch stopPropagation, как у презентации, здесь
  отсутствует — это проверить при адаптации, а не считать уже готовым общим правилом.
- CSS: `.room-materials`, кабинетная `.ui-dialog` и отдельные тёмные overrides
  `.meeting-session .room-materials`; inline flex-строки. Width <=960px/95vw,
  max-height 92dvh, длинные имена переносятся. Это источник двух разных skins.
- Gap для редизайна: единая светлая панель, явные группы/варианты действий,
  список с понятными состояниями и квотами, согласованное подтверждение,
  focus/scroll при длинной библиотеке; не расширять типы файлов или квоты.
- Проверки: `scripts/test-room-materials-browser.js`; реальная серверная
  семантика — `scripts/check-room-media.js`,
  `scripts/check-room-presentation.js` (требуют отдельную PostgreSQL).

## RoomPresentation panel

- Экспорт: `window.RoomPresentation={attach,detach,message,disconnected,joined,stop}`;
  IIFE активен только в /play. openPanel внутренний, не публичное API.
  Consumer: `public/js/roomScene.js` attach/detach; кнопки — в #meeting-toolbar.
- State owner: контроллер (session/state/pending/syncing/view/renderer); состояние
  общего показа — сервер. Owner UI определяется session.canControl; это не
  самостоятельное разрешение доступа без серверной проверки.
- Native dialog: текущий материал/страница, select готовых материалов, show,
  previous/next, stop, library. Команды немедленные, без Save и offline queue.
- Disabled: соединение/синхронизация/pending/нет view, границы страниц,
  отсутствие asset/options. Library запрашивается с AbortController.
  WS requestId/expectedEpoch/expectedRevision, подтверждение и timeout 10 секунд
  принадлежат контроллеру. Конфликт вызывает sync без автоматического replay.
- close abort запроса списка и возврат trigger; общий показ при закрытии панели
  продолжается. disconnect очищает документы, окна и pending; stop дополнительно
  завершает контроллер и снимает controls. detach и stop не взаимозаменяемы.
- aria-labelledby, role=status, select label, native Escape, Tab/Shift+Tab,
  pointer/keyboard/wheel/touch propagation остановлен внутри dialog.
- CSS: отдельный тёмный room-presentation-dialog, native кнопки, styles toolbar;
  tokens пока не подключены. Gap: единая светлая композиция, иерархия действий,
  явные loading/error/empty состояния библиотеки; сохранение протокола и cleanup.
- Проверки: `scripts/test-room-presentation-browser.js`,
  `scripts/test-room-presentation-protocol.js`; серверная интеграция —
  `scripts/check-room-presentation.js`, live —
  `scripts/check-room-presentation-live-browser.js` (отдельное окружение/учётные данные).

## RoomScreenPreview

- Экспорт: `window.RoomScreenPreview={open(source,name,trigger),close,mount,refresh}`.
  Consumers: `public/js/roomScene.js` (mount), `public/js/roomEditor.js` (open/close);
  `public/js/roomScreenRenderer.js` обновляет копию через refresh.
- mount возвращает cleanup-функцию: закрытие окна и удаление кнопки. Один active
  preview; каждый open закрывает предыдущий. Состояние zoom локально.
- Canvas копирует source, refresh перерисовывает текущую копию; zoom .5–3
  с шагом .25 меняет CSS width. Shared commands не посылаются.
- Native dialog с title, autofocus Close, aria-label zoom-кнопок, canvas role=img;
  ручной цикл Tab между активными кнопками, Escape, возврат trigger;
  propagation pointer/keyboard/wheel/touch остановлен. При close удаляется DOM
  и обнуляются размеры canvas; source и GPU сцены этому окну не принадлежат.
- Gap: inline тёмный стиль, мелкие native controls, стартовый размер рассчитывается
  один раз (изменение viewport при открытом окне нужно проверить), aria-label
  canvas использует roomScreen.test даже для реального материала.
- Совместимость: применяется также в редакторе, который не входит в новый
  редизайн. Любые изменения общего preview требуют проверки обоих consumers;
  не подключать оболочку кабинета к редактору ради стилей.
- Проверки: `scripts/test-room-presentation-browser.js`,
  `scripts/test-room-screen-browser.js`, `scripts/test-meeting-startup-browser.js`.

## TemplateCard и остальные кандидаты

Готового компонента выбора шаблона для кабинета не обнаружено. Одноимённые
правила старого world editor не дают контракт совместимости и не должны
автоматически переноситься в комнаты. Не создавать фиктивный selector по
названию из нормативного словаря. Table/Search/Tabs и другие кандидаты
не объявляются готовыми компонентами без отдельного аудита потребителей.

## Решения для следующего этапа

1. Сначала единая библиотека материалов: light surface с общими tokens, локальный
   scope для панели, header/actions/list/quota/status/preview и адаптивная компоновка.
2. Сохранить public RoomMaterials API и HTTP-контракт; перерисовать UI внутри
   его существующего жизненного цикла. Не заменять контроллер AppDialog целиком.
3. Подтверждение удаления согласовать как вариант существующего Dialog-паттерна,
   с точными последствиями остановки активного показа, без потери revision guards.
4. Панель показа и увеличенный экран — следующий отдельно согласуемый этап.
   Новые продуктовые функции, редактор, API и Three.js не входят в эти этапы.

## Проверка этого этапа

PASS: статическое чтение API/consumers/CSS, поиск через rg, проверка существования
указанных путей, Markdown-ссылок и git diff --check. Приложение не изменялось.
NOT RUN: новые браузерные/визуальные/accessibility проверки; на этом этапе
они не запускались. Предыдущая регрессия токенов описана отдельно в
[token-integration.md](token-integration.md) и не заменяет проверку будущего UI.
