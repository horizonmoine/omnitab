/**
 * Vercel Function — same-origin proxy to HF Space's /separate-stream.
 *
 * WHY THIS EXISTS
 *   Some users have antivirus / browser-shield software (Defender, Avast,
 *   Norton, Kaspersky, etc.) that intercepts cross-origin POSTs from
 *   regular browsing modes — but lets InPrivate / Incognito requests
 *   through. The PWA's direct call to `https://...hf.space/separate-stream`
 *   fails with `net::ERR_FAILED` in normal mode for those users, with no
 *   recoverable error info.
 *
 *   By forwarding the request through this Vercel function, the PWA's
 *   browser only sees a same-origin POST to `omnitab-henna.vercel.app`,
 *   which never trips the AV's third-party-fetch heuristics. The actual
 *   call to HF Space happens server-side from Vercel's compute, where
 *   no AV is in the loop.
 *
 * RUNTIME — Node.js (Fluid Compute, the Vite + raw /api/*.ts default).
 *   NOT Edge: cold-cache /separate-stream takes ~3 minutes (Demucs
 *   forward pass) and Edge has a 25s hard cap.
 *
 * STREAMING
 *   We forward the multipart body and the WAV response without buffering
 *   either of them. undici (Node 18+ fetch) accepts a Readable as body
 *   when duplex is set to 'half'; we then pipe the upstream Web stream
 *   back via stream/promises.pipeline.
 *
 *   The function uses plain Node types (IncomingMessage / ServerResponse)
 *   instead of @vercel/node's VercelRequest / VercelResponse — that
 *   package was failing to resolve on Vercel's build for this file
 *   specifically, leaving /api/demucs-stream as a 404 NOT_FOUND in prod.
 *   Plain Node types compile against the built-in lib regardless of
 *   what's in node_modules.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HF_SPACE = 'https://horizonmoine30-omnitab-demucs.hf.space';

// Whitelist the model + stem to avoid being a fully open relay against
// HF Space. Same defaults as the PWA / hf-space/app.py.
const VALID_STEMS = new Set(['vocals', 'drums', 'bass', 'other', 'guitar', 'piano']);
const VALID_MODELS = new Set(['htdemucs', 'htdemucs_ft', 'mdx_extra', 'mdx_extra_q']);

// Vercel function config — needs to outlive Demucs's first-cache-miss run
// (~3 min). 240s = 3 min Demucs + a comfortable margin for streaming the
// 40 MB response back over a slow connection.
export const config = {
  maxDuration: 240,
};

// undici (Node 18+ fetch) accepts Readable streams as `body` when the
// `duplex: 'half'` flag is set. The standard RequestInit type lacked this
// field until very recently — we extend locally to avoid any directive
// (like @ts-expect-error) that would mis-fire if/when the upstream type
// catches up and break the build silently.
type DuplexRequestInit = RequestInit & { duplex?: 'half' };

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ detail: 'POST only' }));
    return;
  }

  // Parse query params from the raw URL — Node's IncomingMessage doesn't
  // give us a parsed query like Express/Vercel-typed handlers would.
  const fullUrl = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);
  const stem = fullUrl.searchParams.get('stem') ?? 'vocals';
  const model = fullUrl.searchParams.get('model') ?? 'htdemucs';

  if (!VALID_STEMS.has(stem)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ detail: `unknown stem '${stem}'` }));
    return;
  }
  if (!VALID_MODELS.has(model)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ detail: `unknown model '${model}'` }));
    return;
  }

  const upstreamUrl =
    `${HF_SPACE}/separate-stream` +
    `?stem=${encodeURIComponent(stem)}` +
    `&model=${encodeURIComponent(model)}`;

  let upstream: Response;
  try {
    const init: DuplexRequestInit = {
      method: 'POST',
      // IncomingMessage IS a Readable; undici accepts it as body when
      // the duplex flag below is set.
      body: req as unknown as BodyInit,
      headers: {
        // Forward the multipart boundary so HF Space's FastAPI multipart
        // parser can find the file part. Other client headers are dropped
        // intentionally — we don't want to leak the real client identity.
        'Content-Type':
          (req.headers['content-type'] as string | undefined) ??
          'multipart/form-data',
      },
      // Required for streaming request bodies in Node 18+ undici.
      duplex: 'half',
    };
    upstream = await fetch(upstreamUrl, init);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        detail: `Backend Demucs injoignable : ${
          err instanceof Error ? err.message : String(err)
        }`,
      }),
    );
    return;
  }

  // Mirror the upstream status (so HTTPException 4xx/5xx from FastAPI
  // surfaces correctly to the PWA).
  res.statusCode = upstream.status;

  const ctype = upstream.headers.get('Content-Type') ?? 'application/octet-stream';
  res.setHeader('Content-Type', ctype);
  const cd = upstream.headers.get('Content-Disposition');
  if (cd) res.setHeader('Content-Disposition', cd);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!upstream.body) {
    res.end();
    return;
  }

  // Pipe upstream → client without intermediate buffering. If the client
  // disconnects, pipeline rejects and undici cancels the upstream fetch.
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    // Client likely disconnected. Nothing useful to do — Vercel ends the
    // function. Logged so it's visible in `vercel logs`.
    // eslint-disable-next-line no-console
    console.warn('demucs-stream pipeline aborted:', err);
  }
}
