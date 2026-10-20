# Design Tokens

**Статус:** approved values / CSS location unverified. **Архитектура:** два уровня Primitive → Semantic → Components. Компоненты используют семантические имена, не HEX.

## 1. Primitive Tokens
Исходная палитра из согласованного редизайна:

| Primitive | Значение | Описание |
|---|---|---|
| `--primitive-white` | `#FFFFFF` | Поверхности |
| `--primitive-slate-25` | `#F8FAFB` | Фон |
| `--primitive-ink-900` | `#172638` | Основной текст |
| `--primitive-slate-500` | `#8292A3` | Референс вторичного текста: проверить контраст |
| `--primitive-green-500` | `#00A878` | Фирменный зелёный |
| `--primitive-green-700` | `#008C68` | Более тёмный зелёный, **не считать заведомо AA** |
| `--primitive-green-50` | `#E8F7F2` | Выбор/подсветка |
| `--primitive-border` | `#E9EEF1` | Декоративные границы |
| `--primitive-hover` | `#F2F6F5` | Нейтральный hover |
| `--primitive-red-500` | `#EF4444` | Ошибки/опасные действия |
| `--primitive-amber-500` | `#F59E0B` | Предупреждения |
| `--primitive-blue-500` | `#3B82F6` | Информация |

**ВАЖНО:** палитра — брендовые исходные цвета, но не все их сочетания проходят WCAG 2.2 AA. Белый текст на `#00A878` не достигает 4.5:1. При реализации подобрать и измерить доступные пары перед применением к кнопкам и тексту. Не объявлять соответствие AA без проверки.

## 2. Semantic Tokens
| Семантическое имя | База / назначение |
|---|---|
| `--color-app-bg` | `--primitive-slate-25` |
| `--color-surface` | `--primitive-white` |
| `--color-header-bg`, `--color-sidebar-bg` | `--color-surface` |
| `--color-text-primary` | `--primitive-ink-900` |
| `--color-text-secondary` | цвет с подтверждённым контрастом ≥4.5:1 на его фоне; не обязательно референсный `#8292A3` |
| `--color-primary-brand` | `--primitive-green-500`, для логотипа/некритичного оформления |
| `--color-primary-action` | проверенный фон primary-кнопки для контрастного текста ≥4.5:1 |
| `--color-primary-action-text` | проверенный цвет надписи primary-кнопки |
| `--color-primary-hover` | проверенный hover с сохранением контраста |
| `--color-selection-bg` | `--primitive-green-50` |
| `--color-selection-text` | проверенный тёмный зелёный |
| `--color-border-subtle` | `--primitive-border`, только несущественное разграничение |
| `--color-border-control` | проверенная граница поля с контрастом ≥3:1, если нужна для различимости |
| `--color-focus-ring` | измеренно контрастное состояние фокуса, проверенное по WCAG 2.2 |
| `--color-danger-*`, `--color-warning-*`, `--color-info-*`, `--color-success-*` | пары фон/текст/иконка с проверенным контрастом |

Примитивы `#22C55E` (успех), `#EF4444`, `#F59E0B`, `#3B82F6` допустимы как референсы предыдущего ТЗ, **не как автоматическое разрешение использовать белый текст поверх них**.

### Пример правильной связи CSS (не копировать поверх существующей системы без аудита)
```css
:root {
  --primitive-white: #fff;
  --primitive-slate-25: #F8FAFB;
  --primitive-green-500: #00A878;
  --primitive-ink-900: #172638;
  --color-app-bg: var(--primitive-slate-25);
  --color-surface: var(--primitive-white);
  --color-text-primary: var(--primitive-ink-900);
  --color-primary-brand: var(--primitive-green-500);
  /* --color-primary-action / --color-primary-action-text: подбираются и
     фиксируются после измерения контрастности на аудите. */
}
```
Не создавать фиктивные «финальные» переменные для непроверенных контрастных сочетаний.

## 3. Типографика
- Основной шрифт **Inter** с поддержкой кириллицы; fallback: `system-ui, sans-serif`.
- Размеры: XS 12, SM 14, Base 16, LG 18, XL 24, 2XL 28 px.
- Контрольные роли: PageTitle 28/600/1.25; SectionTitle 24/600/1.3; CardTitle 18/600/1.35; Body 14/400/1.5; FormControl 16/400/1.4; Meta 12/400/1.4, если достаточна читаемость.
- Текст не фиксировать по высоте; поддерживать увеличение до 200%, без обрезания.

## 4. Spacing, dimensions, radius
- Базовая единица **4 px**. Шкала: 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- `space-1=4`, `space-2=8`, `space-3=12`, `space-4=16`, `space-5=20`, `space-6=24`, `space-8=32`, `space-12=48` (в px).
- Button/Input на десктопе: 40 px; touch target: целевой 44 × 44 px; большие/малые варианты согласовать через контракт.
- Радиусы: control 8 px; card/dropdown 12 px; dialog 16 px.
- Sidebar: expanded 248 px, collapsed 64 px; Header 64 px.
- Card inner padding 20–24 px; grid gap 24 px (допустимо 20 px); desktop page padding 32 px.
- Плотность **Balanced**. Нет разрозненных локальных значений там, где доступен токен.

## 5. Elevation / boundaries
- Белые панели на светлом фоне; тонкие границы `--color-border-subtle`; лёгкие тени только для иерархии.
- Тени не единственное средство различить активное поле/компонент. Утверждать набор elevation-токенов после аудита, не создавать уникальную тень в каждой карточке.

## 6. Токены движения
См. [motion.md](motion.md): 100/150/200/300 ms, согласованные кривые; не заводить локальные времена без причины.

## 7. Миграция
Перед созданием файлов CSS определить реальные используемые CSS/custom properties, тему, библиотеку компонентов. Сопоставить существующие переменные с семантическими, избегать второй параллельной системы. Изменения общих токенов проверять на всех потребителях, см. [qa.md](qa.md).
