/**
 * IndexedDB wrapper (Dexie) for offline storage.
 *
 * Stores:
 *   - library: tabs (GP files, MusicXML, alphaTex) with metadata
 *   - settings: user preferences (A4 ref, default tuning, cost weights)
 *   - recordings: user recordings (WAV blobs) before transcription
 */

import Dexie, { type EntityTable } from 'dexie';
import type { LibraryTab } from './types';

export interface Setting {
  key: string;
  value: unknown;
}

export interface Recording {
  id?: number;
  name: string;
  blob: Blob;
  durationSeconds: number;
  createdAt: number;
}

class OmniTabDB extends Dexie {
  library!: EntityTable<LibraryTab, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  recordings!: EntityTable<Recording, 'id'>;

  constructor() {
    super('omnitab');
    this.version(1).stores({
      library: '++id, title, artist, kind, addedAt, favorite, *tags',
      settings: 'key',
      recordings: '++id, createdAt',
    });
  }
}

export const db = new OmniTabDB();

// ───── Library helpers ─────

export async function addTabToLibrary(
  tab: Omit<LibraryTab, 'id' | 'addedAt'>,
): Promise<number> {
  // Dexie's add() is typed as `Promise<number | undefined>` because of the
  // optional `id?` field, but auto-increment guarantees a key at runtime.
  const id = await db.library.add({
    ...tab,
    addedAt: Date.now(),
  } as LibraryTab);
  return id as number;
}

export async function getAllTabs(): Promise<LibraryTab[]> {
  return db.library.orderBy('addedAt').reverse().toArray();
}

export async function getFavoriteTabs(): Promise<LibraryTab[]> {
  // IndexedDB can't index booleans, so we do a full-table filter. Library size
  // is small (hundreds of tabs at most), so O(n) is fine.
  return db.library.filter((tab) => tab.favorite === true).toArray();
}

export async function toggleFavorite(id: number): Promise<void> {
  const tab = await db.library.get(id);
  if (!tab) return;
  await db.library.update(id, { favorite: !tab.favorite });
}

export async function deleteTab(id: number): Promise<void> {
  await db.library.delete(id);
}

export async function markOpened(id: number): Promise<void> {
  await db.library.update(id, { lastOpenedAt: Date.now() });
}

// ───── Settings helpers ─────

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

// ───── Recording helpers ─────

export async function saveRecording(
  name: string,
  blob: Blob,
  durationSeconds: number,
): Promise<number> {
  const id = await db.recordings.add({
    name,
    blob,
    durationSeconds,
    createdAt: Date.now(),
  });
  return id as number;
}

export async function getAllRecordings(): Promise<Recording[]> {
  return db.recordings.orderBy('createdAt').reverse().toArray();
}

export async function deleteRecording(id: number): Promise<void> {
  await db.recordings.delete(id);
}
