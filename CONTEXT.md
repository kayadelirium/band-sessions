# Band Sessions — контекст проекта

## Цель

Desktop-приложение для синхронизации работы над музыкальными проектами (Logic Pro / GarageBand) между двумя участниками группы через общую папку на Яндекс.Диске. Решает проблему случайной перезаписи: два участника могут открыть один и тот же проект одновременно — приложение добавляет лок-механизм поверх обычной синхронизации файлов.

## Технологический стек

- **Tauri 2** — десктоп-обёртка (Rust + системный WebView/Safari). Выбран вместо Electron из-за малого размера (~15 МБ против ~150 МБ)
- **React + TypeScript** — интерфейс
- **Rust** — вся бизнес-логика: чтение/запись файлов, сканирование папок, file watcher
- **Node.js 20** — требуется (зафиксировано в `.nvmrc`)

Плагины Tauri: `tauri-plugin-dialog` (выбор папки), `tauri-plugin-opener` (открыть файл в приложении).

## Структура папок на Яндекс.Диске

```
/Группа/                        ← корень группы, путь задаётся в настройках
  projects/                     ← создаётся пользователем вручную или кнопкой в UI
    sunset/                     ← папка = один трек, slug = "sunset"
      main.logicx               ← вариант проекта (любое имя + расширение)
      experimental.logicx       ← ещё один вариант
      .session.json             ← стейт трека (лок, версия, последний редактор)
      history.json              ← история сессий (append-only)
    night-drive/
      night-drive.band
      .session.json
      history.json
  shared/                       ← создаётся той же кнопкой, приложение не трогает
```

### `.session.json` (один на трек)

```json
{
  "locked_by": "kaya",
  "locked_at": "2026-06-22T14:30:00Z",
  "version": 4,
  "last_editor": "artem",
  "last_edited_at": "2026-06-21T18:00:00Z",
  "last_note": "свёл барабаны"
}
```

Это единственный синхронизируемый стейт на трек. Когда партнёр что-то делает — меняется этот файл, Яндекс.Диск его синхронизирует, watcher подхватывает и обновляет UI.

### `history.json` (один на трек)

```json
[
  { "version": 4, "by": "kaya", "at": "2026-06-22T15:00:00Z", "note": "добавил бас" },
  { "version": 3, "by": "artem", "at": "2026-06-21T18:00:00Z", "note": null }
]
```

Append-only, записывается при `release_lock`. Показывается на отдельной странице истории трека.

## Локальный конфиг (не синхронизируется)

Хранится в `~/Library/Application Support/com.kayadelirium.band-sessions/local_config.json`:

```json
{
  "user_name": "kaya",
  "group_folder_path": "/Users/kaya/Yandex Disk/Группа"
}
```

Поле `group_folder_path` имеет алиас `shared_folder_path` для совместимости со старыми сохранёнными конфигами.

## Rust-команды (`src-tauri/src/lib.rs`)

| Команда | Что делает |
|---|---|
| `get_local_config` | Читает локальный конфиг |
| `save_local_config(config)` | Сохраняет локальный конфиг |
| `init_workspace` | Создаёт `projects/` и `shared/` если нет |
| `scan_tracks` | Сканирует `projects/`, читает `.session.json` каждого трека |
| `read_state` | Алиас `scan_tracks` (для совместимости) |
| `create_project(slug)` | Создаёт новую папку трека + `.session.json` |
| `init_project(slug)` | Создаёт `.session.json` в существующей папке без него |
| `acquire_lock(slug, note?)` | Ставит лок текущего пользователя |
| `release_lock(slug, note?)` | Снимает лок, инкрементирует версию, пишет историю |
| `force_release_lock(slug)` | Снимает чужой лок без инкремента версии |
| `get_history(slug)` | Читает `history.json` трека (в обратном порядке) |
| `open_track_path(slug, variant)` | Открывает конкретный файл-вариант в DAW через `open` |
| `start_watcher` | Запускает file watcher на папке `projects/` |

## File watcher

Используется крейт `notify` (v6). Запускается при старте (`start_watcher`), смотрит на `projects/` рекурсивно. Дебаунс 3 секунды на каждый уникальный путь.

- **`.session.json` изменился** → `scan_projects()` → emit `"tracks-updated"` на фронтенд
- **`.logicx`/`.band` файл изменился** → если текущий пользователь держит лок на этот трек: инкремент версии + запись в историю + обновление `last_editor`. Emit `"tracks-updated"`.

Watcher хранится в Tauri managed state (`WatcherHandle`) — без этого он дропнется и перестанет работать.

## Фронтенд-компоненты (`src/`)

| Файл | Назначение |
|---|---|
| `App.tsx` | Главный компонент, навигация между экранами (Setup / список треков / история), запуск watcher, listener на `tracks-updated` |
| `Setup.tsx` | Экран первого запуска и настроек: имя пользователя + папка группы |
| `TrackCard.tsx` | Карточка трека: статус, раскрываемый список вариантов, кнопки лока |
| `TrackHistory.tsx` | Страница истории конкретного трека |
| `types.ts` | TypeScript-типы (TrackState, Lock, LastActivity, HistoryEntry, LocalConfig) |
| `utils.ts` | Форматирование дат, slug → display name, длительность лока |

### TrackState (что фронтенд получает от Rust)

```typescript
interface TrackState {
  slug: string;              // имя папки трека
  variants: string[];        // все .logicx/.band файлы в папке
  version: number;
  lock: Lock | null;
  last_activity: LastActivity | null;
  file_modified_at: string | null;  // самый свежий mtime среди вариантов
  uninitialized: boolean;    // папка есть, .session.json нет
  disabled: boolean;         // .session.json есть, вариантов нет
}
```

## Навигация

State-based (без react-router, не нужен для двух экранов):
- `historySlug !== null` → показываем TrackHistory
- `needsSetup || showSetup` → показываем Setup
- иначе → главный список треков

## Флоу лока

1. Участник А нажимает "начать работу" → `acquire_lock` пишет `locked_by/locked_at` в `.session.json`
2. Яндекс.Диск синхронизирует `.session.json` участнику Б
3. Watcher участника Б видит изменение `.session.json` → emit `tracks-updated` → UI обновляется, трек показывает "занято / А"
4. Участник А нажимает "завершить" (опционально вводит комментарий) → `release_lock`: снимает лок, `version++`, пишет `last_editor/last_edited_at/last_note`, аппендит в `history.json`
5. Яндекс.Диск синхронизирует → участник Б видит трек свободным

Лок — кооперативный (не технически принудительный). Есть аварийный сброс чужого лока (`force_release_lock`) без инкремента версии.

## Варианты проектов

Один трек (папка) может содержать несколько `.logicx`/`.band` файлов с произвольными именами — это "варианты". Приложение сканирует все файлы по расширению. Лок — на всю папку, не на отдельный вариант. В UI варианты раскрываются по клику, каждый можно открыть в DAW.

## Дистрибуция

Для двух человек — без подписи: партнёр открывает через правый клик → "Открыть" (обход Gatekeeper). Команда сборки: `npm run tauri build`.

## Известные ограничения

- Лок мягкий: если оба нажмут "начать работу" до того как Яндекс.Диск синхронизировал `.session.json`, оба получат лок. На практике не проблема для двух участников.
- `.logicx` на macOS — это директория-пакет. `notify` её видит, но события могут быть на внутренних файлах. Дебаунс решает шум от множественных событий.
