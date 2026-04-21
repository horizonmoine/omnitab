/**
 * Vercel Function (Fluid Compute) — health & status endpoint.
 *
 * Cheap probe by default: just confirms the Vercel Function is alive and
 * reports app metadata. Useful for uptime monitors (UptimeRobot, BetterStack)
 * that hit it every 1–5 minutes — we don't want those probes to wake the
 * sleeping HF Space backend on every check.
 *
 * Pass `?probe=demucs` to additionally test the HF Space (3s timeout, won't
 * actually wake a sleeping Space — just reports `asleep` if it doesn't
 * respond fast). Use this for one-off manual checks, not for monitoring.
 *
 * Response shape:
 *   {
 *     "status": "ok",
 *     "service": "omnitab",
 *     "version": "0.1.0",
 *     "timestamp": "2026-04-22T10:30:00.000Z",
 *     "region": "iad1",                  // Vercel region (when available)
 *     "dependencies": {                  // only present when ?probe=… given
 *       "demucs": {
 *         "status": "online" | "asleep" | "error",
 *         "url": "https://horizonmoine30-omnitab-demucs.hf.space",
 *         "device": "cpu",               // present iff status === "online"
 *         "model": "htdemucs",
 *         "latencyMs": 187
 *       }
 *     }
 *   }
 */

const VERSION = '0.1.0';
const SERVICE = 'omnitab';
const DEMUCS_URL = 'https://horizonmoine30-omnitab-demucs.hf.space';
const PROBE_TIMEOUT_MS = 3000;

interface DemucsHealth {
  status: 'ok';
  device: string;
  default_model: string;
  cuda_available: boolean;
  torch_version: string;
}

interface DependencyStatus {
  status: 'online' | 'asleep' | 'error';
  url: string;
  device?: string;
  model?: string;
  latencyMs?: number;
  error?: string;
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const probe = url.searchParams.get('probe');

  const body: Record<string, unknown> = {
    status: 'ok',
    service: SERVICE,
    version: VERSION,
    timestamp: new Date().toISOString(),
    // Vercel injects this header on every request; absent in local `vercel dev`.
    region: request.headers.get('x-vercel-id')?.split('::')[0] ?? null,
  };

  if (probe === 'demucs' || probe === 'all') {
    body.dependencies = {
      demucs: await probeDemucs(),
    };
  }

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Healthchecks should never be cached — stale data defeats the purpose.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Quick probe of the HF Space backend. Tight timeout means a sleeping Space
 * shows as `asleep` rather than blocking the response — by the time the
 * Space wakes up (30-60s), this request will be long gone.
 */
async function probeDemucs(): Promise<DependencyStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(`${DEMUCS_URL}/health`, {
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        status: 'error',
        url: DEMUCS_URL,
        latencyMs,
        error: `HTTP ${res.status}`,
      };
    }

    const health = (await res.json()) as DemucsHealth;
    return {
      status: 'online',
      url: DEMUCS_URL,
      device: health.device,
      model: health.default_model,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    // AbortError = timeout = sleeping Space. Anything else = real error.
    if ((err as Error).name === 'AbortError') {
      return { status: 'asleep', url: DEMUCS_URL, latencyMs };
    }
    return {
      status: 'error',
      url: DEMUCS_URL,
      latencyMs,
      error: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
