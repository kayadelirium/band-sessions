import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NoteEntry, TrackState } from "./types";
import { trackDisplayName, formatDate } from "./utils";

interface Props {
  slug: string;
  onBack: () => void;
  onUpdate: (tracks: TrackState[]) => void;
}

export default function TrackNotes({ slug, onBack, onUpdate }: Props) {
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
      <header className="app__header">
        <div className="history__title-row">
          <button className="btn btn--ghost btn--sm" onClick={onBack}>← назад</button>
          <span className="app__title">{trackDisplayName(slug)}</span>
          <span className="history__count">заметки</span>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => { setNoteInput(""); setAdding(true); setEditingAt(null); }}>
          + заметка
        </button>
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
              <button className="btn btn--primary btn--sm" onClick={handleAdd} disabled={saving}>сохранить</button>
              <button className="btn btn--ghost btn--sm" onClick={() => { setAdding(false); setNoteInput(""); }}>отмена</button>
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
              <div key={i} className="history-entry">
                <div className="history-entry__header">
                  <span className="history-entry__by">{entry.by}</span>
                  <span className="history-entry__date">{formatDate(entry.at)}</span>
                  <div className="note-entry__actions">
                    <button
                      className="btn-delete-note btn-edit-note"
                      onClick={() => startEdit(entry)}
                    >
                      изменить
                    </button>
                    <button
                      className="btn-delete-note"
                      onClick={async () => {
                        const updated = await invoke<NoteEntry[]>("delete_note", { slug, at: entry.at });
                        setNotes(updated);
                        const tracks = await invoke<TrackState[]>("scan_tracks");
                        onUpdate(tracks);
                      }}
                    >
                      удалить
                    </button>
                  </div>
                </div>

                {editingAt === entry.at ? (
                  <div className="track-card__note-edit" style={{ marginTop: 6 }}>
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
                      <button className="btn btn--primary btn--sm" onClick={() => handleUpdate(entry.at)}>сохранить</button>
                      <button className="btn btn--ghost btn--sm" onClick={() => setEditingAt(null)}>отмена</button>
                    </div>
                  </div>
                ) : (
                  <div className="history-entry__note">{entry.text}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
