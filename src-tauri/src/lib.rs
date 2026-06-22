use chrono::Utc;
use notify::{recommended_watcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Lock {
    pub held_by: String,
    pub since: String,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LastActivity {
    pub by: String,
    pub at: String,
    pub note: Option<String>,
}

/// Что отправляем на фронтенд для каждого трека
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrackState {
    pub slug: String,
    pub variants: Vec<String>,
    pub version: u32,
    pub lock: Option<Lock>,
    pub last_activity: Option<LastActivity>,
    pub file_modified_at: Option<String>,
    pub track_note: Option<String>,
    pub track_note_at: Option<String>, // at последней заметки — для обновления
    pub uninitialized: bool,
    pub disabled: bool,
}

/// Что хранится в .session.json каждого трека
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct SessionJson {
    locked_by: Option<String>,
    locked_at: Option<String>,
    pub version: u32,
    last_editor: Option<String>,
    last_edited_at: Option<String>,
    last_note: Option<String>,
    track_note: Option<String>,
    track_note_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteEntry {
    pub by: String,
    pub at: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub version: u32,
    pub by: String,
    pub at: String,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct LocalConfig {
    #[serde(default)]
    pub user_name: String,
    // алиас для совместимости со старым форматом
    #[serde(alias = "shared_folder_path", default)]
    pub group_folder_path: String,
}

struct WatcherHandle(Mutex<Option<notify::RecommendedWatcher>>);

// ── Path helpers ──────────────────────────────────────────────────────────────

fn local_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("local_config.json"))
}

fn projects_path(group_folder: &str) -> PathBuf {
    PathBuf::from(group_folder).join("projects")
}

fn track_dir(group_folder: &str, slug: &str) -> PathBuf {
    projects_path(group_folder).join(slug)
}

fn session_json_path(group_folder: &str, slug: &str) -> PathBuf {
    track_dir(group_folder, slug).join(".session.json")
}

fn history_json_path(group_folder: &str, slug: &str) -> PathBuf {
    track_dir(group_folder, slug).join("history.json")
}

fn notes_json_path(group_folder: &str, slug: &str) -> PathBuf {
    track_dir(group_folder, slug).join("notes.json")
}

// ── IO helpers ────────────────────────────────────────────────────────────────

fn read_local_config(app: &AppHandle) -> Result<LocalConfig, String> {
    let path = local_config_path(app)?;
    if !path.exists() {
        return Ok(LocalConfig::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_local_config(app: &AppHandle, config: &LocalConfig) -> Result<(), String> {
    let path = local_config_path(app)?;
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn read_session(group_folder: &str, slug: &str) -> Result<SessionJson, String> {
    let path = session_json_path(group_folder, slug);
    if !path.exists() {
        return Ok(SessionJson::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_session(group_folder: &str, slug: &str, session: &SessionJson) -> Result<(), String> {
    let path = session_json_path(group_folder, slug);
    let raw = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn append_history(
    group_folder: &str,
    slug: &str,
    entry: HistoryEntry,
) -> Result<(), String> {
    let path = history_json_path(group_folder, slug);
    let mut history: Vec<HistoryEntry> = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        vec![]
    };
    history.push(entry);
    let raw = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

const TRACK_EXTENSIONS: &[&str] = &["logicx", "band"];

fn find_variants(dir: &PathBuf) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    let mut variants: Vec<String> = entries.flatten().filter_map(|e| {
        let path = e.path();
        let ext = path.extension()?.to_str()?;
        if TRACK_EXTENSIONS.contains(&ext) {
            Some(path.file_name()?.to_str()?.to_string())
        } else {
            None
        }
    }).collect();
    variants.sort();
    variants
}

fn get_latest_mtime(dir: &PathBuf, variants: &[String]) -> Option<String> {
    use std::time::SystemTime;
    fn walk_mtime(path: &PathBuf) -> Option<SystemTime> {
        let meta = fs::metadata(path).ok()?;
        if meta.is_dir() {
            fs::read_dir(path).ok()?.flatten()
                .filter_map(|e| walk_mtime(&e.path()))
                .max()
        } else {
            meta.modified().ok()
        }
    }
    let latest = variants.iter()
        .filter_map(|v| walk_mtime(&dir.join(v)))
        .max();
    latest.map(|t| {
        let dt: chrono::DateTime<Utc> = t.into();
        dt.to_rfc3339()
    })
}

fn session_to_track_state(slug: &str, session: &SessionJson, dir: &PathBuf) -> TrackState {
    let variants = find_variants(dir);
    let lock = session.locked_by.as_ref().map(|by| Lock {
        held_by: by.clone(),
        since: session.locked_at.clone().unwrap_or_default(),
        note: None,
    });
    let last_activity = session.last_editor.as_ref().map(|editor| LastActivity {
        by: editor.clone(),
        at: session.last_edited_at.clone().unwrap_or_default(),
        note: session.last_note.clone(),
    });
    let file_modified_at = get_latest_mtime(dir, &variants);
    let disabled = variants.is_empty();

    TrackState {
        slug: slug.to_string(),
        variants,
        version: session.version,
        lock,
        last_activity,
        file_modified_at,
        track_note: session.track_note.clone(),
        track_note_at: session.track_note_at.clone(),
        uninitialized: false,
        disabled,
    }
}

fn scan_projects(group_folder: &str) -> Vec<TrackState> {
    let projects = projects_path(group_folder);
    let Ok(entries) = fs::read_dir(&projects) else {
        return vec![];
    };

    let mut tracks: Vec<TrackState> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let slug = path.file_name()?.to_str()?.to_string();
            if slug.starts_with('.') {
                return None;
            }

            let session_path = path.join(".session.json");
            if !session_path.exists() {
                let variants = find_variants(&path);
                return Some(TrackState {
                    slug: slug.clone(),
                    variants,
                    version: 0,
                    lock: None,
                    last_activity: None,
                    file_modified_at: None,
                    track_note: None,
                    track_note_at: None,
                    uninitialized: true,
                    disabled: false,
                });
            }

            let raw = fs::read_to_string(&session_path).ok()?;
            let session: SessionJson = serde_json::from_str(&raw).unwrap_or_default();
            Some(session_to_track_state(&slug, &session, &path))
        })
        .collect();

    tracks.sort_by(|a, b| a.slug.cmp(&b.slug));
    tracks
}

// ── File watcher ──────────────────────────────────────────────────────────────

#[tauri::command]
fn start_watcher(app: AppHandle) -> Result<(), String> {
    let config = read_local_config(&app)?;
    if config.group_folder_path.is_empty() {
        return Ok(());
    }

    let group = config.group_folder_path.clone();
    let projects = projects_path(&group);

    // Убиваем старый watcher если есть
    *app.state::<WatcherHandle>().0.lock().unwrap() = None;

    if !projects.exists() {
        return Ok(());
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher =
        recommended_watcher(move |res| { let _ = tx.send(res); })
            .map_err(|e| e.to_string())?;

    watcher
        .watch(projects.as_path(), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *app.state::<WatcherHandle>().0.lock().unwrap() = Some(watcher);

    let app_thread = app.clone();
    let group_thread = group.clone();
    std::thread::spawn(move || {
        let debounce = Duration::from_secs(5);
        let tick = Duration::from_millis(500);
        let daw_check_interval = Duration::from_secs(5);

        let mut pending_tracks: HashMap<String, Instant> = HashMap::new();
        let mut last_variant: HashMap<String, String> = HashMap::new();
        let mut last_processed: HashMap<String, Instant> = HashMap::new(); // когда последний раз обрабатывали slug
        let mut pending_session = false;
        let mut session_last_event = Instant::now();
        let mut auto_locked: HashSet<String> = HashSet::new();
        let mut last_daw_check = Instant::now();
        let min_process_interval = Duration::from_secs(30);

        loop {
            match rx.recv_timeout(tick) {
                Ok(Ok(event)) => {
                    let projects_root = projects_path(&group_thread);
                    for path in event.paths {
                        let file_name = match path.file_name().and_then(|n| n.to_str()) {
                            Some(n) => n.to_string(),
                            None => continue,
                        };

                        if file_name == ".session.json" {
                            pending_session = true;
                            session_last_event = Instant::now();
                            continue;
                        }

                        // Находим компонент пути с расширением .band/.logicx
                        let variant_name = path.ancestors().find_map(|a| {
                            let ext = a.extension()?.to_str()?;
                            if TRACK_EXTENSIONS.contains(&ext) {
                                a.file_name()?.to_str().map(|s| s.to_string())
                            } else {
                                None
                            }
                        });

                        if variant_name.is_some() {
                            if let Ok(rel) = path.strip_prefix(&projects_root) {
                                if let Some(slug) = rel.components().next()
                                    .and_then(|c| c.as_os_str().to_str())
                                {
                                    if let Some(v) = variant_name {
                                        last_variant.insert(slug.to_string(), v);
                                    }
                                    if !auto_locked.contains(slug) {
                                        if auto_acquire_if_free(&app_thread, &group_thread, slug) {
                                            auto_locked.insert(slug.to_string());
                                        }
                                    }
                                    pending_tracks.insert(slug.to_string(), Instant::now());
                                }
                            }
                        }
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                _ => {}
            }

            let now = Instant::now();

            if pending_session && now.duration_since(session_last_event) >= debounce {
                pending_session = false;
                let tracks = scan_projects(&group_thread);
                let _ = app_thread.emit("tracks-updated", &tracks);
            }

            // Trailing-edge: обрабатываем треки когда события затихли И прошёл min_process_interval
            let ready: Vec<String> = pending_tracks.iter()
                .filter(|(slug, last_event)| {
                    let quiet = now.duration_since(**last_event) >= debounce;
                    let cooled = last_processed.get(*slug)
                        .map_or(true, |t| now.duration_since(*t) >= min_process_interval);
                    quiet && cooled
                })
                .map(|(s, _)| s.clone())
                .collect();

            for slug in ready {
                last_processed.insert(slug.clone(), now);
                pending_tracks.remove(&slug);
                let variant = last_variant.get(&slug).cloned();
                handle_project_file_changed(&app_thread, &group_thread, &slug, variant.as_deref());
            }

            // Детектируем закрытие DAW → авто-снимаем лок
            if !auto_locked.is_empty() && now.duration_since(last_daw_check) >= daw_check_interval {
                last_daw_check = now;
                if !is_daw_running() {
                    for slug in auto_locked.drain() {
                        auto_release_lock(&app_thread, &group_thread, &slug);
                    }
                }
            }
        }
    });

    Ok(())
}

fn is_daw_running() -> bool {
    ["GarageBand", "Logic Pro X", "Logic Pro"]
        .iter()
        .any(|name| {
            std::process::Command::new("pgrep")
                .args(["-x", name])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        })
}

// Захватывает лок если трек свободен. Возвращает true если лок теперь наш.
fn auto_acquire_if_free(app: &AppHandle, group_folder: &str, slug: &str) -> bool {
    let Ok(config) = read_local_config(app) else { return false };
    let Ok(mut session) = read_session(group_folder, slug) else { return false };

    if let Some(ref by) = session.locked_by {
        // Уже занят — нашим или чужим
        return by == &config.user_name;
    }

    let now = Utc::now().to_rfc3339();
    session.locked_by = Some(config.user_name.clone());
    session.locked_at = Some(now);
    let _ = write_session(group_folder, slug, &session);

    let tracks = scan_projects(group_folder);
    let _ = app.emit("tracks-updated", &tracks);
    true
}

// Снимает лок автоматически (при закрытии DAW), пишет историю.
fn auto_release_lock(app: &AppHandle, group_folder: &str, slug: &str) {
    let Ok(config) = read_local_config(app) else { return };
    let Ok(mut session) = read_session(group_folder, slug) else { return };

    if session.locked_by.as_deref() != Some(&config.user_name) {
        return;
    }

    let now = Utc::now().to_rfc3339();
    let new_version = session.version + 1;

    let _ = append_history(
        group_folder,
        slug,
        HistoryEntry {
            version: new_version,
            by: config.user_name.clone(),
            at: now.clone(),
            note: Some("закрыл DAW".to_string()),
        },
    );

    session.version = new_version;
    session.last_editor = Some(config.user_name.clone());
    session.last_edited_at = Some(now);
    session.last_note = Some("закрыл DAW".to_string());
    session.locked_by = None;
    session.locked_at = None;
    let _ = write_session(group_folder, slug, &session);

    let tracks = scan_projects(group_folder);
    let _ = app.emit("tracks-updated", &tracks);
}

fn handle_project_file_changed(app: &AppHandle, group_folder: &str, slug: &str, variant: Option<&str>) {
    let Ok(config) = read_local_config(app) else { return };
    let Ok(mut session) = read_session(group_folder, slug) else { return };

    let held_by_me = session.locked_by.as_deref() == Some(&config.user_name);
    if held_by_me {
        let now = Utc::now().to_rfc3339();
        let new_version = session.version + 1;
        let note = Some(match variant {
            Some(v) => format!("сохранил {}", v),
            None => "сохранение".to_string(),
        });

        let _ = append_history(
            group_folder,
            slug,
            HistoryEntry {
                version: new_version,
                by: config.user_name.clone(),
                at: now.clone(),
                note: note.clone(),
            },
        );

        session.version = new_version;
        session.last_editor = Some(config.user_name.clone());
        session.last_edited_at = Some(now);
        session.last_note = note;
        let _ = write_session(group_folder, slug, &session);
    }

    let tracks = scan_projects(group_folder);
    let _ = app.emit("tracks-updated", &tracks);
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_local_config(app: AppHandle) -> Result<LocalConfig, String> {
    read_local_config(&app)
}

#[tauri::command]
fn save_local_config(app: AppHandle, config: LocalConfig) -> Result<(), String> {
    write_local_config(&app, &config)
}

/// Создаёт структуру группы (projects/ и shared/) если её нет
#[tauri::command]
fn init_workspace(app: AppHandle) -> Result<(), String> {
    let config = read_local_config(&app)?;
    if config.group_folder_path.is_empty() {
        return Err("путь к папке группы не задан".to_string());
    }
    fs::create_dir_all(projects_path(&config.group_folder_path)).map_err(|e| e.to_string())?;
    fs::create_dir_all(
        PathBuf::from(&config.group_folder_path).join("shared"),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Создаёт новый проект (папку + .session.json)
#[tauri::command]
fn create_project(app: AppHandle, slug: String) -> Result<Vec<TrackState>, String> {
    let config = read_local_config(&app)?;
    let dir = track_dir(&config.group_folder_path, &slug);
    if dir.exists() {
        return Err(format!("папка '{slug}' уже существует"));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let session = SessionJson { version: 1, ..Default::default() };
    write_session(&config.group_folder_path, &slug, &session)?;
    Ok(scan_projects(&config.group_folder_path))
}

/// Инициализирует .session.json в существующей папке без него
#[tauri::command]
fn init_project(app: AppHandle, slug: String) -> Result<Vec<TrackState>, String> {
    let config = read_local_config(&app)?;
    if session_json_path(&config.group_folder_path, &slug).exists() {
        return Err(format!("'{slug}' уже инициализирован"));
    }
    let session = SessionJson { version: 1, ..Default::default() };
    write_session(&config.group_folder_path, &slug, &session)?;
    Ok(scan_projects(&config.group_folder_path))
}

#[tauri::command]
fn scan_tracks(app: AppHandle) -> Result<Vec<TrackState>, String> {
    let config = read_local_config(&app)?;
    if config.group_folder_path.is_empty() {
        return Ok(vec![]);
    }
    Ok(scan_projects(&config.group_folder_path))
}

#[tauri::command]
fn read_state(app: AppHandle) -> Result<Vec<TrackState>, String> {
    scan_tracks(app)
}

#[tauri::command]
fn acquire_lock(
    app: AppHandle,
    slug: String,
    note: Option<String>,
) -> Result<Vec<TrackState>, String> {
    let config = read_local_config(&app)?;
    let group = &config.group_folder_path;
    let mut session = read_session(group, &slug)?;

    if let Some(ref by) = session.locked_by {
        return Err(format!("трек уже заблокирован: {by}"));
    }

    session.locked_by = Some(config.user_name.clone());
    session.locked_at = Some(Utc::now().to_rfc3339());
    // note on the lock is stored separately — save in session as a note field
    let _ = note; // lock note not in current SessionJson, ok for now

    write_session(group, &slug, &session)?;
    Ok(scan_projects(group))
}

#[tauri::command]
fn release_lock(
    app: AppHandle,
    slug: String,
    note: Option<String>,
) -> Result<Vec<TrackState>, String> {
    let config = read_local_config(&app)?;
    let group = &config.group_folder_path;
    let mut session = read_session(group, &slug)?;

    let new_version = session.version + 1;
    let now = Utc::now().to_rfc3339();

    append_history(
        group,
        &slug,
        HistoryEntry {
            version: new_version,
            by: config.user_name.clone(),
            at: now.clone(),
            note: note.clone(),
        },
    )?;

    session.locked_by = None;
    session.locked_at = None;
    session.version = new_version;
    session.last_editor = Some(config.user_name.clone());
    session.last_edited_at = Some(now);
    session.last_note = note;

    write_session(group, &slug, &session)?;
    Ok(scan_projects(group))
}

#[tauri::command]
fn force_release_lock(app: AppHandle, slug: String) -> Result<Vec<TrackState>, String> {
    let config = read_local_config(&app)?;
    let group = &config.group_folder_path;
    let mut session = read_session(group, &slug)?;

    session.locked_by = None;
    session.locked_at = None;

    write_session(group, &slug, &session)?;
    Ok(scan_projects(group))
}

#[tauri::command]
fn get_history(app: AppHandle, slug: String) -> Result<Vec<HistoryEntry>, String> {
    let config = read_local_config(&app)?;
    let path = history_json_path(&config.group_folder_path, &slug);
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut history: Vec<HistoryEntry> = serde_json::from_str(&raw).unwrap_or_default();
    history.reverse();
    Ok(history)
}

#[tauri::command]
fn open_track_path(app: AppHandle, slug: String, variant: String) -> Result<(), String> {
    let config = read_local_config(&app)?;
    let full_path = track_dir(&config.group_folder_path, &slug).join(&variant);
    std::process::Command::new("open")
        .arg(full_path.to_str().ok_or("invalid path")?)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_track_note(app: AppHandle, slug: String, text: String) -> Result<Vec<TrackState>, String> {
    let config = read_local_config(&app)?;
    let group = &config.group_folder_path;

    let entry_at = Utc::now().to_rfc3339();
    let entry = NoteEntry {
        by: config.user_name.clone(),
        at: entry_at.clone(),
        text: text.clone(),
    };

    // Дописываем в notes.json
    let notes_path = notes_json_path(group, &slug);
    let mut notes: Vec<NoteEntry> = if notes_path.exists() {
        let raw = fs::read_to_string(&notes_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        vec![]
    };
    notes.push(entry);
    fs::write(&notes_path, serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    // Обновляем track_note в .session.json для отображения на карточке
    let mut session = read_session(group, &slug)?;
    session.track_note = Some(text);
    session.track_note_at = Some(entry_at);
    write_session(group, &slug, &session)?;

    Ok(scan_projects(group))
}

#[tauri::command]
fn update_note(app: AppHandle, slug: String, at: String, text: String) -> Result<Vec<TrackState>, String> {
    let config = read_local_config(&app)?;
    let group = &config.group_folder_path;
    let path = notes_json_path(group, &slug);

    let mut notes: Vec<NoteEntry> = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        vec![]
    };

    if let Some(note) = notes.iter_mut().find(|n| n.at == at) {
        note.text = text.clone();
    }

    fs::write(&path, serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    // Обновляем track_note если это была последняя заметка
    let mut session = read_session(group, &slug)?;
    if session.track_note_at.as_deref() == Some(&at) {
        session.track_note = Some(text);
        write_session(group, &slug, &session)?;
    }

    Ok(scan_projects(group))
}

#[tauri::command]
fn delete_note(app: AppHandle, slug: String, at: String) -> Result<Vec<NoteEntry>, String> {
    let config = read_local_config(&app)?;
    let group = &config.group_folder_path;
    let path = notes_json_path(group, &slug);

    let mut notes: Vec<NoteEntry> = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        vec![]
    };

    notes.retain(|n| n.at != at);
    fs::write(&path, serde_json::to_string_pretty(&notes).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    // Обновляем track_note в session.json: берём последнюю оставшуюся заметку
    let mut session = read_session(group, &slug)?;
    session.track_note = notes.last().map(|n| n.text.clone());
    write_session(group, &slug, &session)?;

    let mut result = notes;
    result.reverse();
    Ok(result)
}

#[tauri::command]
fn get_notes(app: AppHandle, slug: String) -> Result<Vec<NoteEntry>, String> {
    let config = read_local_config(&app)?;
    let path = notes_json_path(&config.group_folder_path, &slug);
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut notes: Vec<NoteEntry> = serde_json::from_str(&raw).unwrap_or_default();
    notes.reverse();
    Ok(notes)
}

// ── App entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WatcherHandle(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_local_config,
            save_local_config,
            init_workspace,
            create_project,
            init_project,
            scan_tracks,
            read_state,
            acquire_lock,
            release_lock,
            force_release_lock,
            get_history,
            open_track_path,
            start_watcher,
            add_track_note,
            get_notes,
            update_note,
            delete_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
