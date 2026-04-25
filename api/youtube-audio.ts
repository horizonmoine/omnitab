/**
 * Vercel Edge Function — YouTube audio extraction with backend fallback.
 *
 * This is the resilience layer the PWA hits for YouTube → MP3. It tries
 * two completely independent extractors and returns whichever responds
 * first with a valid audio stream:
 *
 *   1. HF Space `/youtube-audio` (yt-dlp on our own infra). Hit first
 *      because it's *ours* — predictable rate limits, our 10-min cap.
 *   2. Cobalt API (https://api.cobalt.tools) — public, open-source, free.
 *      Used when HF Space is sleeping, yt-dlp is broken (YouTube cipher
 *      rotation), or any other 5xx. Cobalt has its own rate limits which
 *      kick in for a personal-scale app like this only under heavy use.
 *
 * Title is fetched in parallel via YouTube's anonymous oEmbed endpoint so
 * we surface a friendly filename even when Cobalt's response doesn't
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
const COBALT_API = 'https://api.cobalt.tools/';

// ── Timeouts ─────────────────────────────────────────────────────────────
//
// HF_TIMEOUT_MS is short on purpose: a *warm* HF Space returns yt-dlp
// output in 2-4s. If we don't hear back in 12s, the Space is either
// sleeping (cold start = 30-60s) or yt-dlp is hanging — both cases we
// want to bail out of and try Cobalt instead. The user's PWA already
// has a "Réveiller le backend" button if they really want HF awake.
const HF_TIMEOUT_MS = 12_000;
const COBALT_TIMEOUT_MS = 30_000;
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

  // ── Fall back to Cobalt ───────────────────────────────────────────────
  const cob = await tryCobalt(ytUrl);
  if (cob.ok) {
    const title = (await titlePromise) ?? 'YouTube audio';
    return streamWithMeta(cob.body, cob.contentType, title, 'cobalt');
  }

  // Both failed. Surface a single error message that mentions both attempts
  // so the PWA can show something more useful than "HTTP 500".
  return jsonError(
    502,
    `Aucun extracteur YouTube n'a répondu. ` +
      `HF Space: ${hf.error ?? 'inconnu'}. Cobalt: ${cob.error ?? 'inconnu'}.`,
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
      const detail = await r.text().catch(() => '');
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
// Cobalt attempt
// ─────────────────────────────────────────────────────────────────────────
//
// Cobalt v10 contract (current as of 2026):
//   POST https://api.cobalt.tools/
//   Body : { url, downloadMode: "audio", audioFormat: "mp3", audioBitrate }
//   Reply: { status: "tunnel" | "redirect" | "error" | "rate-limit",
//            url?: string, error?: { code, context } }
//
// "tunnel" → fetch the URL on Cobalt's infra, get the audio stream.
// "redirect" → fetch a third-party CDN URL (e.g. YouTube directly). Same.
// "error" / "rate-limit" → bubble up the error code so the user knows
//   to retry / use the file picker.

async function tryCobalt(ytUrl: string): Promise<BackendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COBALT_TIMEOUT_MS);

  try {
    const cobReq = await fetch(COBALT_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: ytUrl,
        downloadMode: 'audio',
        audioFormat: 'mp3',
        audioBitrate: '128',
      }),
    });

    if (!cobReq.ok) {
      const detail = await cobReq.text().catch(() => '');
      return {
        ok: false,
        error: `cobalt HTTP ${cobReq.status}${detail ? ` (${truncate(detail, 200)})` : ''}`,
      };
    }

    const data = (await cobReq.json()) as {
      status?: string;
      url?: string;
      error?: { code?: string };
    };

    if (data.status === 'error' || data.status === 'rate-limit') {
      return {
        ok: false,
        error: `cobalt ${data.status}${data.error?.code ? ` (${data.error.code})` : ''}`,
      };
    }
    if (data.status !== 'tunnel' && data.status !== 'redirect') {
      return { ok: false, error: `cobalt status inattendu: ${data.status ?? 'absent'}` };
    }
    if (!data.url) {
      return { ok: false, error: 'cobalt: url manquante' };
    }

    // Fetch the actual audio. Cobalt's tunnel URLs are short-lived (~minutes)
    // so we proxy the bytes through immediately rather than handing the URL
    // to the PWA — the user's network might be slower than ours, and the
    // tunnel could expire mid-download.
    const audio = await fetch(data.url, { signal: controller.signal });
    if (!audio.ok || !audio.body) {
      return {
        ok: false,
        error: `cobalt tunnel HTTP ${audio.status}`,
      };
    }
    return {
      ok: true,
      body: audio.body,
      contentType: audio.headers.get('Content-Type') ?? 'audio/mpeg',
    };
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      return { ok: false, error: `cobalt timeout ${COBALT_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, error: `cobalt: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
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
  source: 'hf-space' | 'cobalt',
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
