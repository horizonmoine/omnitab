/**
 * Google Gemini REST API client.
 *
 * We use Gemini for the auto-config fallback: when the user asks for a
 * tone preset for a song that's not in our curated SONG_PRESETS list,
 * we ask Gemini to generate one. The API has a free tier:
 *   - gemini-flash-latest: 15 RPM, 1500 RPD (more than enough for this)
 *
 * The API key is user-supplied (Settings → Gemini API Key) and stored
 * in IndexedDB. We never proxy through our backend — direct browser →
 * Google call. This keeps the architecture simple AND ensures we don't
 * accidentally pay for the user's lookups.
 *
 * Why direct browser → Google? Two reasons:
 *   1. The free tier is per API-key, so each user has their own quota.
 *   2. Putting the key on Vercel would mean all our users share one
 *      quota and we'd burn through it in a day.
 *
 * Get a key (free): https://aistudio.google.com/app/apikey
 */

import { getSettings } from './settings';

// Production API base. Latest 1.5 is "gemini-1.5-flash-latest" which
// always points to the freshest non-experimental flash model.
const ENDPOINT_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_MODEL = 'gemini-flash-latest';

export interface GeminiCallOptions {
  /** Override the default model — e.g. 'gemini-pro' for higher quality. */
  model?: string;
  /** Force JSON output. Sets `response_mime_type: 'application/json'`. */
  responseJson?: boolean;
  /** 0..2, higher = more creative. Default 0.4 — we want consistent picks. */
  temperature?: number;
  /** Abort the call if it takes longer than this. */
  timeoutMs?: number;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * Send a single-prompt request to Gemini. Returns the model's text
 * response — caller is responsible for parsing JSON if `responseJson`
 * was requested.
 */
export async function callGemini(
  prompt: string,
  opts: GeminiCallOptions = {},
): Promise<string> {
  const apiKey = getSettings().geminiApiKey?.trim();
  if (!apiKey) {
    throw new GeminiError(
      'Aucune clé Gemini configurée. Va dans Réglages pour en ajouter une (gratuite sur aistudio.google.com).',
    );
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const url = `${ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      ...(opts.responseJson ? { responseMimeType: 'application/json' } : {}),
    },
  };

  // Timeout via AbortController. Default 20s — Gemini Flash usually
  // returns in 1-3s, but cold starts on the user's network can be slow.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // AbortError when the timeout fires — give a friendlier message.
    if ((err as Error).name === 'AbortError') {
      throw new GeminiError('Timeout — Gemini a mis trop longtemps à répondre.');
    }
    throw new GeminiError('Réseau injoignable — vérifie ta connexion.', undefined, err);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Gemini returns useful error JSON: { error: { code, message, status } }
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.error?.message ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    // Friendlier mapping for common HTTP status codes.
    if (res.status === 400) {
      throw new GeminiError(`Requête invalide — clé incorrecte ?\n${detail}`, 400);
    }
    if (res.status === 403) {
      throw new GeminiError(`Clé refusée par Google — vérifie qu'elle est active.\n${detail}`, 403);
    }
    if (res.status === 429) {
      throw new GeminiError(`Quota gratuit dépassé. Réessaie demain ou passe en payant.\n${detail}`, 429);
    }
    throw new GeminiError(`Gemini a renvoyé HTTP ${res.status}: ${detail}`, res.status);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !text) {
    throw new GeminiError('Réponse Gemini vide.');
  }
  return text;
}

/**
 * Parse JSON from Gemini's response. Some models occasionally wrap the
 * JSON in markdown code fences (```json ... ```), so we strip those
 * defensively before parsing.
 */
export function parseGeminiJson<T = unknown>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new GeminiError(
      `JSON Gemini invalide :\n${cleaned.slice(0, 200)}…`,
      undefined,
      err,
    );
  }
}
