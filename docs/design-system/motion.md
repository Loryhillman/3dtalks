# Motion System — строгая Subtle Motion

## Токены
| Token | Значение | Применение |
|---|---|---|
| `--motion-instant` | 100ms | немедленная визуальная реакция |
| `--motion-fast` | 150ms | кнопки, hover, dropdown |
| `--motion-normal` | 200ms | toast, sidebar, стандартный переход |
| `--motion-slow` | 300ms | сложные панели при необходимости |
| `--ease-standard` | `cubic-bezier(0.2,0,0,1)` | общий |
| `--ease-out` | `cubic-bezier(0,0,0.2,1)` | вход |
| `--ease-in` | `cubic-bezier(0.4,0,1,1)` | выход |

## Утверждённые Motion Patterns
- **Micro Feedback:** button/field hover 150 ms, меняются background/border; без подпрыгивания.
- **Surface Feedback:** карточка 180 ms (специфический согласованный token alias для surface), лёгкая граница/тень, без layout shift.
- **Layout Transition:** Sidebar 200 ms; при необходимости сложная панель до 300 ms.
- **Overlay Entrance:** Dialog fade + небольшой translate 180 ms; Dropdown fade/translate 150 ms.
- **Toast:** появление/выход 200 ms.
- **Skeleton:** мягкая пульсация 1500 ms, не агрессивное мерцание.
- **Навигация между страницами:** специальная анимация не обязательна.

Конкретные длительности 180/1500 ms — утверждённые исключения в именованных паттернах, а не разрешение произвольно добавлять локальные значения.

## Accessibility / performance
- Поддерживать `prefers-reduced-motion: reduce` и отключать несущественное движение без потери смысла.
- Предпочитать `transform`, `opacity`; анимации width возможны для Sidebar только при проверенной плавности.
- Не блокировать действия во время анимаций и не привязывать бизнес-событие к окончанию декорационного перехода.
- Никаких новых spring/bounce/parallax эффектов без отдельного согласования.
- Не затрагивать Three.js анимации.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
Перед включением глобальных правил проверить существующий CSS и последствия для индикаторов загрузки; смысловой статус должен быть доступен текстом и ARIA, а не движением.
