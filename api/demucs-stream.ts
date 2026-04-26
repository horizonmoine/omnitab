/**
 * Vercel Edge Function — same-origin proxy to HF Space's /separate-stream.
 *
 * WHY THIS EXISTS
 *   Some users have antivirus / browser-shield software (Defender, Avast,
 *   Norton, Kaspersky, etc.) that intercepts cross-origin POSTs from
 *   regular browsing modes — but lets InPrivate / Incognito requests
 *   through. The PWA's direct call to `https://...hf.space/separate-stream`
 *   fails with `net::ERR_FAILED` in normal mode for those users, with no
 *   recoverable error info.
 *
 *   By forwarding the request through this Vercel function, the browser
 *   only sees a same-origin POST to `omnitab-henna.vercel.app`, which
 *   never trips the AV's third-party-fetch heuristics. The actual call
 *   to HF Space happens server-side from Vercel — no AV in the loop.
 *
 * RUNTIME — Edge.
 *   Edge is the only runtime where `(request: Request) => Response`
 *   handlers reliably deploy on Vite + raw /api/*.ts (the Node.js
 *   fluid runtime kept failing silently — function went 404 NOT_FOUND
 *   while other Edge functions deployed normally).
 *
 *   Limitation: Edge has a 25s hard cap. The first POST for a NEW audio
 *   file triggers ~3 min of Demucs compute on HF — that times out here.
 *   But Demucs writes its stems to a disk cache keyed by SHA256(file),
 *   so subsequent POSTs for the same file are <1s cache HITs that fit
 *   comfortably. Workflow for new files: process once in incognito (no
 *   AV interception, hits HF directly with no time limit), then replay
 *   in normal mode (this proxy, cache HIT, sub-second).
 *
 * STREAMING
 *   We forward `request.body` (a Web ReadableStream) directly into
 *   undici's fetch via `duplex: 'half'`. The upstream response body is
 *   passed straight to the Response constructor — both directions are
 *   zero-copy at the JS layer.
 */

export const config = { runtime: 'edge' };

const HF_SPACE = 'https://horizonmoine30-omnitab-demucs.hf.space';

// Whitelist the model + stem to avoid being a fully open relay against
// HF Space. Same defaults as the PWA / hf-space/app.py.
const VALID_STEMS = new Set(['vocals', 'drums', 'bass', 'other', 'guitar', 'piano']);
const VALID_MODELS = new Set(['htdemucs', 'htdemucs_ft', 'mdx_extra', 'mdx_extra_q']);

// undici (the fetch impl Edge runtime uses) accepts a Web ReadableStream
// as `body` but requires `duplex: 'half'` for streaming. The standard
// RequestInit type lacks this field in some TS lib versions; we extend
// locally so the build doesn't depend on the exact lib evolution.
type DuplexRequestInit = RequestInit & { duplex?: 'half' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonError(405, 'POST only');
  }

  const url = new URL(request.url);
  const stem = url.searchParams.get('stem') ?? 'vocals';
  const model = url.searchParams.get('model') ?? 'htdemucs';

  if (!VALID_STEMS.has(stem)) {
    return jsonError(400, `unknown stem '${stem}'`);
  }
  if (!VALID_MODELS.has(model)) {
    return jsonError(400, `unknown model '${model}'`);
  }

  const upstreamUrl =
    `${HF_SPACE}/separate-stream` +
    `?stem=${encodeURIComponent(stem)}` +
    `&model=${encodeURIComponent(model)}`;

  let upstream: Response;
  try {
    const init: DuplexRequestInit = {
      method: 'POST',
      // Stream the multipart body straight through. No buffering on our side.
      body: request.body,
      headers: {
        'Content-Type':
          request.headers.get('Content-Type') ?? 'multipart/form-data',
      },
      duplex: 'half',
    };
    upstream = await fetch(upstreamUrl, init);
  } catch (err) {
    return jsonError(
      502,
      `Backend Demucs injoignable : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // If HF returned an error, still pass through the JSON detail so the
  // PWA's Demucs error toast shows something actionable.
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return new Response(
      detail || JSON.stringify({ detail: `HF HTTP ${upstream.status}` }),
      {
        status: upstream.status,
        headers: {
          'Content-Type':
            upstream.headers.get('Content-Type') ?? 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  // Stream the upstream WAV body straight to the client. Response
  // constructor with a ReadableStream uses chunk-by-chunk delivery —
  // no full-body buffer on either side.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'audio/wav',
      'Content-Disposition':
        upstream.headers.get('Content-Disposition') ??
        `attachment; filename="${stem}.wav"`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Disposition',
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
