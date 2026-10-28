# Семантические токены: интеграция и проверка

Дата: 2026-10-20. Этап: токены, контрастность и область действия CSS.

> Этот отчёт фиксирует этап токенов. Последующее выделение native controls
> и шрифта, применение .meeting-ui к панели: [materials-redesign.md](materials-redesign.md).

## Файлы и подключение

`public/css/app-tokens.css` — единый источник токенов для `.app-ui` и
`.meeting-ui`. `public/css/app-ui.css` импортирует его в начале файла.
В HTML кабинета дополнительный stylesheet не нужен. Новых зависимостей нет.

`.meeting-ui` — зарезервированная область **отдельной HTML-панели**, а не
класс body переговорной. Сейчас на действующих панелях её ещё нет.
В следующем этапе панель должна подключать app-tokens.css непосредственно;
app-ui.css и app-shell.css в /play для этого подключать не нужно.
Файл токенов содержит только custom properties: не меняет фон, font, размеры,
расположение, pointer-events или стили canvas. Нельзя переносить их в :root
или добавлять `.app-ui` на body /play. Inter пока объявлен в app-ui.css;
его отдельное подключение для новых панелей предстоит выполнить в их этапе.

## Карта совместимости

| Новое семантическое имя | Источник текущего значения | Значение / назначение |
|---|---|---|
| `--color-primary-brand` | `--color-primary` | #00A878, бренд, не фон кнопки с белой надписью |
| `--color-primary-action` | `--color-action` | #007D59 |
| `--color-primary-action-text` | `--color-primary-foreground` | #FFFFFF |
| `--color-primary-hover` | `--color-action-hover` | #006B4C |
| `--color-primary-pressed` | `--color-action-pressed` | #005A40 |
| `--color-selection-bg` | `--color-nav-active` | #E8F7F2 |
| `--color-selection-text` | `--color-action-pressed` | #005A40 |
| `--color-border-subtle` | `--color-border` | #E9EEF1, декоративные разделители |
| `--color-border-control` | `--color-control-border` | #8292A3, на белом фоне поля |
| `--color-focus-ring` | `--color-action` | #007D59, внешний outline с отступом |
| `--color-text-secondary` | `--color-text-muted` | #596B7D; прежний #8292A3 остаётся primitive |

Поиск потребителей до изменения подтвердил: прежний `--color-text-secondary`
был только объявлен и не применялся. Все используемые старые имена сохранены.
Цвета surface, app-bg, primary и палитра вынесены в primitive tokens.
Статусные пары success/danger/info используют существующие цвета уведомлений;
warning #854D0E на #FFFBEB добавлен для будущего применения по стандарту.
Это не разрешает менять все существующие локальные стили за пределами этапа.

### Типографика и размеры

- Существующий кабинет сохраняет h1 28 px, h2/заголовки диалогов 22 px,
  h3 18 px, body/поля desktop 14 px, поля mobile 16 px.
- `--font-size-section-title: 24px` — роль новых заголовков разделов;
  не переопределяет h2 кабинета. `--font-size-dialog-title: 22px` сохраняет
  совместимость с уже выполненным редизайном.
- `--font-size-form-control: 16px` используется для мобильных полей;
  новые панели должны использовать эту роль и на desktop. Кнопки могут
  наследовать 14 px, как текущие кнопки кабинета.
- Высоты controls 40 px и mobile targets 44 px сохранены. Добавлены токены
  font family, размеров, spacing, dialog elevation и движения; длительности
  текущих переходов сохранены. Глобальных правил reduced motion нет;
  существующая обработка `.app-ui` продолжает действовать.

## Контраст по вычисленным цветам Chromium

Расчёт: относительная яркость sRGB, `(Lmax + 0.05) / (Lmin + 0.05)`.
Измерены итоговые цвета после разрешения CSS aliases, а не строки var().

| Пара foreground / background | Контраст | Порог |
|---|---:|---:|
| Основной текст / surface | 15.32:1 | 4.5:1 |
| Вторичный текст / surface | 5.49:1 | 4.5:1 |
| Вторичный текст / app-bg | 5.25:1 | 4.5:1 |
| Primary text / action | 5.15:1 | 4.5:1 |
| Primary text / hover | 6.55:1 | 4.5:1 |
| Selection text / selection bg | 7.50:1 | 4.5:1 |
| Danger text / danger bg | 5.98:1 | 4.5:1 |
| Info text / info bg | 6.22:1 | 4.5:1 |
| Success text / success bg | 4.66:1 | 4.5:1 |
| Warning text / warning bg | 6.61:1 | 4.5:1 |
| Control border / surface | 3.19:1 | 3:1 |
| Focus ring / surface | 5.15:1 | 3:1 |
| Focus ring / hover | 4.73:1 | 3:1 |
| Focus ring / selection bg | 4.66:1 | 3:1 |

Эти результаты относятся только к перечисленным непрозрачным парам.
Для других фонов, disabled/opacity, изображений и вложенных переопределений
нужна отдельная проверка. Декоративные border-subtle не подходят вместо
control border. Полное соответствие WCAG этим отчётом не подтверждается.

## Design QA

- PASS — `node scripts/test-rooms-design-browser.js`: до и после изменений,
  реальные HTML/JS/CSS с тестовыми API; формы, состояния, RU/EN/zh-CN,
  клавиатура, контраст, desktop/mobile и reduced motion по сценарию теста.
- PASS — `node scripts/test-room-materials-browser.js`: загрузки, PDF/изображения,
  отмена, клавиатура, выход; тестовые HTTP API.
- PASS — `node scripts/test-avatar-editor-browser.js`: GLB и редактор аватара,
  сохранение/перезагрузка и мобильная компоновка с тестовыми API.
- PASS — `node scripts/test-meeting-ui-browser.js`: границы панелей, чат,
  микрофон/клавиатура и посадка; транспорт имитирован.
- PASS — отдельная временная Chromium-проверка перечисленных 14 пар,
  16 px мобильного input и отсутствия токенов на :root/canvas. `.meeting-ui`
  сохраняет прозрачный фон, min-height 0 и унаследованный font без layout-стилей.
- PASS — сравнение PNG до/после: desktop и mobile create dialog полностью
  совпали; на mobile rooms отличались 26 из 3025620 значений цветовых каналов.
  Снимки desktop и mobile визуально просмотрены.
- PASS — `git diff --check` перед коммитом.
- NOT RUN — Safari, реальные сенсорные устройства, screen reader, полная
  WCAG-проверка, реальная БД, VPS и проверка общего показа двумя аккаунтами.

В этом этапе внешний вид материалов и презентации не перерабатывался.
Следующий согласуемый этап — реестр существующих компонентов и их контрактов.
