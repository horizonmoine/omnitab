/**
 * Core domain types shared across the app.
 *
 * Pipeline overview:
 *   audio → basic-pitch → DetectedNote[] → TabNote[] → alphaTex → AlphaTab renders
 */

// ───── Detection & transcription ─────

/** A note detected by basic-pitch (polyphonic pitch detection). */
export interface DetectedNote {
  startTimeSeconds: number;
  durationSeconds: number;
  /** MIDI pitch, 0–127. Low E guitar = 40, middle C = 60, high E guitar = 64. */
  pitchMidi: number;
  /** Note amplitude 0–1, useful for filtering ghost detections. */
  amplitude: number;
  pitchBends?: number[];
}

export interface TranscriptionParams {
  onsetThreshold: number;
  frameThreshold: number;
  minNoteLengthMs: number;
}

export const DEFAULT_TRANSCRIPTION_PARAMS: TranscriptionParams = {
  onsetThreshold: 0.5,
  frameThreshold: 0.3,
  minNoteLengthMs: 58,
};

// ───── Guitar-specific types ─────

export interface Tuning {
  id: string;
  name: string;
  /** Open-string MIDI, ordered from string 6 (low/thick) → string 1 (high/thin). */
  strings: number[];
}

export interface FretPosition {
  /** 0 = string 6 (low E in standard), 5 = string 1 (high E). */
  stringIndex: number;
  fret: number;
}

export interface TabNote extends FretPosition {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
}

export interface Transcription {
  notes: TabNote[];
  tuning: Tuning;
  capo: number;
  durationSeconds: number;
  tempoBpm?: number;
}

// ───── Songsterr search results ─────

export interface SongsterrHit {
  id: number;
  title: string;
  artist: { name: string };
  tracks?: Array<{ instrument: string; tuning?: string }>;
}

// ───── Library ─────

export type TabKind = 'original' | 'cover' | 'generated' | 'my-playing';

export interface LibraryTab {
  id?: number;
  title: string;
  artist: string;
  kind: TabKind;
  /** Original extension (gp, gp5, gpx, musicxml, alphaTex). */
  format: string;
  /** Raw binary or text of the tab file. */
  data: ArrayBuffer | string;
  /** Optional companion audio file (MP3 blob) for original-audio sync. */
  audio?: Blob;
  addedAt: number;
  lastOpenedAt?: number;
  favorite: boolean;
  /** Free tags — e.g. ['fingerstyle', 'drop-d', 'metal']. */
  tags: string[];
  /**
   * Origin URL for tabs imported via /api/fetch-tab or transcribed from a
   * YouTube link. Surfaced in the library row as a "↗ Source" link so the
   * user can re-find or re-download the original. Optional — local-file
   * imports and from-scratch transcriptions don't have one.
   *
   * No schema migration needed: IndexedDB tolerates new optional fields on
   * existing records (they simply read back as undefined).
   */
  sourceUrl?: string;
}

// ───── Setlists ─────

/**
 * An ordered playlist of library tabs. Used for gigs, practice sessions,
 * or any scenario where the user wants to flow through multiple songs
 * without manually loading each one.
 *
 * `tabIds` references LibraryTab.id values — we deliberately don't embed
 * the tab data here so renaming/editing a tab updates everywhere it's
 * referenced. The trade-off: deleting a tab from the library leaves a
 * dangling id in the setlist. The Setlists UI handles this by skipping
 * missing tabs and showing a "tab introuvable" placeholder.
 */
export interface Setlist {
  id?: number;
  name: string;
  /** Ordered library tab IDs. Order matters. */
  tabIds: number[];
  createdAt: number;
  updatedAt: number;
}

// ───── Tuner ─────

export interface TunerReading {
  /** Detected fundamental frequency in Hz. */
  frequency: number;
  /** Nearest note name, e.g. "E2". */
  note: string;
  /** MIDI number of the nearest note. */
  midi: number;
  /** Cent deviation from the nearest note (−50..+50). Positive = sharp. */
  cents: number;
  /** Signal clarity 0–1 (pitchy returns this). Filter out readings below ~0.9. */
  clarity: number;
}
