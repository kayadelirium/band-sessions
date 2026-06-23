import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NoteEntry, TrackState } from "./types";
import { trackDisplayName, formatDate } from "./utils";

interface Props {
  slug: string;
  currentUser: string;
  onBack: () => void;
  onUpdate: (tracks: TrackState[]) => void;
}

export default function TrackNotes({ slug, currentUser, onBack, onUpdate }: Props) {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingAt, setEditingAt] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");

  useEffect(() => {
    invoke<NoteEntry[]>("get_notes", { slug })
      .then(setNotes)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [slug]);

  async function handleAdd() {
    const text = noteInput.trim();
    if (!text) { setAdding(false); return; }
    setSaving(true);
    try {
      const tracks = await invoke<TrackState[]>("add_track_note", { slug, text });
      onUpdate(tracks);
      const updated = await invoke<NoteEntry[]>("get_notes", { slug });
      setNotes(updated);
      setAdding(false);
      setNoteInput("");
    } catch (e) {
      alert(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(at: string) {
    const text = editInput.trim();
    if (!text) { setEditingAt(null); return; }
    try {
      const tracks = await invoke<TrackState[]>("update_note", { slug, at, text });
      onUpdate(tracks);
      const updated = await invoke<NoteEntry[]>("get_notes", { slug });
      setNotes(updated);
      setEditingAt(null);
    } catch (e) {
      alert(String(e));
    }
  }

  function startEdit(entry: NoteEntry) {
    setEditingAt(entry.at);
    setEditInput(entry.text);
    setAdding(false);
  }

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
          <span className="breadcrumb__item breadcrumb__item--active">заметки</span>
        </div>
        <div className="header-right">
          {!loading && notes.length > 0 && (
            <span className="history__count-badge">{notes.length} заметок</span>
          )}
          <button className="btn-icon btn-icon--add" title="добавить заметку" onClick={() => { setNoteInput(""); setAdding(true); setEditingAt(null); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </header>

      <main>
        {adding && (
          <div className="track-card__note-edit" style={{ marginBottom: 16 }}>
            <textarea
              autoFocus
              className="note-textarea"
              placeholder="заметка..."
              value={noteInput}
              rows={3}
              onChange={(e) => setNoteInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd();
                if (e.key === "Escape") { setAdding(false); setNoteInput(""); }
              }}
            />
            <div className="track-card__note-edit-actions">
              <span className="track-card__note-hint">⌘↵ сохранить · esc отмена</span>
              <button className="btn-icon btn-icon--accent" title="сохранить" onClick={handleAdd} disabled={saving}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
              <button className="btn-icon" title="отмена" onClick={() => { setAdding(false); setNoteInput(""); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {loading && <p style={{ color: "var(--text-dim)", fontSize: 13 }}>загрузка...</p>}
        {!loading && notes.length === 0 && !adding && (
          <p style={{ color: "var(--text-dim)", fontSize: 13 }}>заметок пока нет</p>
        )}
        {!loading && notes.length > 0 && (
          <div className="history__list">
            {notes.map((entry, i) => (
              <div key={i} className="history-entry note-entry">
                <div className="history-entry__header">
                  <span className={`history-entry__by ${entry.by === currentUser ? "note-author--me" : "note-author--other"}`}>{entry.by}</span>
                  <span className="history-entry__date">{formatDate(entry.at)}</span>
                </div>
                {editingAt === entry.at ? (
                  <div className="track-card__note-edit">
                    <textarea
                      autoFocus
                      className="note-textarea"
                      value={editInput}
                      rows={3}
                      onChange={(e) => setEditInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleUpdate(entry.at);
                        if (e.key === "Escape") setEditingAt(null);
                      }}
                    />
                    <div className="track-card__note-edit-actions">
                      <span className="track-card__note-hint">⌘↵ сохранить · esc отмена</span>
                      <button className="btn-icon btn-icon--accent" title="сохранить" onClick={() => handleUpdate(entry.at)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </button>
                      <button className="btn-icon" title="отмена" onClick={() => setEditingAt(null)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="note-entry__bottom">
                    <div className="history-entry__note">{entry.text}</div>
                    <div className="note-entry__actions">
                      <button
                        className="btn-icon btn-icon--note-action btn-edit-note"
                        title="редактировать"
                        onClick={() => startEdit(entry)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        className="btn-icon btn-icon--note-action btn-delete-note"
                        title="удалить"
                        onClick={async () => {
                          const updated = await invoke<NoteEntry[]>("delete_note", { slug, at: entry.at });
                          setNotes(updated);
                          const tracks = await invoke<TrackState[]>("scan_tracks");
                          onUpdate(tracks);
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
