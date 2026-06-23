import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TrackState } from "./types";
import { trackDisplayName, formatDate, formatLockDuration } from "./utils";

interface Props {
  track: TrackState;
  currentUser: string;
  onUpdate: (tracks: TrackState[]) => void;
  onOpenHistory: () => void;
  onOpenNotes: () => void;
}

export default function TrackCard({ track, currentUser, onUpdate, onOpenHistory, onOpenNotes }: Props) {
  const [showVariants, setShowVariants] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [isNewNote, setIsNewNote] = useState(false);

  const isLockedByMe = track.lock?.held_by === currentUser;
  const isLockedByOther = track.lock !== null && !isLockedByMe;
  const name = trackDisplayName(track.slug);

  async function handleSaveNote() {
    const text = noteInput.trim();
    if (!text) { setEditingNote(false); return; }
    setLoading(true);
    try {
      const tracks = await invoke<TrackState[]>(
        !isNewNote && track.track_note_at ? "update_note" : "add_track_note",
        !isNewNote && track.track_note_at
          ? { slug: track.slug, at: track.track_note_at, text }
          : { slug: track.slug, text }
      );
      onUpdate(tracks);
      setEditingNote(false);
      setNoteInput("");
      setIsNewNote(false);
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleInit() {
    setLoading(true);
    try {
      const tracks = await invoke<TrackState[]>("init_project", { slug: track.slug });
      onUpdate(tracks);
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={[
      "track-card",
      track.uninitialized ? "track-card--uninit" : "",
      isLockedByMe ? "track-card--mine" : "",
      isLockedByOther ? "track-card--locked" : "",
    ].filter(Boolean).join(" ")}>

      <div className="track-card__header">
        <span className="track-card__name">{name}</span>
        <div className="track-card__header-right">
          {!track.uninitialized && (
            <span className="track-card__version">v{track.version}</span>
          )}
          {track.variants.length > 0 && (
            <button
              className="btn-variants"
              onClick={() => setShowVariants((v) => !v)}
            >
              {track.variants.length} {track.variants.length === 1 ? "вариант" : "варианта"}
              <span className="btn-variants__arrow">{showVariants ? "▲" : "▼"}</span>
            </button>
          )}
          {track.uninitialized && (
            <button className="btn-icon btn-icon--add" title="подключить трек" disabled={loading} onClick={handleInit}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </button>
          )}
          {(track.uninitialized || track.disabled) && (
            <button
              className="btn-icon btn-icon--danger"
              title="удалить трек"
              disabled={loading}
              onClick={async () => {
                if (!confirm(`Удалить «${name}»? Папка трека будет удалена полностью.`)) return;
                setLoading(true);
                try {
                  const tracks = await invoke<TrackState[]>("delete_project", { slug: track.slug });
                  onUpdate(tracks);
                } catch (e) {
                  alert(String(e));
                } finally {
                  setLoading(false);
                }
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {showVariants && track.variants.length > 0 && (
        <div className="track-card__variants">
          {track.variants.map((v) => (
            <div key={v} className="variant-row">
              <span className="variant-row__name">{v}</span>
              <button
                className="btn-icon"
                title={`открыть ${v} в DAW`}
                onClick={() => invoke("open_track_path", { slug: track.slug, variant: v })}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {!track.uninitialized && !editingNote && (
        <div className="track-card__note-block">
          <span className="track-card__note-label">последняя заметка</span>
          {track.track_note ? (
            <button
              className="track-card__note-text"
              title="редактировать"
              onClick={() => { setNoteInput(track.track_note!); setIsNewNote(false); setEditingNote(true); }}
            >
              {track.track_note}
            </button>
          ) : (
            <span className="track-card__note-empty">заметок пока нет</span>
          )}
          <div className="track-card__note-actions">
            <button className="btn-icon" title="заметки" onClick={onOpenNotes}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <button className="btn-icon btn-icon--add" title="добавить заметку" onClick={() => { setNoteInput(""); setIsNewNote(true); setEditingNote(true); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {editingNote && (
        <div className="track-card__note-edit">
          <textarea
            autoFocus
            className="note-textarea"
            placeholder="заметка..."
            value={noteInput}
            rows={3}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSaveNote();
              if (e.key === "Escape") { setEditingNote(false); setNoteInput(""); setIsNewNote(false); }
            }}
          />
          <div className="track-card__note-edit-actions">
            <span className="track-card__note-hint">⌘↵ сохранить · esc отмена</span>
            <button className="btn-icon btn-icon--accent" title="сохранить" onClick={handleSaveNote} disabled={loading}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
            <button className="btn-icon" title="отмена" onClick={() => { setEditingNote(false); setNoteInput(""); setIsNewNote(false); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {!track.uninitialized && (
        <div className="track-card__activity-block">
          <span className="track-card__note-label">последние действия</span>
          <div className="track-card__activity-status">
            {track.disabled && <span className="status status--disabled">файлы проекта не найдены</span>}
            {!track.disabled && !track.lock && <span className="status status--free">свободно</span>}
            {isLockedByMe && (
              <span className="status status--mine">ты работаешь · {formatLockDuration(track.lock!.since)}</span>
            )}
            {isLockedByOther && (
              <span className="status status--locked">{track.lock!.held_by} работает прямо сейчас</span>
            )}
            {track.file_modified_at && (
              <span className="track-card__saved">сохранено {formatLockDuration(track.file_modified_at)} назад</span>
            )}
          </div>
          {track.last_activity && (
            <div className="track-card__activity">
              {track.last_activity.by}
              {track.last_activity.note && ` — ${track.last_activity.note}`}
              {track.last_activity.at && `, ${formatDate(track.last_activity.at)}`}
            </div>
          )}
          <div className="track-card__note-actions">
            <button className="btn-icon" title="история версий трека" onClick={onOpenHistory}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {track.uninitialized && (
        <div className="track-card__status">
          <span className="status status--uninit">не подключён</span>
        </div>
      )}
    </div>
  );
}
