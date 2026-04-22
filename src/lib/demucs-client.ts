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
  const baseUrl = getBackendUrl();
  if (!baseUrl) throw new Error('Aucun backend Demucs configuré (voir Réglages).');

  onProgress?.({ progress: 0.05, status: `Envoi au backend Demucs…` });

  const form = new FormData();
  form.append('file', file, 'audio.wav');

  const url = `${baseUrl}/separate-stream?stem=${encodeURIComponent(stem)}`;

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
 * The server caps videos at 10 minutes (configurable via OMNITAB_YT_MAX_DURATION_S)
 * to keep the Space responsive. Returns the MP3 blob plus a best-effort title
 * lifted from yt-dlp's metadata (via the `X-Omnitab-Title` response header).
 */
export async function fetchYoutubeAudio(
  url: string,
): Promise<{ blob: Blob; title: string }> {
  const baseUrl = getBackendUrl();
  if (!baseUrl) throw new Error('Aucun backend configuré (voir Réglages).');

  const endpoint = `${baseUrl}/youtube-audio?url=${encodeURIComponent(url)}`;
  const res = await fetch(endpoint);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `YouTube a échoué (HTTP ${res.status})${detail ? ` : ${detail}` : ''}`,
    );
  }

  const blob = await res.blob();
  const title = res.headers.get('X-Omnitab-Title') || 'YouTube audio';
  return { blob, title };
}
