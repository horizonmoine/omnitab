/**
 * Songsterr public REST API client.
 *
 * The endpoint `https://www.songsterr.com/a/ra/songs.json?pattern=<query>`
 * returns a JSON array of matching songs without requiring an API key.
 *
 * ⚠ CORS NOTE: Browsers may block direct fetches to songsterr.com due to
 * same-origin restrictions. If that happens at runtime, the app falls back to
 * routing requests through a user-configurable proxy (see VITE_SONGSTERR_PROXY).
 */

import type { SongsterrHit } from './types';

const DIRECT_BASE = 'https://www.songsterr.com/a/ra';

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

/** Search for songs matching a free-text query. */
export async function searchSongsterr(
  pattern: string,
  size = 40,
): Promise<SongsterrHit[]> {
  if (!pattern.trim()) return [];
  const q = encodeURIComponent(pattern.trim());
  const hits = await fetchJson<SongsterrHit[]>(
    `/songs.json?pattern=${q}&size=${size}`,
  );
  return hits;
}

/**
 * Resolve a Songsterr song to a downloadable Guitar Pro file URL.
 *
 * The public Songsterr revision endpoint returns the latest revision which
 * contains a source URL pointing to a .gp / .gp5 / .gpx file on their CDN.
 */
export async function resolveTabFileUrl(songId: number): Promise<string> {
  const data = await fetchJson<{
    source?: string;
    attachmentUrl?: string;
  }>(`/song/${songId}/revisions.json`);
  const url = data.source ?? data.attachmentUrl;
  if (!url) throw new Error('No tab file URL in revision response');
  return url;
}

/** Fetch the raw binary contents of a Guitar Pro tab file from its URL. */
export async function downloadTabFile(url: string): Promise<ArrayBuffer> {
  const tryUrls = [url];
  for (const u of tryUrls) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.arrayBuffer();
    } catch {
      /* try next */
    }
  }
  throw new Error(`Failed to download tab from ${url}`);
}

/**
 * Detect a Guitar Pro file's format from its first bytes.
 * Returns 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'unknown'.
 */
export function detectGpFormat(
  buf: ArrayBuffer,
): 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'unknown' {
  const bytes = new Uint8Array(buf);
  // GPX (Guitar Pro 6+) is a ZIP archive starting with "BCFZ" or "BCFS" inside
  // a PK zip. We check the zip magic number PK\x03\x04.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'gpx';
  // GP3/4/5 start with a version string length byte then "FICHIER GUITAR PRO".
  // Length byte is 0x14 (20) followed by the version text.
  const text = new TextDecoder('ascii').decode(bytes.slice(1, 31));
  if (text.startsWith('FICHIER GUITAR PRO v3')) return 'gp3';
  if (text.startsWith('FICHIER GUITAR PRO v4')) return 'gp4';
  if (text.startsWith('FICHIER GUITAR PRO v5')) return 'gp5';
  return 'unknown';
}
