export interface Lock {
  held_by: string;
  since: string;
  note: string | null;
}

export interface LastActivity {
  by: string;
  at: string;
  note: string | null;
}

export interface TrackState {
  slug: string;
  variants: string[];
  version: number;
  lock: Lock | null;
  last_activity: LastActivity | null;
  file_modified_at: string | null;
  uninitialized: boolean;
  disabled: boolean;
}

export interface HistoryEntry {
  version: number;
  by: string;
  at: string;
  note: string | null;
}

export interface LocalConfig {
  user_name: string;
  group_folder_path: string;
}
