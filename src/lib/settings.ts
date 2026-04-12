/**
 * User preferences.
 *
 * Backed by IndexedDB (see db.ts) with an in-memory cache so that hot paths
 * — tuner loop at 60 Hz, transcription inner loops — can read values without
 * awaiting a promise. Call loadSettings() once on app boot; after that,
 * useSettings() / getSettings() returns synchronous snapshots.
 *
 * All fields have safe defaults so the app works before the store is loaded.
 */

import { getSetting, setSetting } from './db';
import { DEFAULT_TUNING, TUNINGS } from './guitarTunings';
import { DEFAULT_COST_WEIGHTS, type FretCostWeights } from './midi-to-tab';
import type { Tuning } from './types';

export interface AppSettings {
  /** Concert A reference pitch in Hz. Default 440; some players use 442/432. */
  a4Hz: number;
  /** Default tuning used in Transcriber / Viewer when nothing else is set. */
  defaultTuningId: string;
  /** Override for the Demucs backend URL (empty = use VITE_DEMUCS_API or localhost:8000). */
  demucsUrl: string;
  /** Viterbi cost weights for tab placement. */
  costWeights: FretCostWeights;
}

export const DEFAULT_SETTINGS: AppSettings = {
  a4Hz: 440,
  defaultTuningId: 'standard',
  demucsUrl: '',
  costWeights: { ...DEFAULT_COST_WEIGHTS },
};

// In-memory cache. Populated by loadSettings(). Safe to read at any time.
let cache: AppSettings = { ...DEFAULT_SETTINGS };

/** Notify-on-change subscribers (for useSettings hook). */
type Listener = (s: AppSettings) => void;
const listeners = new Set<Listener>();

/** Load every setting from IndexedDB into the cache. Call once on boot. */
export async function loadSettings(): Promise<AppSettings> {
  const loaded: AppSettings = {
    a4Hz: await getSetting('a4Hz', DEFAULT_SETTINGS.a4Hz),
    defaultTuningId: await getSetting(
      'defaultTuningId',
      DEFAULT_SETTINGS.defaultTuningId,
    ),
    demucsUrl: await getSetting('demucsUrl', DEFAULT_SETTINGS.demucsUrl),
    costWeights: await getSetting(
      'costWeights',
      DEFAULT_SETTINGS.costWeights,
    ),
  };
  cache = loaded;
  publishToGlobals();
  notify();
  return loaded;
}

/**
 * Expose a handful of settings on globalThis so modules with hard import
 * constraints (like demucs-client, which avoids importing settings to dodge
 * a cycle) can read them. Only a small whitelist of fields is published.
 */
function publishToGlobals(): void {
  (globalThis as { __OMNITAB_DEMUCS_URL__?: string }).__OMNITAB_DEMUCS_URL__ =
    cache.demucsUrl;
}

/** Synchronous snapshot. Always returns the latest cached value. */
export function getSettings(): AppSettings {
  return cache;
}

/**
 * Update one or more settings. Writes to IndexedDB and notifies listeners.
 * Pass only the fields you want to change.
 */
export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  cache = { ...cache, ...patch };
  publishToGlobals();
  notify();
  // Persist each changed field individually so the on-disk shape stays flat.
  for (const [key, value] of Object.entries(patch)) {
    await setSetting(key, value);
  }
}

/** Reset to defaults. Useful if the user bricks their cost weights. */
export async function resetSettings(): Promise<void> {
  await updateSettings(DEFAULT_SETTINGS);
}

function notify(): void {
  for (const l of listeners) l(cache);
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Look up the tuning object corresponding to `defaultTuningId`. */
export function getDefaultTuning(): Tuning {
  return TUNINGS[cache.defaultTuningId] ?? DEFAULT_TUNING;
}
