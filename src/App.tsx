import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LocalConfig, TrackState } from "./types";
import TrackCard from "./TrackCard";
import TrackHistory from "./TrackHistory";
import TrackNotes from "./TrackNotes";
import Setup from "./Setup";
import "./App.css";

export default function App() {
  const [config, setConfig] = useState<LocalConfig | null>(null);
  const [tracks, setTracks] = useState<TrackState[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [historySlug, setHistorySlug] = useState<string | null>(null);
  const [notesSlug, setNotesSlug] = useState<string | null>(null);
  const [newProjectSlug, setNewProjectSlug] = useState<string | null>(null); // null = скрыт, "" = открыт
  const [initingWorkspace, setInitingWorkspace] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    invoke<LocalConfig>("get_local_config")
      .then((cfg) => setConfig(cfg))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const refreshTracks = useCallback(async () => {
    try {
      const result = await invoke<TrackState[]>("scan_tracks");
      setTracks(result);
    } catch (e) {
      console.error("refresh error:", e);
    }
  }, []);

  useEffect(() => {
    if (!config?.group_folder_path) return;
    refreshTracks().then(() => {
      invoke("start_watcher").catch(console.error);
    });
  }, [config, refreshTracks]);

  useEffect(() => {
    if (!config?.group_folder_path) return;
    const unlisten = listen<TrackState[]>("tracks-updated", (event) => {
      if (event.payload) setTracks(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [config]);

  function handleConfigSave(cfg: LocalConfig) {
    setConfig(cfg);
    setShowSetup(false);
  }

  async function handleCreateProject() {
    const slug = (newProjectSlug ?? "").trim();
    if (!slug) return;
    try {
      const tracks = await invoke<TrackState[]>("create_project", { slug });
      setTracks(tracks);
      setNewProjectSlug(null);
    } catch (e) {
      alert(String(e));
    }
  }

  if (loading) return <div className="loading">загрузка...</div>;

  const needsSetup = !config?.user_name || !config?.group_folder_path;

  if (historySlug) {
    return <TrackHistory slug={historySlug} onBack={() => setHistorySlug(null)} />;
  }

  if (notesSlug) {
    return <TrackNotes slug={notesSlug} onBack={() => setNotesSlug(null)} onUpdate={setTracks} />;
  }

  if (needsSetup || showSetup) {
    return (
      <Setup
        initial={config ?? { user_name: "", group_folder_path: "" }}
        onSave={handleConfigSave}
        onCancel={needsSetup ? undefined : () => setShowSetup(false)}
      />
    );
  }

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">band sessions</span>
        <div className="app__meta">
          <span className="app__user">{config!.user_name}</span>
          <button className="btn btn--ghost btn--sm app__meta-btn" onClick={refreshTracks}>
            обновить
          </button>
          <button className="btn btn--ghost btn--sm app__meta-btn" onClick={() => setShowSetup(true)}>
            настройки
          </button>
          <div className="app__menu-wrap">
            <button className="btn btn--ghost btn--sm app__menu-btn" onClick={() => setMenuOpen(o => !o)}>
              ···
            </button>
            {menuOpen && (
              <div className="app__dropdown" onMouseLeave={() => setMenuOpen(false)}>
                <button className="app__dropdown-item" onClick={() => { refreshTracks(); setMenuOpen(false); }}>
                  обновить
                </button>
                <button className="app__dropdown-item" onClick={() => { setShowSetup(true); setMenuOpen(false); }}>
                  настройки
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="app__tracks">
        {newProjectSlug !== null && (
          <div className="new-project-row">
            <input
              autoFocus
              placeholder="название-проекта"
              value={newProjectSlug}
              onChange={(e) => setNewProjectSlug(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateProject();
                if (e.key === "Escape") setNewProjectSlug(null);
              }}
            />
            <button className="btn btn--primary" onClick={handleCreateProject}>
              создать
            </button>
            <button className="btn btn--ghost" onClick={() => setNewProjectSlug(null)}>
              отмена
            </button>
          </div>
        )}

        {tracks.length === 0 && newProjectSlug === null ? (
          <div className="empty">
            <p>треков не найдено</p>
            <p className="empty__hint">
              если папка <code>projects/</code> ещё не создана — создай её прямо сейчас
            </p>
            <button
              className="btn btn--primary"
              disabled={initingWorkspace}
              onClick={async () => {
                setInitingWorkspace(true);
                try {
                  await invoke("init_workspace");
                  await invoke("start_watcher");
                  await refreshTracks();
                  setNewProjectSlug("");
                } catch (e) {
                  alert(String(e));
                } finally {
                  setInitingWorkspace(false);
                }
              }}
              style={{ marginTop: 8 }}
            >
              {initingWorkspace ? "создаём…" : "создать структуру папок"}
            </button>
            <button
              className="btn btn--ghost"
              onClick={refreshTracks}
            >
              обновить
            </button>
          </div>
        ) : (
          <>
            {tracks.map((track) => (
              <TrackCard
                key={track.slug}
                track={track}
                currentUser={config!.user_name}
                onUpdate={setTracks}
                onOpenHistory={() => setHistorySlug(track.slug)}
                onOpenNotes={() => setNotesSlug(track.slug)}
              />
            ))}
            {newProjectSlug === null && (
              <button
                className="btn btn--ghost btn--new-project"
                onClick={() => setNewProjectSlug("")}
              >
                + новый проект
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
