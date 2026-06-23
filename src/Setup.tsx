import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { LocalConfig } from "./types";

interface Props {
  initial: LocalConfig;
  onSave: (config: LocalConfig) => void;
  onCancel?: () => void;
}

export default function Setup({ initial, onSave, onCancel }: Props) {
  const [userName, setUserName] = useState(initial.user_name);
  const [folderPath, setFolderPath] = useState(initial.group_folder_path);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setFolderPath(selected);
    }
  }

  async function handleSave() {
    if (!userName.trim()) {
      alert("Введи имя");
      return;
    }
    if (!folderPath.trim()) {
      alert("Выбери папку группы");
      return;
    }
    const config: LocalConfig = {
      user_name: userName.trim(),
      group_folder_path: folderPath.trim(),
    };
    await invoke("save_local_config", { config });
    onSave(config);
  }

  return (
    <div className="app">
      <header className="app__header app__header--3col">
        {onCancel ? (
          <button className="btn-back" title="назад" onClick={onCancel}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        ) : (
          <div />
        )}
        <div className="breadcrumbs">
          <span className="breadcrumb__item breadcrumb__item--dim">Band Sessions</span>
          <span className="breadcrumb__sep">›</span>
          <span className="breadcrumb__item breadcrumb__item--active">настройки</span>
        </div>
        <div className="header-right">
          <button className="btn-icon btn-icon--accent" title="сохранить" onClick={handleSave}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
          </button>
        </div>
      </header>

      <main className="setup__fields">
        <div className="setup__field">
          <label>твоё имя</label>
          <input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            placeholder="kaya"
            autoFocus={!userName}
          />
        </div>

        <div className="setup__field">
          <label>папка группы на Яндекс.Диске</label>
          <div className="setup__folder-row">
            <input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="/Users/kaya/Yandex.Disk/Группа"
              readOnly
            />
            <button className="btn-icon" title="выбрать папку" onClick={pickFolder}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
          </div>
          {!folderPath && (
            <span className="setup__hint">
              внутри должна быть папка projects/ — создай её заранее в Finder
            </span>
          )}
        </div>
      </main>
    </div>
  );
}
