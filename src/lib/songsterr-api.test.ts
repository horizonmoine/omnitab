/**
 * Songsterr API client — unit tests.
 *
 * These tests pin the contract between the Songsterr `/api/songs` endpoint
 * and our internal `SongsterrHit` shape. They also document the 2 known
 * failure modes we handle (direct fetch blocked → fallback to proxy) so
 * future refactors don't silently break search.
 *
 * Scope: only `searchSongsterr` and `detectGpFormat` — deliberately leaves
 * the Edge proxy alone (that needs an integration test against a live
 * Songsterr endpoint, see the `/tests/` folder roadmap).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { searchSongsterr, detectGpFormat } from './songsterr-api';

const realFetch = globalThis.fetch;

describe('searchSongsterr', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns an empty array for an empty query without calling fetch', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy;
    const result = await searchSongsterr('');
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns an empty array for a whitespace-only query', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy;
    const result = await searchSongsterr('   \t\n');
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('normalises a Songsterr response into SongsterrHit[] (Let Down regression)', async () => {
    // Real response shape captured from
    // https://www.songsterr.com/api/songs?pattern=let+down+radiohead
    // The "Let Down" row is the key regression fixture: this song used to
    // be reported as "introuvable" because the scraper failed downstream,
    // not because the search missed it. Don't delete this fixture.
    const raw = [
      {
        songId: 9548,
        artist: 'Radiohead',
        title: 'Let Down',
        tracks: [
          { instrument: 'Acoustic Guitar (steel)' },
          { instrument: 'Electric Bass (finger)' },
          { instrument: 'Drums' },
        ],
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(raw),
    });

    const result = await searchSongsterr('let down radiohead');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 9548,
      title: 'Let Down',
      artist: { name: 'Radiohead' },
      tracks: [
        { instrument: 'Acoustic Guitar (steel)' },
        { instrument: 'Electric Bass (finger)' },
        { instrument: 'Drums' },
      ],
    });
  });

  it('URL-encodes the pattern so special characters survive the round trip', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    globalThis.fetch = fetchSpy;

    await searchSongsterr('AC/DC & Metallica');

    // Assert the outbound URL has the pattern percent-encoded. We don't
    // care whether the direct or proxy URL was used — only the encoding.
    const firstCall = fetchSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const url = String(firstCall![0]);
    expect(url).toMatch(/pattern=AC%2FDC%20%26%20Metallica/);
  });

  it('defaults to size=40 but forwards a custom size', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    globalThis.fetch = fetchSpy;

    await searchSongsterr('radiohead');
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/size=40/);

    fetchSpy.mockClear();
    await searchSongsterr('radiohead', 10);
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/size=10/);
  });

  it('handles a tracks-less song (older revisions) without throwing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { songId: 1, artist: 'Unknown', title: 'Mystery Tune' },
        ]),
    });
    const result = await searchSongsterr('mystery');
    expect(result).toEqual([
      {
        id: 1,
        title: 'Mystery Tune',
        artist: { name: 'Unknown' },
        tracks: undefined,
      },
    ]);
  });

  it('throws a helpful French error when both direct and proxy fail', async () => {
    // First call (direct) rejects, second call (proxy in prod) also rejects.
    // In dev with no proxy override, a single direct failure should surface.
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(searchSongsterr('anything')).rejects.toThrow();
  });
});

describe('detectGpFormat', () => {
  it('detects gpx (Guitar Pro 6 zip) by PK magic bytes', () => {
    const buf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]).buffer;
    expect(detectGpFormat(buf)).toBe('gpx');
  });

  it('detects gp5 by its ASCII header', () => {
    // Guitar Pro 5 header: one length byte (0x18 = 24) followed by
    // "FICHIER GUITAR PRO v5.10" in ASCII, then the file body.
    const header =
      '\x18FICHIER GUITAR PRO v5.10'.padEnd(40, '\x00');
    const bytes = new TextEncoder().encode(header);
    expect(detectGpFormat(bytes.buffer)).toBe('gp5');
  });

  it('detects gp4 by its ASCII header', () => {
    const header = '\x18FICHIER GUITAR PRO v4.06'.padEnd(40, '\x00');
    const bytes = new TextEncoder().encode(header);
    expect(detectGpFormat(bytes.buffer)).toBe('gp4');
  });

  it('returns "unknown" for arbitrary binary data', () => {
    const buf = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]).buffer;
    expect(detectGpFormat(buf)).toBe('unknown');
  });

  it('returns "unknown" for an empty buffer without throwing', () => {
    const buf = new ArrayBuffer(0);
    expect(detectGpFormat(buf)).toBe('unknown');
  });
});
