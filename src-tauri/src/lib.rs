use chrono::Utc;
use notify::{recommended_watcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    pub variants: Vec<String>, // все .logicx/.band файлы в папке
    pub version: u32,
    pub lock: Option<Lock>,
    pub last_activity: Option<LastActivity>,
    pub file_modified_at: Option<String>, // самый свежий mtime среди вариантов
    pub uninitialized: bool, // папка есть, .session.json нет
    pub disabled: bool,      // .session.json есть, вариантов не найдено
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
    let latest = variants.iter().filter_map(|v| {
        fs::metadata(dir.join(v)).ok()?.modified().ok()
    }).max();
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
        let mut last_seen: HashMap<String, Instant> = HashMap::new();
        let debounce = Duration::from_secs(3);

        while let Ok(event) = rx.recv() {
            let Ok(event) = event else { continue };

            for path in event.paths {
                let file_name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };

                // Любое изменение .session.json → перечитываем все треки
                if file_name == ".session.json" {
                    let now = Instant::now();
                    if last_seen.get("session").map_or(true, |t| now.duration_since(*t) > debounce) {
                        last_seen.insert("session".to_string(), now);
                        let tracks = scan_projects(&group_thread);
                        let _ = app_thread.emit("tracks-updated", &tracks);
                    }
                    continue;
                }

                // Изменение любого варианта трека
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if TRACK_EXTENSIONS.contains(&ext) {
                    // Находим slug из пути
                    let projects_root = projects_path(&group_thread);
                    if let Ok(rel) = path.strip_prefix(&projects_root) {
                        if let Some(slug) = rel.components().next()
                            .and_then(|c| c.as_os_str().to_str())
                        {
                            let now = Instant::now();
                            if last_seen.get(slug).map_or(true, |t| now.duration_since(*t) > debounce) {
                                last_seen.insert(slug.to_string(), now);
                                handle_project_file_changed(&app_thread, &group_thread, slug);
                            }
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

fn handle_project_file_changed(app: &AppHandle, group_folder: &str, slug: &str) {
    let Ok(config) = read_local_config(app) else { return };
    let Ok(mut session) = read_session(group_folder, slug) else { return };

    let held_by_me = session.locked_by.as_deref() == Some(&config.user_name);
    if held_by_me {
        let now = Utc::now().to_rfc3339();
        let new_version = session.version + 1;
        let note = Some("сохранение в DAW".to_string());

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
