/**
 * Client minimal pour le backend Demucs (FastAPI).
 *
 * Backend par défaut :
 *   - dev   : http://localhost:8000 (`backend/server.py` lancé en local)
 *   - prod  : https://horizonmoine30-omnitab-demucs.hf.space (HF Space)
 *
 * Override possible à deux niveaux :
 *   - build-time : VITE_DEMUCS_API
 *   - runtime    : Settings → Backend Demucs (écrit dans
 *                  globalThis.__OMNITAB_DEMUCS_URL__)
 *
 * Toutes les méthodes sont conçues pour échouer proprement : si le backend
 * n'est pas joignable, `isBackendAvailable()` renvoie `null` et l'UI peut
 * désactiver les options qui en dépendent. Pour les Spaces HF gratuits qui
 * dorment après 48h, utiliser `wakeBackend()` qui poll jusqu'à 90s.
 */

// Compile-time fallback. In dev we default to the local FastAPI server so
// `npm run dev` just works when the user has the Python backend running.
// In prod we default to the official OmniTab HF Space — that way YouTube
// import + Demucs work out of the box without forcing every user through
// the Settings page on first launch. Self-hosters can override at build
// time via `VITE_DEMUCS_API`, and end-users can override at runtime via
// Settings → Backend Demucs (which writes globalThis.__OMNITAB_DEMUCS_URL__).
const BACKEND_URL_FALLBACK =
  (import.meta.env.VITE_DEMUCS_API as string | undefined) ??
  (import.meta.env.DEV
    ? 'http://localhost:8000'
    : 'https://horizonmoine30-omnitab-demucs.hf.space');

/**
 * Resolve the effective backend URL at call time — this picks up any user
 * override from the Settings page without requiring a page reload. Returns
 * an empty string when no backend is configured (prod + no user override).
 */
function getBackendUrl(): string {
  // Avoid a static import cycle by reading from the module-level cache via
  // globalThis. The settings module writes the override here on change.
  const override = (
    globalThis as { __OMNITAB_DEMUCS_URL__?: string }
  ).__OMNITAB_DEMUCS_URL__;
  return (override && override.trim()) || BACKEND_URL_FALLBACK;
}

/** Nom des stems produits par Demucs selon le modèle choisi côté backend. */
export type Stem =
  | 'vocals'
  | 'drums'
  | 'bass'
  | 'other'
  | 'guitar'
  | 'piano';

export interface BackendHealth {
  status: 'ok';
  device: string;
  default_model: string;
  cuda_available: boolean;
  torch_version: string;
}

/**
 * Ping le backend. Renvoie `null` s'il est injoignable — l'UI utilise ça
 * pour savoir si on peut afficher les options "isoler avec Demucs".
 *
 * Default 3s timeout: enough to catch a warm HF Space (typically <500ms),
 * short enough that a sleeping Space doesn't block the page on mount. Use
 * `wakeBackend()` instead when you want to wait for a cold start.
 */
export async function isBackendAvailable(
  timeoutMs = 3000,
): Promise<BackendHealth | null> {
  const url = getBackendUrl();
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/health`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as BackendHealth;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wake a sleeping HF Space. Polls `/health` for up to 90s with a 5s
 * per-attempt timeout — Spaces wake within 30-60s typically, so 90s gives
 * a comfortable margin. Returns the BackendHealth on success or `null` if
 * the Space never came up.
 *
 * Calls `onAttempt(elapsedMs)` between probes so the UI can show progress.
 * The progress is "wall-clock since wake started" rather than a percentage
 * because we don't actually know how long the Space will take to wake.
 */
export async function wakeBackend(
  onAttempt?: (elapsedMs: number) => void,
  maxWaitMs = 90_000,
): Promise<BackendHealth | null> {
  const url = getBackendUrl();
  if (!url) return null;

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const elapsed = Date.now() - start;
    onAttempt?.(elapsed);
    const health = await isBackendAvailable(5000);
    if (health) return health;
    // Brief breather between probes so we don't hammer a waking Space.
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

export interface SeparateProgress {
  /** 0–1, arbitraire pendant l'upload + run Demucs. */
  progress: number;
  status: string;
}

/**
 * Envoie `file` au backend et récupère le stem demandé sous forme de Blob.
 *
 * C'est l'endpoint `/separate-stream` côté backend — retourne un seul stem
 * en WAV, ce qui économise la bande passante vs. un ZIP complet.
 */
export async function separateStem(
  file: File | Blob,
  stem: Stem,
  onProgress?: (p: SeparateProgress) => void,
): Promise<Blob> {
  // In prod, route through the same-origin Vercel proxy `/api/demucs-stream`.
  // That proxy forwards the bytes server-side to HF Space, so the user's
  // browser only sees a request to omnitab-henna.vercel.app — bypassing
  // antivirus / browser-shield software that intercepts cross-origin POSTs
  // to less-known domains like *.hf.space and silently fails them with
  // `net::ERR_FAILED` (only happens in non-incognito modes — those AVs
  // typically bypass their hooks for InPrivate browsing).
  //
  // In dev (`vite dev`), Vercel functions don't run, so we hit the configured
  // backend directly. Self-hosters running their own /api/* layer can
  // override the proxy URL via Settings if they want.
  const useProxy = !import.meta.env.DEV;

  let url: string;
  if (useProxy) {
    url = `/api/demucs-stream?stem=${encodeURIComponent(stem)}`;
  } else {
    const baseUrl = getBackendUrl();
    if (!baseUrl) throw new Error('Aucun backend Demucs configuré (voir Réglages).');
    url = `${baseUrl}/separate-stream?stem=${encodeURIComponent(stem)}`;
  }

  onProgress?.({ progress: 0.05, status: `Envoi au backend Demucs…` });

  const form = new FormData();
  form.append('file', file, 'audio.wav');

  const res = await fetch(url, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `Demucs a échoué (HTTP ${res.status})${detail ? ` : ${detail}` : ''}`,
    );
  }

  onProgress?.({
    progress: 0.95,
    status: `Réception du stem "${stem}"…`,
  });

  const blob = await res.blob();
  onProgress?.({ progress: 1, status: 'Stem reçu.' });
  return blob;
}

/**
 * Ask the backend to extract audio from a YouTube URL via yt-dlp.
 *
 * In prod we route through `/api/youtube-audio` on Vercel — that proxy
 * tries the HF Space first, then falls back to the Cobalt API when HF
 * is sleeping or yt-dlp has been broken by a YouTube cipher rotation.
 * That fallback is invisible to the caller; this function still returns
 * `{ blob, title }` regardless of which backend served the bytes.
 *
 * The proxy is bypassed in two cases:
 *   - `import.meta.env.DEV` — `vite dev` doesn't run Vercel functions, so
 *     hitting `/api/*` would 404. We go direct to the configured backend.
 *   - User has set a custom backend URL in Settings — they're running their
 *     own infra and probably want every call to go there (no Cobalt
 *     surprise). The Cobalt fallback is purely a default-backend safety net.
 *
 * Title comes back via the `X-Omnitab-Title` response header. In prod the
 * proxy fills it from YouTube's anonymous oEmbed endpoint so we always
 * have a real title — even when Cobalt's response wouldn't normally carry
 * one. The 10-minute cap is enforced server-side (OMNITAB_YT_MAX_DURATION_S
 * on the HF Space).
 */
export async function fetchYoutubeAudio(
  url: string,
): Promise<{ blob: Blob; title: string }> {
  // In prod, ALWAYS route through the Vercel proxy — even when the user has
  // configured a custom Demucs URL in Settings. The proxy is the only place
  // where the multi-backend fallback chain (HF Space → Piped) lives, and we
  // can't replicate that client-side without re-implementing all of it. The
  // custom backend is still hit directly for the heavy `/separate-stream`
  // call (see separateStem above) — only YT extraction is centralised here.
  //
  // In dev (`vite dev`), Vercel functions don't run, so we bypass the proxy
  // and talk to whatever backend is configured. Self-hosters hacking on
  // this locally need their own /youtube-audio endpoint up.
  const useProxy = !import.meta.env.DEV;

  let endpoint: string;
  if (useProxy) {
    endpoint = `/api/youtube-audio?url=${encodeURIComponent(url)}`;
  } else {
    const baseUrl = getBackendUrl();
    if (!baseUrl) throw new Error('Aucun backend configuré (voir Réglages).');
    endpoint = `${baseUrl}/youtube-audio?url=${encodeURIComponent(url)}`;
  }

  const res = await fetch(endpoint);

  if (!res.ok) {
    // The proxy and the HF Space both reply with `{ "detail": "..." }`
    // on error. Unwrap that so the user sees a clean French sentence
    // instead of a raw JSON blob in the error toast.
    const raw = await res.text().catch(() => '');
    let detail = raw;
    try {
      const j = JSON.parse(raw) as { detail?: string; error?: string };
      detail = j.detail ?? j.error ?? raw;
    } catch {
      // not JSON — keep the raw text
    }
    throw new Error(
      `YouTube a échoué (HTTP ${res.status})${detail ? ` : ${detail}` : ''}`,
    );
  }

  const blob = await res.blob();
  const title = res.headers.get('X-Omnitab-Title') || 'YouTube audio';
  return { blob, title };
}
