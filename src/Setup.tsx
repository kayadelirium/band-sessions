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
    <div className="setup">
      <h1 className="setup__title">band sessions</h1>
      <p className="setup__subtitle">настройка для этого устройства</p>

      <div className="setup__field">
        <label>твоё имя</label>
        <input
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="kaya"
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
          <button className="btn btn--ghost" onClick={pickFolder}>
            выбрать
          </button>
        </div>
        <span className="setup__hint">
          внутри должна быть папка projects/ — создай её заранее в Finder
        </span>
      </div>

      <div className="setup__actions">
        <button className="btn btn--primary" onClick={handleSave}>
          сохранить
        </button>
        {onCancel && (
          <button className="btn btn--ghost" onClick={onCancel}>
            отмена
          </button>
        )}
      </div>
    </div>
  );
}
