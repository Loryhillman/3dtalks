# Component System

## Трёхуровневая модель
1. **Primitives:** Button, IconButton, Input, Textarea, Select, Checkbox, Switch, Badge, Tooltip.
2. **Composites:** Dialog, DropdownMenu, FormField, SearchBar, DataTable, Tabs, Breadcrumbs, Accordion, Toast, Alert, Skeleton, EmptyState, Pagination.
3. **Domain:** RoomCard, RoomStatus, TemplateCard, InviteLinkField, RoomCreationDialog и аналогичные **только при фактической реализации/потребности**.

**Статус перечисления:** нормативный словарь и план возможных компонентов, а не заявление об их наличии в проекте. Фактический реестр — [component-registry.md](component-registry.md).

## Контракт документации КАЖДОГО компонента
- Имя, уровень, назначение, файл реализации (после аудита), lifecycle status.
- Публичный API/props/events, владельцы состояния; контролируемый/uncontrolled режим если есть.
- Варианты, размеры, токены и допустимая композиция.
- Состояния default/hover/focus/pressed/disabled/loading/error, где применимы.
- Взаимодействие мышью, touch, клавиатурой, ARIA и управление фокусом.
- Responsive: что меняется в четырех диапазонах.
- Локализация RU/EN, длинные надписи, текст для screen reader.
- Loading/empty/error/success, если компонент получает данные.
- Правильное/неправильное использование, ограничения, тест-кейсы.

## Референсные спецификации
### Button / IconButton (Primitive)
- Варианты: Primary (доступная пара foreground/background), Secondary (с рамкой), Ghost, Destructive.
- Default height 40 px desktop; при мобильном взаимодействии эффективная touch target 44×44 px; радиус 8 px.
- Primary: одно ключевое действие в области; destructive — красный и точная надпись («Удалить комнату»).
- Loading блокирует повторный submit, но не отменяет доступного названия; disabled имеет понятную причину и не используется вместо разрешённого error.
- Для icon-only: доступное имя (`aria-label` или эквивалент), tooltip не единственный источник названия.
- Keyboard: Tab focus, Enter/Space activation; фокус визуально различим.
- Нельзя применять референс `#00A878` с белым текстом без измерения контраста; токены см. [tokens.md](tokens.md).

### Input / Textarea / Select / Checkbox / Switch (Primitive)
- Label всегда программно связан с контролом; placeholder не заменяет label.
- Высота однострочного поля ~40 px desktop, радиус 8 px; корректный focus/invalid/disabled.
- Ошибка показывается под полем и связана через `aria-describedby`/эквивалент.
- Текущее введённое значение сохраняется при ошибке API; в сложных формах dirty guard.
- Keyboard и touch, надлежащие типы полей, autocomplete там, где уместно.

### Badge / Tooltip (Primitive)
- Badge сообщает статус текстом и/или иконкой, не только цветом.
- Tooltip для пояснения, не для обязательных действий; открывается и с клавиатуры, при отсутствии hover функция доступна.

### Dialog / DropdownMenu / Popover (Composite)
- Диалог имеет заголовок, описание, правильное начальное управление фокусом, удержание фокуса, возврат при закрытии.
- Esc/overlay dismissal только если не приводит к незаметной потере изменённых данных.
- Опасные операции: конкретное описание последствия, нейтральная отмена, красное подтверждение, ожидание запроса, ошибка внутри окна.
- Dropdown открывается и управляется клавиатурой, не уходит за край viewport.

### Toast / Alert / Skeleton / EmptyState (Composite)
- Toast: справа снизу, максимум три; success 4 с, info 5 с, error до закрытия. Системные сообщения доступны assistive technology без навязчивых повторов.
- Skeleton повторяет геометрию контента, не создаёт layout shift; reduced motion.
- EmptyState содержит ясное объяснение и релевантное действие. Пустой поиск отличается от отсутствия данных.
- Alert используется для длительных проблем (offline), если кратковременный Toast недостаточен.

### DataTable / SearchBar / Pagination (Composite)
- Таблица: headers, сортировка с доступным состоянием, пустая выборка, loading/error, адаптивный fallback.
- Поиск → фильтры → сортировка → дополнительные действия. Учитывать очистку и сохранение параметров только в рамках реальных требований задачи.

### RoomCard / RoomStatus / TemplateCard (Domain)
- RoomCard: статическое изображение шаблона 16:9 + fallback; реальные название, участники/лимит, статус, войти, приглашение, меню вторичных действий.
- RoomStatus: текстовый индикатор открыто/закрыто и т.п. согласно backend, не выводить фальшивую доступность.
- TemplateCard: изображение, название, selected/focus/disabled; если API выбора пока нет, не делать фиктивный переключатель.
- Точно не помещать второй WebGL-renderer в карточку для обложки.

## Правила переиспользования
1. Найти компонент в реальном коде и registry.
2. Переиспользовать; если требуется совместимое уточнение варианта — проверить визуальный контракт.
3. Новый принципиальный компонент: proposal → approval → implementation → tests → docs → CHANGELOG.
4. Не внедрять новую библиотеку UI и не дублировать дизайн-токены без согласования.
5. Любой компонент с lifecycle Deprecated нельзя применять в новой странице.
