import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TrackState } from "./types";
import { trackDisplayName, formatDate, formatLockDuration } from "./utils";

interface Props {
  track: TrackState;
  currentUser: string;
  onUpdate: (tracks: TrackState[]) => void;
  onOpenHistory: () => void;
}

export default function TrackCard({ track, currentUser, onUpdate, onOpenHistory }: Props) {
  const [showVariants, setShowVariants] = useState(false);
  const [loading, setLoading] = useState(false);

  const isLockedByMe = track.lock?.held_by === currentUser;
  const isLockedByOther = track.lock !== null && !isLockedByMe;
  const name = trackDisplayName(track.slug);

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
        </div>
      </div>

      {showVariants && track.variants.length > 0 && (
        <div className="track-card__variants">
          {track.variants.map((v) => (
            <div key={v} className="variant-row">
              <span className="variant-row__name">{v}</span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => invoke("open_track_path", { slug: track.slug, variant: v })}
              >
                открыть
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="track-card__status">
        {track.uninitialized && (
          <span className="status status--uninit">не инициализирован</span>
        )}
        {!track.uninitialized && track.disabled && (
          <span className="status status--disabled">вариантов не найдено</span>
        )}
        {!track.uninitialized && !track.disabled && !track.lock && (
          <span className="status status--free">свободно</span>
        )}
        {isLockedByMe && (
          <span className="status status--mine">
            ты работаешь — {formatLockDuration(track.lock!.since)}
          </span>
        )}
        {isLockedByOther && (
          <span className="status status--locked">
            {track.lock!.held_by} работает прямо сейчас
          </span>
        )}
      </div>

      {track.file_modified_at && !track.uninitialized && (
        <div className="track-card__saved">
          сохранён {formatLockDuration(track.file_modified_at)} назад
        </div>
      )}

      {track.last_activity && !track.uninitialized && (
        <div className="track-card__activity">
          {track.last_activity.by}
          {track.last_activity.note && ` — ${track.last_activity.note}`}
          {track.last_activity.at && `, ${formatDate(track.last_activity.at)}`}
        </div>
      )}

      <div className="track-card__actions">
        {track.uninitialized && (
          <button className="btn btn--ghost" onClick={handleInit} disabled={loading}>
            инициализировать
          </button>
        )}
        {!track.uninitialized && (
          <button className="btn btn--ghost" onClick={onOpenHistory}>
            история
          </button>
        )}
      </div>
    </div>
  );
}
