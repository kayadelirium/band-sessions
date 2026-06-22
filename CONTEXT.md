# Band Sessions — контекст проекта

## Цель

Desktop-приложение для синхронизации работы над музыкальными проектами (Logic Pro / GarageBand) между двумя участниками группы через общую папку на Яндекс.Диске. Решает проблему случайной перезаписи: приложение отслеживает кто сейчас работает над каждым треком, автоматически определяя это по активности DAW.

## Технологический стек

- **Tauri 2** — десктоп-обёртка (Rust + системный WebView/Safari). Выбран вместо Electron из-за малого размера (~15 МБ против ~150 МБ)
- **React + TypeScript** — интерфейс
- **Rust** — вся бизнес-логика: чтение/запись файлов, сканирование папок, file watcher
- **Node.js 20** — требуется (зафиксировано в `.nvmrc`)

Плагины Tauri: `tauri-plugin-dialog` (выбор папки), `tauri-plugin-opener` (открыть файл в приложении).

## Структура папок на Яндекс.Диске

```
/Группа/                        ← корень группы, путь задаётся в настройках
  projects/                     ← создаётся вручную или кнопкой в UI
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
  "last_note": "сохранил night-drive.band"
}
```

Это единственный синхронизируемый стейт на трек. Когда партнёр открывает DAW — меняется этот файл, Яндекс.Диск его синхронизирует, watcher подхватывает и обновляет UI.

### `history.json` (один на трек)

```json
[
  { "version": 4, "by": "kaya", "at": "2026-06-22T15:00:00Z", "note": "сохранил main.logicx" },
  { "version": 3, "by": "kaya", "at": "2026-06-22T14:50:00Z", "note": "закрыл DAW" },
  { "version": 2, "by": "artem", "at": "2026-06-21T18:00:00Z", "note": "закрыл DAW" }
]
```

Append-only. Записывается автоматически: при каждом сохранении в DAW и при закрытии DAW.

## Локальный конфиг (не синхронизируется)

Хранится в `~/Library/Application Support/com.kayadelirium.band-sessions/local_config.json`:

```json
{
  "user_name": "kaya",
  "group_folder_path": "/Users/kaya/Yandex Disk/Группа"
}
```

Поле `group_folder_path` имеет алиас `shared_folder_path` для совместимости со старыми конфигами.

## Rust-команды (`src-tauri/src/lib.rs`)

| Команда | Что делает |
|---|---|
| `get_local_config` | Читает локальный конфиг |
| `save_local_config(config)` | Сохраняет локальный конфиг |
| `init_workspace` | Создаёт `projects/` и `shared/` если нет |
| `scan_tracks` | Сканирует `projects/`, читает `.session.json` каждого трека |
| `create_project(slug)` | Создаёт новую папку трека + `.session.json` |
| `init_project(slug)` | Создаёт `.session.json` в существующей папке без него |
| `get_history(slug)` | Читает `history.json` трека (в обратном порядке) |
| `open_track_path(slug, variant)` | Открывает конкретный файл-вариант в DAW через `open` |
| `start_watcher` | Запускает (или перезапускает) file watcher на папке `projects/` |

Команды `acquire_lock`, `release_lock`, `force_release_lock` зарегистрированы в Tauri но не вызываются из UI — весь лок-флоу автоматический.

## File watcher

Крейт `notify` (v6), FSEvents на macOS. Запускается при старте и после `init_workspace`. Перезапуск убивает предыдущий watcher (`WatcherHandle` в managed state).

### Обработка событий

**`.session.json` изменился** → trailing-edge debounce 5с → `scan_projects()` → emit `"tracks-updated"`

**Файл внутри `.band`/`.logicx` изменился** — пакеты на macOS являются директориями, события приходят на внутренние файлы. Обнаруживается проверкой предков пути (`path.ancestors()`):

1. Первое событие на трек без лока → `auto_acquire_if_free()` → лок ставится автоматически, emit `"tracks-updated"`
2. События накапливаются, `pending_tracks[slug]` обновляется при каждом событии
3. После 5 секунд тишины И не ранее 30 секунд с предыдущей обработки → `handle_project_file_changed()`: `version++`, запись в `history.json` с нотой `"сохранил {variant}"`, emit `"tracks-updated"`

**Закрытие DAW** — каждые 5 секунд, пока есть auto-locked треки, `pgrep -x GarageBand/Logic Pro X` → если DAW не найден → `auto_release_lock()`: `version++`, нота `"закрыл DAW"`, лок снимается, emit `"tracks-updated"`

### Параметры дебаунса

| Параметр | Значение | Зачем |
|---|---|---|
| `tick` | 500мс | Частота проверки очереди событий |
| `debounce` | 5с | Тишина после которой считаем save завершённым |
| `min_process_interval` | 30с | Минимум между двумя обработками одного трека — предотвращает дублирование из-за фоновых записей GarageBand |
| `daw_check_interval` | 5с | Частота проверки процессов DAW |

## Фронтенд-компоненты (`src/`)

| Файл | Назначение |
|---|---|
| `App.tsx` | Главный компонент, навигация (Setup / треки / история), запуск watcher, listener на `tracks-updated`. После `init_workspace` перезапускает watcher. |
| `Setup.tsx` | Первый запуск и настройки: имя + папка группы. Не создаёт структуру автоматически. |
| `TrackCard.tsx` | Карточка трека: статус, варианты с кнопкой "открыть", кнопка "история". Нет ручных кнопок лока. |
| `TrackHistory.tsx` | Страница истории трека |
| `types.ts` | TypeScript-типы |
| `utils.ts` | Форматирование дат, slug → display name, длительность лока |

### TrackState

```typescript
interface TrackState {
  slug: string;
  variants: string[];        // все .logicx/.band файлы в папке
  version: number;
  lock: Lock | null;
  last_activity: LastActivity | null;
  file_modified_at: string | null;  // максимальный mtime среди вариантов (рекурсивно)
  uninitialized: boolean;   // папка без .session.json
  disabled: boolean;        // .session.json есть, вариантов нет
}
```

## Флоу лока (полностью автоматический)

1. Участник А открывает DAW → DAW пишет во внутренние файлы `.band`/`.logicx` → watcher видит событие → `auto_acquire_if_free`: `locked_by = "kaya"` в `.session.json`
2. Яндекс.Диск синхронизирует `.session.json` → watcher участника Б видит изменение → UI: **"kaya работает прямо сейчас"**
3. Участник А сохраняет в DAW → через 5с тишины (но не чаще раза в 30с) → `version++`, нота "сохранил main.band" в историю
4. Участник А закрывает DAW → через ≤5с `pgrep` не находит процесс → `auto_release_lock`: лок снимается, `version++`, нота "закрыл DAW"
5. Яндекс.Диск синхронизирует → участник Б видит трек свободным

## Особенности реализации

- **`.logicx`/`.band` — директории-пакеты** на macOS. Events приходят на файлы внутри, не на пакет целиком. Поиск предка с нужным расширением через `path.ancestors()`
- **`get_latest_mtime` рекурсивный** — mtime директории-пакета не обновляется при изменении содержимого, поэтому берём максимальный mtime по всем файлам внутри
- **`pgrep`** проверяет локальные процессы, не партнёрские — каждый участник сам решает когда закрыл DAW
- **Race condition**: если оба одновременно откроют трек до синхронизации `.session.json` — оба получат лок. Принято как допустимо для двух людей

## Дистрибуция

Без подписи: открывать через правый клик → "Открыть" (обход Gatekeeper). Сборка: `npm run tauri build`.
