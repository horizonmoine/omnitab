/**
 * Vercel Edge Function — YouTube audio extraction proxy.
 *
 * This is the thin layer between the PWA and the HF Space's `/youtube-audio`
 * endpoint (yt-dlp on our own infra). It exists to:
 *
 *   - Add CORS headers so the PWA can hit it from a browser.
 *   - Surface clean French error messages instead of raw yt-dlp stack traces.
 *   - Detect "yt-dlp out of date" failure patterns and rewrite the error
 *     into actionable advice (rebuild the HF Space).
 *   - Fetch the YouTube title in parallel via oEmbed so the PWA gets a
 *     friendly filename (X-Omnitab-Title header) even if HF Space's title
 *     extraction is incomplete.
 *
 * Runtime: Edge. We keep this on Edge despite its 25s hard cap because:
 *   - Vite-style /api/*.ts files use `(request: Request) => Response`,
 *     which only Edge supports natively. Node.js runtime requires the
 *     `(req, res)` Express-style shape from @vercel/node — different code
 *     path, different bug surface. (Next.js App Router doesn't have this
 *     constraint, but this project is Vite + raw Vercel Functions.)
 *   - yt-dlp on a *healthy* HF Space typically responds in 4-8s for a
 *     normal-length video, well within the 25s budget. The "happy path"
 *     dominates — when yt-dlp is broken the user has a much bigger
 *     problem to fix anyway (rebuild the HF Space).
 *
 * History note: a previous fallback to Piped + a Fluid Compute migration
 * were tried and reverted. Piped's public-instance ecosystem collapsed
 * under YouTube's anti-bot push (api.piped.private.coffee returns empty
 * audioStreams now), and Fluid Compute on Vite needs the (req, res)
 * Express signature — the (Request) => Response shape crashes with
 * FUNCTION_INVOCATION_FAILED. Both bumps are listed in git log if
 * someone wants to revisit them when the platform changes.
 */

export const config = { runtime: 'edge' };

// ── Backend endpoints ────────────────────────────────────────────────────
//
// We try a custom backend (e.g. self-hosted on a VPS, see selfhost/) FIRST
// when its URL is provided via the OMNITAB_YT_BACKEND_URL Vercel env var,
// then fall through to the HF Space. The VPS path exists because YouTube
// blocks HuggingFace Spaces' shared IP range at the TLS handshake layer
// in 2026 — a residential or non-cloud VPS IP usually isn't blocked, so
// users who set up their own backend get a reliable fast path while
// everyone else gets the HF Space (which works when YouTube's anti-bot
// sleeps) plus the cobalt.tools manual workaround documented in the PWA.

const HF_SPACE_BASE = 'https://horizonmoine30-omnitab-demucs.hf.space';

/**
 * Read the optional self-hosted backend URL from Vercel's environment.
 * The function is intentionally tolerant: trailing slashes, leading
 * whitespace, and non-https schemes (e.g. http for IPv4-only VPS) all
 * pass through unchanged. Empty / unset returns null.
 */
function getCustomBackendUrl(): string | null {
  const raw = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.OMNITAB_YT_BACKEND_URL;
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed || null;
}

// ── Timeouts ─────────────────────────────────────────────────────────────
//
// HF_TIMEOUT_MS has to fit within Edge's 25s hard cap (FUNCTION_INVOCATION_TIMEOUT
// kicks in at ~25s and is NOT configurable on Edge). 22s leaves 3s for
// CORS/streaming overhead. yt-dlp on a healthy HF Space responds in 4-8s
// for normal videos so this is plenty for the success path. If yt-dlp
// itself is broken (SSL EOF, sign-in walls, version skew), it'll typically
// error out faster than 22s — its first retry usually fails immediately
// when the underlying YouTube response is malformed.
//
// If HF Space is sleeping (cold start = 30-60s), the user's first attempt
// will time out at 22s. The PWA shows a "Réveiller le backend" button on
// the Settings page for explicit cold starts.
const HF_TIMEOUT_MS = 22_000;
// oEmbed runs in parallel with the audio fetch, so its timeout doesn't
// add to the wall-clock budget — it just bounds how long we wait for the
// title before falling back to "YouTube audio".
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

  // ── Try custom self-hosted backend first (if configured) ─────────────
  const customUrl = getCustomBackendUrl();
  let customError: string | undefined;
  if (customUrl) {
    const custom = await tryBackend(customUrl, ytUrl);
    if (custom.ok) {
      const title = (await titlePromise) ?? custom.title ?? 'YouTube audio';
      return streamWithMeta(custom.body, custom.contentType, title, 'custom');
    }
    customError = custom.error;
  }

  // ── Fall back to HF Space ────────────────────────────────────────────
  const hf = await tryBackend(HF_SPACE_BASE, ytUrl);
  if (hf.ok) {
    const title = (await titlePromise) ?? hf.title ?? 'YouTube audio';
    return streamWithMeta(hf.body, hf.contentType, title, 'hf-space');
  }

  // Everything failed. Build a single error message that mentions every
  // backend we tried so the user (or maintainer reading logs) knows what
  // happened. tryBackend already detects the common "yt-dlp out of date"
  // pattern and rewrites it into an actionable hint.
  const parts: string[] = [];
  if (customError) parts.push(`backend custom: ${customError}`);
  parts.push(`HF Space: ${hf.error ?? 'inconnu'}`);
  return jsonError(
    502,
    `Extraction YouTube échouée. ${parts.join(' / ')}. ` +
      `Astuce : utilise yt-dlp en local (voir le panneau d'aide sous le champ URL).`,
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

/**
 * Hit any backend that exposes the same `/youtube-audio?url=…` contract
 * as our HF Space (FastAPI + yt-dlp). Used both for the HF Space and for
 * an optional self-hosted backend (set via OMNITAB_YT_BACKEND_URL env).
 *
 * The `baseUrl` should NOT have a trailing slash. We append the path.
 */
async function tryBackend(
  baseUrl: string,
  ytUrl: string,
): Promise<BackendResult> {
  const endpoint = `${baseUrl}/youtube-audio?url=${encodeURIComponent(ytUrl)}`;
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
  source: 'hf-space' | 'custom',
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
