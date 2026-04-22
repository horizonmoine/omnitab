/**
 * IndexedDB wrapper (Dexie) for offline storage.
 *
 * Stores (schema v4):
 *   - library: tabs (GP files, MusicXML, alphaTex) with metadata
 *   - settings: user preferences (A4 ref, default tuning, cost weights)
 *   - recordings: user recordings (WAV blobs) before transcription
 *   - stems: Demucs-separated audio stems cached for offline playback
 *   - practice: practice journal entries with SuperMemo-2 SRS metadata
 *   - setlists: ordered playlists of library tab IDs (gigs, lessons)
 */

import Dexie, { type EntityTable } from 'dexie';
import type { LibraryTab, Setlist } from './types';

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

export type StemType = 'vocals' | 'drums' | 'bass' | 'guitar' | 'other';

export interface SavedStem {
  id?: number;
  /** Human-readable song name, e.g. "Metallica – Master of Puppets". */
  songTitle: string;
  /** Which stem this is. */
  stemType: StemType;
  /** Raw WAV Blob returned by Demucs. */
  blob: Blob;
  /** Duration in seconds. */
  durationSeconds: number;
  /** Unix timestamp. */
  createdAt: number;
}

/** A single practice session entry (SRS-enabled). */
export interface PracticeEntry {
  id?: number;
  /** Song or exercise title. */
  title: string;
  /** Optional artist name. */
  artist: string;
  /** Duration of this practice session in seconds. */
  durationSeconds: number;
  /** Max BPM reached during this session. */
  maxBpm: number;
  /** Self-rating: 1 = hard, 2 = medium, 3 = easy. */
  rating: 1 | 2 | 3;
  /** Unix timestamp of when the session happened. */
  practiceDate: number;
  /** SRS: next review date (Unix timestamp). */
  nextReviewDate: number;
  /** SRS: interval in days until next review. */
  intervalDays: number;
  /** SRS: ease factor (SuperMemo-2, starts at 2.5). */
  easeFactor: number;
  /** SRS: number of consecutive successful reviews. */
  repetitions: number;
}

class OmniTabDB extends Dexie {
  library!: EntityTable<LibraryTab, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  recordings!: EntityTable<Recording, 'id'>;
  stems!: EntityTable<SavedStem, 'id'>;
  practice!: EntityTable<PracticeEntry, 'id'>;
  setlists!: EntityTable<Setlist, 'id'>;

  constructor() {
    super('omnitab');
    this.version(1).stores({
      library: '++id, title, artist, kind, addedAt, favorite, *tags',
      settings: 'key',
      recordings: '++id, createdAt',
    });
    this.version(2).stores({
      library: '++id, title, artist, kind, addedAt, favorite, *tags',
      settings: 'key',
      recordings: '++id, createdAt',
      stems: '++id, songTitle, stemType, createdAt',
    });
    this.version(3).stores({
      library: '++id, title, artist, kind, addedAt, favorite, *tags',
      settings: 'key',
      recordings: '++id, createdAt',
      stems: '++id, songTitle, stemType, createdAt',
      practice: '++id, title, practiceDate, nextReviewDate',
    });
    // v4 — adds setlists. Existing tables don't change, but Dexie requires
    // ALL store specs in every version() call (it diffs them to figure out
    // which indexes to create/drop), so we re-state library/settings/etc.
    this.version(4).stores({
      library: '++id, title, artist, kind, addedAt, favorite, *tags',
      settings: 'key',
      recordings: '++id, createdAt',
      stems: '++id, songTitle, stemType, createdAt',
      practice: '++id, title, practiceDate, nextReviewDate',
      setlists: '++id, name, updatedAt',
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

// ───── Stem helpers (offline Demucs cache) ─────

export async function saveStem(
  songTitle: string,
  stemType: StemType,
  blob: Blob,
  durationSeconds: number,
): Promise<number> {
  const id = await db.stems.add({
    songTitle,
    stemType,
    blob,
    durationSeconds,
    createdAt: Date.now(),
  });
  return id as number;
}

export async function getStemsForSong(
  songTitle: string,
): Promise<SavedStem[]> {
  return db.stems.where('songTitle').equals(songTitle).toArray();
}

export async function getAllStems(): Promise<SavedStem[]> {
  return db.stems.orderBy('createdAt').reverse().toArray();
}

export async function deleteStem(id: number): Promise<void> {
  await db.stems.delete(id);
}

export async function deleteStemsForSong(songTitle: string): Promise<void> {
  await db.stems.where('songTitle').equals(songTitle).delete();
}

// ───── Practice Journal helpers (SRS — SuperMemo-2) ─────

/**
 * SuperMemo-2 algorithm: compute next interval and ease factor based on rating.
 * Rating: 1 = hard (Again), 2 = medium (Good), 3 = easy (Easy).
 */
function sm2(
  rating: 1 | 2 | 3,
  repetitions: number,
  intervalDays: number,
  easeFactor: number,
): { nextInterval: number; nextEase: number; nextReps: number } {
  // Map our 1-3 rating to SM-2's 0-5 quality scale.
  const quality = rating === 1 ? 1 : rating === 2 ? 3 : 5;

  let nextReps = repetitions;
  let nextInterval = intervalDays;
  let nextEase = easeFactor;

  if (quality < 3) {
    // Failed — reset.
    nextReps = 0;
    nextInterval = 1;
  } else {
    nextReps = repetitions + 1;
    if (nextReps === 1) {
      nextInterval = 1;
    } else if (nextReps === 2) {
      nextInterval = 3;
    } else {
      nextInterval = Math.round(intervalDays * easeFactor);
    }
  }

  // Adjust ease factor.
  nextEase = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (nextEase < 1.3) nextEase = 1.3;

  return { nextInterval, nextEase, nextReps };
}

export async function addPracticeEntry(
  entry: Omit<PracticeEntry, 'id' | 'nextReviewDate' | 'intervalDays' | 'easeFactor' | 'repetitions'>,
): Promise<number> {
  // Check if there's an existing entry for this title to continue SRS chain.
  const existing = await db.practice
    .where('title')
    .equals(entry.title)
    .reverse()
    .sortBy('practiceDate');

  const prev = existing[0];
  const reps = prev?.repetitions ?? 0;
  const interval = prev?.intervalDays ?? 0;
  const ease = prev?.easeFactor ?? 2.5;

  const { nextInterval, nextEase, nextReps } = sm2(entry.rating, reps, interval, ease);
  const nextReviewDate = entry.practiceDate + nextInterval * 86400000;

  const id = await db.practice.add({
    ...entry,
    nextReviewDate,
    intervalDays: nextInterval,
    easeFactor: nextEase,
    repetitions: nextReps,
  });
  return id as number;
}

export async function getAllPracticeEntries(): Promise<PracticeEntry[]> {
  return db.practice.orderBy('practiceDate').reverse().toArray();
}

/** Get songs due for review today (SRS). */
export async function getDueForReview(): Promise<PracticeEntry[]> {
  const now = Date.now();
  // Get the latest entry per title, then filter those due.
  const all = await db.practice.orderBy('practiceDate').reverse().toArray();
  const latestByTitle = new Map<string, PracticeEntry>();
  for (const e of all) {
    if (!latestByTitle.has(e.title)) latestByTitle.set(e.title, e);
  }
  return Array.from(latestByTitle.values()).filter((e) => e.nextReviewDate <= now);
}

export async function deletePracticeEntry(id: number): Promise<void> {
  await db.practice.delete(id);
}

// ───── Setlist helpers ─────

export async function getAllSetlists(): Promise<Setlist[]> {
  // Order by most-recently-updated so the user's active setlist is at the
  // top — matches the mental model of "the playlist I was just editing".
  return db.setlists.orderBy('updatedAt').reverse().toArray();
}

export async function createSetlist(name: string): Promise<number> {
  const now = Date.now();
  const id = await db.setlists.add({
    name,
    tabIds: [],
    createdAt: now,
    updatedAt: now,
  });
  return id as number;
}

export async function renameSetlist(id: number, name: string): Promise<void> {
  await db.setlists.update(id, { name, updatedAt: Date.now() });
}

export async function deleteSetlist(id: number): Promise<void> {
  await db.setlists.delete(id);
}

/**
 * Append a tab id to a setlist (no-op if the tab is already in the list).
 * Idempotent because adding the same song twice in a row is almost always
 * a UI mis-tap rather than intent.
 */
export async function addTabToSetlist(
  setlistId: number,
  tabId: number,
): Promise<void> {
  const sl = await db.setlists.get(setlistId);
  if (!sl) return;
  if (sl.tabIds.includes(tabId)) return;
  await db.setlists.update(setlistId, {
    tabIds: [...sl.tabIds, tabId],
    updatedAt: Date.now(),
  });
}

export async function removeTabFromSetlist(
  setlistId: number,
  position: number,
): Promise<void> {
  const sl = await db.setlists.get(setlistId);
  if (!sl) return;
  if (position < 0 || position >= sl.tabIds.length) return;
  const next = sl.tabIds.slice();
  next.splice(position, 1);
  await db.setlists.update(setlistId, {
    tabIds: next,
    updatedAt: Date.now(),
  });
}

/**
 * Move a tab within a setlist by `delta` positions (negative = up).
 * Clamps to bounds — calling with delta=-1 on position 0 is a no-op rather
 * than an error, so the caller doesn't have to guard against edge cases.
 */
export async function moveTabInSetlist(
  setlistId: number,
  position: number,
  delta: number,
): Promise<void> {
  const sl = await db.setlists.get(setlistId);
  if (!sl) return;
  const target = position + delta;
  if (
    position < 0 ||
    position >= sl.tabIds.length ||
    target < 0 ||
    target >= sl.tabIds.length
  ) {
    return;
  }
  const next = sl.tabIds.slice();
  const [moved] = next.splice(position, 1);
  next.splice(target, 0, moved);
  await db.setlists.update(setlistId, {
    tabIds: next,
    updatedAt: Date.now(),
  });
}
