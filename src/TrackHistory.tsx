import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HistoryEntry } from "./types";
import { trackDisplayName, formatDate } from "./utils";

interface Props {
  slug: string;
  onBack: () => void;
}

export default function TrackHistory({ slug, onBack }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<HistoryEntry[]>("get_history", { slug })
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="app">
      <header className="app__header">
        <div className="history__title-row">
          <button className="btn btn--ghost btn--sm" onClick={onBack}>
            ← назад
          </button>
          <span className="app__title">{trackDisplayName(slug)}</span>
        </div>
        <span className="history__count">
          {loading ? "" : `${entries.length} записей`}
        </span>
      </header>

      <main className="history__list">
        {loading && <div className="empty">загрузка...</div>}

        {!loading && entries.length === 0 && (
          <div className="empty">
            история пуста — записи появятся после первого завершения работы
          </div>
        )}

        {entries.map((entry, i) => (
          <div key={i} className="history-entry">
            <div className="history-entry__header">
              <span className="history-entry__version">v{entry.version}</span>
              <span className="history-entry__by">{entry.by}</span>
              <span className="history-entry__date">{formatDate(entry.at)}</span>
            </div>
            {entry.note && (
              <div className="history-entry__note">{entry.note}</div>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
