/**
 * Client minimal pour le backend Demucs local (FastAPI).
 *
 * Le backend tourne sur ton PC — voir backend/server.py. La PWA l'atteint
 * via l'URL `VITE_DEMUCS_API` ou, par défaut, `http://localhost:8000`.
 *
 * Toutes les méthodes sont conçues pour échouer proprement : si le backend
 * n'est pas joignable, `isBackendAvailable()` renvoie `false` et l'UI peut
 * désactiver les options qui en dépendent.
 */

// Compile-time fallback. In dev we default to the local FastAPI server so
// `npm run dev` just works when the user has the Python backend running.
// In prod we default to empty string — Vercel serves OmniTab over HTTPS
// and hitting `http://localhost:8000` would be blocked as mixed-content,
// logging a scary error on every boot. An empty URL signals "no backend
// configured" and `isBackendAvailable()` short-circuits to `null` without
// making any network call. Users who want Demucs in prod paste their HF
// Space URL into Settings → Backend Demucs.
const BACKEND_URL_FALLBACK =
  (import.meta.env.VITE_DEMUCS_API as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:8000' : '');

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
 * Short-circuits immediately to `null` when no backend URL is configured
 * (the prod default). This avoids a pointless `fetch('')` or mixed-content
 * error against `http://localhost` from an HTTPS page.
 */
export async function isBackendAvailable(
  timeoutMs = 1500,
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
