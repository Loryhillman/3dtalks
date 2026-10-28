# Design QA — обязательный контроль после каждой UI-задачи

**Принцип:** тест «пройден» только если он действительно запущен/выполнен и имеется свидетельство. Автоматический accessibility scan не подтверждает полное WCAG 2.2 AA.

## Матрица проверки
| Направление | Проверить | Результат |
|---|---|---|
| Visual | tokens, typography, spacing, cards, variants, focus | pass/fail/not run |
| Functional | изменённые пользовательские сценарии, серверные ошибки, rights, dirty state | pass/fail/not run |
| Responsive | 375×812, 430×932, 768×1024, 1280×800, 1920×1080; промежуточные | pass/fail/not run |
| Accessibility | axe + ручная клавиатура, диалоги, фокус, контраст, zoom | pass/fail/not run |
| Localization | RU и EN, длинные строки, aria-labels, переключение языка | pass/fail/not run |
| States | loading, empty, search-empty, error, success, offline/stale, pending | pass/fail/not run |
| Regression | затронутые существующие сценарии; build/tests/lint | pass/fail/not run |

## Минимальный workflow
1. Определить реально существующие команды test/lint/build; не выдумывать.
2. Проверить diff: изменены только разрешённые файлы/области; нет случайной логики Three.js/backend.
3. Запустить имеющиеся unit/integration/e2e и сборку, если окружение допускает.
4. Проверить UI в браузере на целевых ширинах при возможности, сделать скриншоты для сопоставления.
5. Выполнить доступность автоматикой и вручную, измерить контрастность фактических CSS цветовых пар.
6. Проверить RU/EN, ошибки API, состояние без сети и восстановление.
7. Устранить блокирующие нарушения; подготовить отчёт.

## Блокирующие критерии
- Сломаны существующие сценарии/авторизация/API.
- Новые критические препятствия клавиатуре, фокусу, доступности или основные AA-нарушения.
- Недоступно главное действие на mobile; горизонтальное переполнение обычной страницы.
- Потеря введённых данных при ошибке сохранения/закрытии вопреки dirty guard.
- Реализован неутверждённый принципиально новый стиль/компонент.

## Шаблон отчёта
```md
## 3DTalks — Design QA Report
- Задача:
- Изменённые файлы:
- Использованные токены и компоненты:
- Visual QA: PASS / FAIL / NOT RUN (доказательства)
- Functional QA: PASS / FAIL / NOT RUN (сценарии)
- Responsive QA: PASS / FAIL / NOT RUN (viewport-ы)
- Accessibility QA: PASS / FAIL / NOT RUN (axe + ручные проверки; контраст)
- RU/EN: PASS / FAIL / NOT RUN
- UI states / offline: PASS / FAIL / NOT RUN
- Build / tests / lint: PASS / FAIL / NOT RUN (команды и результаты)
- Блокеры и оставшиеся риски:
- Документация / CHANGELOG: обновлены или не требовалось
- Итог: готово / не готово / частично проверено
```

Если браузер, окружение или тестовые данные недоступны, писать **NOT RUN**, объясняя причину и конкретный ручной план. Нельзя писать «всё проверено» на основании статического осмотра кода.


### Видео 1.6.0 Experimental: дополнительная QA, 27 октября 2026

PASS: шесть native 1080p viewers в отдельных Chromium contexts, медленная сеть
и visibility recovery; общий и увеличенный canvas используют один decoder.
PASS: полная /play с настоящим GLB-офисом/аватарами и видео, pause/seek,
очистка source и owned GPU на выходе. HTTP/session в этом GLB-тесте — fixtures;
SQL/JWT/WS и HTTPS/Secure-cookie проверены отдельным интеграционным сценарием.
PASS: прежние presentation/materials 3 языка/7 viewport/focus/zoom.
Статус Experimental сохраняется: реальные мобильные/Safari/полный WCAG-аудит
не выполнены. Точные условия и ограничения — ROOM_MEDIA_V2_PLAN.md, раздел 12.


### Импорт PPTX 1.7.0 Experimental, 28 октября 2026

PASS: прежняя RoomMaterials, gated accept/capabilities, conversion/quota notice,
PDF from PPTX во всех viewport, auto preview настоящего результата LibreOffice
через реальный PDF.js canvas. Сохранены прежние 3 языка/7 viewport/200% text,
focus/Escape/cancel/offline/выход. Просмотрены mobile/desktop screenshots.
HTTP библиотеки в Chromium — fixture; настоящий PostgreSQL/JWT/Multer/worker/
PDF pipeline проверен отдельным Docker integration. Не присваивать Stable:
реальные пользовательские decks/устройства/полный accessibility-аудит и
нагрузка на VPS остаются этапом 6. Детали — ROOM_MEDIA_V2_PLAN.md, раздел 13.
