/**
 * Vercel Edge Function — YouTube audio extraction with backend fallback.
 *
 * This is the resilience layer the PWA hits for YouTube → MP3. It tries
 * two completely independent extractors and returns whichever responds
 * first with a valid audio stream:
 *
 *   1. HF Space `/youtube-audio` (yt-dlp on our own infra). Hit first
 *      because it's *ours* — predictable rate limits, our 10-min cap.
 *   2. Piped (https://github.com/TeamPiped/Piped) — open-source, no-auth
 *      alternative front-end to YouTube. Used when HF Space is sleeping
 *      or yt-dlp is broken (YouTube cipher rotation). We try a hardcoded
 *      list of public instances and take the first that responds — the
 *      community-run instances rotate and die regularly, so a single one
 *      is unsafe.
 *
 *      We previously used Cobalt (api.cobalt.tools) but as of late 2025
 *      it requires a JWT obtained via a Cloudflare Turnstile challenge —
 *      impractical from a serverless function with no browser context.
 *
 * Title is fetched in parallel via YouTube's anonymous oEmbed endpoint so
 * we surface a friendly filename even when Piped's response doesn't
 * carry metadata. The `X-Omnitab-Source` response header tells you which
 * backend served the audio (handy for debugging).
 *
 * Runtime: Edge. Same `(request: Request) => Response` shape as the other
 * `/api/*` handlers — Fluid Compute migration is queued for all three at
 * once (see api/songsterr.ts comment for the rationale).
 */

export const config = { runtime: 'edge' };

// ── Backend endpoints ────────────────────────────────────────────────────

const HF_SPACE_BASE = 'https://horizonmoine30-omnitab-demucs.hf.space';

// Public Piped instances. Order = priority (we try them in sequence and
// return the first that responds with a valid audio stream). Update this
// list when an instance starts 5xx-ing for weeks — the canonical health
// dashboard is https://piped-instances.kavin.rocks/.
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://piapi.ggtyler.dev',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.leptons.xyz',
];

// ── Timeouts ─────────────────────────────────────────────────────────────
//
// HF_TIMEOUT_MS has to be LONGER than yt-dlp's own internal retry budget
// inside the HF Space. yt-dlp is configured there with retries=5 and
// socket_timeout=20s — i.e. it can spend ~60-80s exhausting retries
// before giving the proxy back a real verdict. If we time out at 12s,
// we *never* see whether the request actually succeeded, and we fall
// through to Piped instead — even when the next 30s would have brought
// back working audio. 75s is the sweet spot: longer than yt-dlp's worst
// case, shorter than Vercel's 300s function cap, and shorter than the
// browser's default fetch timeout so the PWA stays responsive.
//
// Cold start: HF Spaces wake within 30-60s. With a 75s budget we usually
// catch them awake on the second user attempt — the first one might
// still time out, which is acceptable because the user has a separate
// "Réveiller le backend" button for explicit cold starts.
const HF_TIMEOUT_MS = 75_000;
// Per-Piped-instance budget. Piped is now an emergency-only fallback —
// the public instances list collapsed in 2024-2025 under YouTube's
// anti-bot push, so most attempts will fail fast. Each instance gets
// 8s before we move on; with 5 instances that's 40s worst case.
const PIPED_TIMEOUT_MS = 8_000;
const OEMBED_TIMEOUT_MS = 5_000;

// Loose YouTube URL guard. We pass the URL straight to the backends so
// don't need a tight regex — just enough to reject obvious garbage.
const YT_HOST_RE = /(^|\.)((youtube\.com)|(youtu\.be))$/i;

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ytUrl = url.searchParams.get('url');

  if (!ytUrl) {
    return jsonError(400, 'Paramètre ?url= manquant.');
  }

  let ytParsed: URL;
  try {
    ytParsed = new URL(ytUrl);
  } catch {
    return jsonError(400, 'URL invalide.');
  }

  if (!YT_HOST_RE.test(ytParsed.hostname)) {
    return jsonError(400, 'URL YouTube uniquement (youtube.com / youtu.be).');
  }

  // Kick off the title fetch in parallel — it's independent of the audio
  // path and we want it ready by the time we start streaming bytes back.
  const titlePromise = fetchOembedTitle(ytUrl);

  // ── Try HF Space first ────────────────────────────────────────────────
  const hf = await tryHfSpace(ytUrl);
  if (hf.ok) {
    const title = (await titlePromise) ?? hf.title ?? 'YouTube audio';
    return streamWithMeta(hf.body, hf.contentType, title, 'hf-space');
  }

  // ── Fall back to Piped ────────────────────────────────────────────────
  const piped = await tryPiped(ytUrl);
  if (piped.ok) {
    // Prefer oEmbed's title when available (more consistent formatting),
    // fall back to whatever Piped returned, then a generic name.
    const title = (await titlePromise) ?? piped.title ?? 'YouTube audio';
    return streamWithMeta(piped.body, piped.contentType, title, 'piped');
  }

  // Both failed. Surface a single error message that mentions both attempts
  // so the PWA can show something more useful than "HTTP 500".
  return jsonError(
    502,
    `Aucun extracteur YouTube n'a répondu. ` +
      `HF Space: ${hf.error ?? 'inconnu'}. Piped: ${piped.error ?? 'inconnu'}. ` +
      `Réessaie dans quelques minutes ou importe un fichier audio à la place.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HF Space attempt
// ─────────────────────────────────────────────────────────────────────────

interface BackendOk {
  ok: true;
  body: ReadableStream<Uint8Array>;
  contentType: string;
  title?: string;
}
interface BackendErr {
  ok: false;
  error: string;
}
type BackendResult = BackendOk | BackendErr;

async function tryHfSpace(ytUrl: string): Promise<BackendResult> {
  const endpoint = `${HF_SPACE_BASE}/youtube-audio?url=${encodeURIComponent(ytUrl)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);

  try {
    const r = await fetch(endpoint, { signal: controller.signal });
    if (!r.ok) {
      // Read error body so the eventual 502 message has real signal in it.
      // The HF Space replies with `{ "detail": "..." }` for HTTPException —
      // unwrap that so we don't show raw JSON to the user further down.
      const raw = await r.text().catch(() => '');
      let detail = raw;
      try {
        const parsed = JSON.parse(raw) as { detail?: string };
        if (parsed.detail) detail = parsed.detail;
      } catch {
        // not JSON, keep the raw text
      }
      // yt-dlp prints "Confirm you are on the latest version using yt-dlp -U"
      // when it gives up — surface that as actionable advice for the dev who
      // owns the HF Space (probably us). Detection mirrors the HF Space's
      // own hint logic in app.py to stay consistent.
      const lower = detail.toLowerCase();
      const looksOutOfDate =
        lower.includes('ssl') ||
        lower.includes('eof') ||
        lower.includes('sign in') ||
        lower.includes('latest version') ||
        lower.includes('please report this issue');
      if (looksOutOfDate) {
        return {
          ok: false,
          error:
            `HF Space yt-dlp obsolète — pousse un nouveau commit sur le HF Space ` +
            `(touch hf-space/Dockerfile YTDLP_CACHE_BUST). ` +
            `Détail: ${truncate(detail, 200)}`,
        };
      }
      return {
        ok: false,
        error: `HTTP ${r.status}${detail ? ` (${truncate(detail, 200)})` : ''}`,
      };
    }
    if (!r.body) {
      return { ok: false, error: 'pas de body' };
    }
    return {
      ok: true,
      body: r.body,
      contentType: r.headers.get('Content-Type') ?? 'audio/mpeg',
      title: r.headers.get('X-Omnitab-Title') ?? undefined,
    };
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      return { ok: false, error: `timeout ${HF_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Piped attempt
// ─────────────────────────────────────────────────────────────────────────
//
// Piped exposes a JSON view of YouTube metadata at:
//   GET <instance>/streams/<videoId>
//   Reply: { title, uploader, audioStreams: [{ url, mimeType, bitrate, ... }] }
//
// We try the public instances in PIPED_INSTANCES in order. First success
// wins — the audio stream URL is a direct googlevideo.com CDN link that
// we re-stream through our function so the PWA gets a stable connection
// even if the underlying CDN URL would expire.
//
// Codec note: Piped's audioStreams are usually Opus-in-WebM or AAC-in-M4A,
// not MP3. The PWA's downstream consumers (Demucs/torchaudio, basic-pitch
// via Web Audio decodeAudioData) handle both fine, so we don't transcode.

interface PipedAudioStream {
  url: string;
  mimeType: string;
  codec: string;
  bitrate: number;
}

interface PipedStreamsResponse {
  title?: string;
  uploader?: string;
  duration?: number;
  audioStreams?: PipedAudioStream[];
}

/** Pull the YouTube video id out of any youtube.com / youtu.be URL. */
function extractYoutubeId(ytUrl: string): string | null {
  try {
    const u = new URL(ytUrl);
    if (u.hostname.includes('youtu.be')) {
      // youtu.be/<id>?... — strip leading slash, take first path segment.
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }
    // youtube.com/watch?v=<id> is by far the common form. shorts/<id> and
    // embed/<id> are also worth handling — bail through the path parser.
    const v = u.searchParams.get('v');
    if (v) return v;
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs[0] === 'shorts' || segs[0] === 'embed') return segs[1] ?? null;
    return null;
  } catch {
    return null;
  }
}

async function tryPiped(ytUrl: string): Promise<BackendResult> {
  const videoId = extractYoutubeId(ytUrl);
  if (!videoId) {
    return { ok: false, error: 'piped: id YouTube non parsable' };
  }

  // Track the last instance error so the eventual 502 message has signal
  // about *why* every instance failed (helpful for "all rate-limited" vs
  // "all timed out" vs "404 — bad video id").
  let lastErr = 'aucune instance Piped joignable';

  for (const instance of PIPED_INSTANCES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PIPED_TIMEOUT_MS);

    try {
      const metaRes = await fetch(`${instance}/streams/${videoId}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!metaRes.ok) {
        lastErr = `${shortHost(instance)} HTTP ${metaRes.status}`;
        continue;
      }
      const meta = (await metaRes.json()) as PipedStreamsResponse;
      if (!meta.audioStreams || meta.audioStreams.length === 0) {
        lastErr = `${shortHost(instance)}: pas de flux audio`;
        continue;
      }

      // Pick the highest-bitrate audio stream. Usually Opus 160kbps.
      // (Bitrate is in bits/s in Piped's response.)
      const best = [...meta.audioStreams].sort(
        (a, b) => b.bitrate - a.bitrate,
      )[0];

      // Fetch the actual audio bytes from the CDN URL Piped resolved.
      // Same controller → if the CDN hangs we time out at the same budget
      // we used for the metadata call.
      const audio = await fetch(best.url, { signal: controller.signal });
      if (!audio.ok || !audio.body) {
        lastErr = `${shortHost(instance)} CDN HTTP ${audio.status}`;
        continue;
      }

      // Build the title in the same "{author} - {title}" shape oEmbed uses
      // so the X-Omnitab-Title header is consistent across both backends.
      const title =
        meta.uploader && meta.title
          ? `${meta.uploader} - ${meta.title}`
          : meta.title;

      return {
        ok: true,
        body: audio.body,
        contentType:
          audio.headers.get('Content-Type') ??
          best.mimeType ??
          'audio/webm',
        title,
      };
    } catch (err) {
      const name = (err as Error).name;
      lastErr =
        name === 'AbortError'
          ? `${shortHost(instance)} timeout ${PIPED_TIMEOUT_MS / 1000}s`
          : `${shortHost(instance)}: ${(err as Error).message}`;
      // continue to next instance
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastErr };
}

/** Helper: trim https:// + path off so error messages stay short. */
function shortHost(instanceUrl: string): string {
  try {
    return new URL(instanceUrl).hostname.replace(/^pipedapi\./, '');
  } catch {
    return instanceUrl;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Title via YouTube oEmbed
// ─────────────────────────────────────────────────────────────────────────
//
// YouTube exposes anonymous metadata via oEmbed. No API key, no quota
// (informally). Returns null on any failure — title is best-effort.

async function fetchOembedTitle(ytUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(ytUrl)}&format=json`;
    const r = await fetch(oembedUrl, { signal: controller.signal });
    if (!r.ok) return null;
    const data = (await r.json()) as { title?: string; author_name?: string };
    if (!data.title) return null;
    return data.author_name ? `${data.author_name} - ${data.title}` : data.title;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function streamWithMeta(
  body: ReadableStream<Uint8Array>,
  contentType: string,
  title: string,
  source: 'hf-space' | 'piped',
): Response {
  // Sanitize title for HTTP header — ASCII only.
  const safeTitle =
    Array.from(title)
      .map((c) =>
        /[A-Za-z0-9 \-_.]/.test(c) ? c : '_',
      )
      .join('')
      .slice(0, 120)
      .trim() || 'audio';

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'X-Omnitab-Title': safeTitle,
      'X-Omnitab-Source': source,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Omnitab-Title, X-Omnitab-Source',
      'Cache-Control': 'no-store',
    },
  });
}

function jsonError(status: number, detail: string): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
