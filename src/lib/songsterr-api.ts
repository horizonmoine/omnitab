/**
 * Songsterr public REST API client.
 *
 * Songsterr migrated from `/a/ra/songs.json` to `/api/songs` (Apr 2026).
 * The response shape is identical — JSON array of song objects.
 *
 * ⚠ CORS NOTE: Browsers block direct fetches to songsterr.com.
 * In production on Vercel the Edge Function at /api/songsterr proxies requests.
 * In dev, users can set VITE_SONGSTERR_PROXY in .env.local.
 */

import type { SongsterrHit } from './types';

const DIRECT_BASE = 'https://www.songsterr.com/api';

/**
 * Resolve the proxy base URL. In production on Vercel, the Edge Function at
 * /api/songsterr handles CORS proxying automatically (same-origin, no config
 * needed). In dev, direct fetch usually works, but users can override via
 * VITE_SONGSTERR_PROXY in .env.local if their browser blocks it.
 */
function getProxyUrl(path: string): string {
  const override = (import.meta.env.VITE_SONGSTERR_PROXY as string | undefined) ?? '';
  if (override) return `${override}${path}`;
  // In production: use the Vercel Edge Function on the same origin.
  if (!import.meta.env.DEV) return `/api/songsterr?path=${encodeURIComponent(path)}`;
  return '';
}

async function fetchJson<T>(path: string): Promise<T> {
  // Try direct fetch first (works in dev, blocked by CORS in prod).
  try {
    const res = await fetch(`${DIRECT_BASE}${path}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) return (await res.json()) as T;
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    const proxyUrl = getProxyUrl(path);
    if (!proxyUrl) {
      console.warn('[songsterr] direct fetch failed, no proxy available.', err);
      throw new Error(
        'Erreur de recherche. Songsterr est bloqué par CORS.',
      );
    }
    const res = await fetch(proxyUrl, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

/** Raw shape returned by Songsterr's /api/songs endpoint. */
interface SongsterrRaw {
  songId: number;
  artist: string;
  title: string;
  tracks?: Array<{ instrument: string; tuning?: number[] }>;
}

/** Search for songs matching a free-text query. */
export async function searchSongsterr(
  pattern: string,
  size = 40,
): Promise<SongsterrHit[]> {
  if (!pattern.trim()) return [];
  const q = encodeURIComponent(pattern.trim());
  const raw = await fetchJson<SongsterrRaw[]>(
    `/songs?pattern=${q}&size=${size}`,
  );
  // Normalize to our internal SongsterrHit shape.
  return raw.map((r) => ({
    id: r.songId,
    title: r.title,
    artist: { name: r.artist },
    tracks: r.tracks?.map((t) => ({ instrument: t.instrument })),
  }));
}

/**
 * Resolve a Songsterr song to a downloadable Guitar Pro file URL.
 *
 * The public Songsterr revision endpoint returns the latest revision which
 * contains a source URL pointing to a .gp / .gp5 / .gpx file on their CDN.
 */
/**
 * Detect a Guitar Pro file's format from its first bytes.
 * Returns 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'unknown'.
 */
export function detectGpFormat(
  buf: ArrayBuffer,
): 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'unknown' {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'gpx';
  const text = new TextDecoder('ascii').decode(bytes.slice(1, 31));
  if (text.startsWith('FICHIER GUITAR PRO v3')) return 'gp3';
  if (text.startsWith('FICHIER GUITAR PRO v4')) return 'gp4';
  if (text.startsWith('FICHIER GUITAR PRO v5')) return 'gp5';
  return 'unknown';
}
