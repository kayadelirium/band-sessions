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
      <header className="app__header app__header--3col">
        <button className="btn-back" title="назад" onClick={onBack}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        <div className="breadcrumbs">
          <span className="breadcrumb__item breadcrumb__item--dim">Band Sessions</span>
          <span className="breadcrumb__sep">›</span>
          <button className="breadcrumb__item breadcrumb__link" title="вернуться к трекам" onClick={onBack}>{trackDisplayName(slug)}</button>
          <span className="breadcrumb__sep">›</span>
          <span className="breadcrumb__item breadcrumb__item--active">история</span>
        </div>

        <div className="header-right">
          {!loading && (
            <span className="history__count-badge">{entries.length} записей</span>
          )}
        </div>
      </header>

      <main className="history__list">
        {loading && <div className="empty">загрузка...</div>}

        {!loading && entries.length === 0 && (
          <div className="empty">
            история пуста — записи появятся после первого сохранения
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
