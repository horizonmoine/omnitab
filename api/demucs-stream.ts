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
 *   call to HF Space happens server-side from Vercel's compute, which
 *   has no AV in the loop.
 *
 * RUNTIME
 *   Node.js (Fluid Compute, default). NOT Edge — the cold-cache path of
 *   /separate-stream takes ~3 minutes (Demucs forward pass) and Edge has
 *   a 25s hard cap that we already learned the hard way is uncircumventable.
 *
 *   Cannot use the (request: Request) => Response shape that the other
 *   /api handlers use on Edge: Vercel's Node.js runtime for raw /api/*.ts
 *   files in a Vite project expects the legacy (req, res) shape from
 *   @vercel/node. Mixing breaks deploys with FUNCTION_INVOCATION_FAILED.
 *
 * STREAMING
 *   We forward the multipart body and the WAV response without buffering
 *   either of them in memory. That's important because:
 *     - Request: ~4 MB Opus/m4a/webm uploads. Buffering = pointless RAM hit.
 *     - Response: ~40 MB WAV stem. Buffering would trip Vercel's per-function
 *       memory limit AND make the PWA wait until the entire stem is in RAM
 *       before any byte is dispatched.
 *
 *   Node 18+'s fetch (undici) accepts a Readable stream as `body` when
 *   `duplex: 'half'` is set. We pipe the upstream Web ReadableStream
 *   back to the client via stream/promises.pipeline → zero-copy.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HF_SPACE = 'https://horizonmoine30-omnitab-demucs.hf.space';

// Whitelist the model + stem to avoid being a fully open relay against
// HF Space. Same defaults as the PWA / hf-space/app.py.
const VALID_STEMS = new Set(['vocals', 'drums', 'bass', 'other', 'guitar', 'piano']);
const VALID_MODELS = new Set(['htdemucs', 'htdemucs_ft', 'mdx_extra', 'mdx_extra_q']);

// Vercel function config — needs to outlive Demucs's first-cache-miss run
// (~3 min) but not be open-ended. 240s = 3 min Demucs + a comfortable
// margin for streaming the 40 MB response back over a slow connection.
export const config = {
  maxDuration: 240,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ detail: 'POST only' });
    return;
  }

  // Validate query params before we waste compute on an upload.
  const stem = String(req.query.stem ?? 'vocals');
  const model = String(req.query.model ?? 'htdemucs');
  if (!VALID_STEMS.has(stem)) {
    res.status(400).json({ detail: `unknown stem '${stem}'` });
    return;
  }
  if (!VALID_MODELS.has(model)) {
    res.status(400).json({ detail: `unknown model '${model}'` });
    return;
  }

  const upstreamUrl =
    `${HF_SPACE}/separate-stream` +
    `?stem=${encodeURIComponent(stem)}` +
    `&model=${encodeURIComponent(model)}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      // req IS a Node.js IncomingMessage which is a Readable stream.
      // undici accepts that as `body` when duplex is set.
      body: req as unknown as ReadableStream<Uint8Array>,
      headers: {
        // Forward the multipart boundary so HF Space's FastAPI multipart
        // parser can find the file part. Other client headers (UA,
        // Accept-Language, etc.) are dropped intentionally — we don't
        // want to leak the real client identity to HF.
        'Content-Type':
          req.headers['content-type'] ?? 'multipart/form-data',
      },
      // Required for streaming request bodies in Node 18+. Without this,
      // undici waits for the entire body before sending — defeats the
      // whole point of this proxy.
      // @ts-expect-error: TS lib doesn't have duplex on RequestInit yet
      duplex: 'half',
    });
  } catch (err) {
    // Network-level failure reaching HF (sleep, DNS, 5xx upstream).
    // Surface a clean French error so the PWA toast is readable.
    res.status(502).json({
      detail: `Backend Demucs injoignable : ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return;
  }

  // Mirror the upstream status (so HTTPException 4xx/5xx from FastAPI
  // surfaces correctly to the PWA).
  res.status(upstream.status);

  // Forward the headers that matter for stream consumption. Skip
  // hop-by-hop and security-sensitive ones.
  const ctype = upstream.headers.get('Content-Type') ?? 'application/octet-stream';
  res.setHeader('Content-Type', ctype);
  const cd = upstream.headers.get('Content-Disposition');
  if (cd) res.setHeader('Content-Disposition', cd);
  // Same-origin so CORS isn't strictly needed, but harmless and helps
  // when the user opens the URL directly for debugging.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!upstream.body) {
    res.end();
    return;
  }

  // Pipe upstream → client without intermediate buffering. If the client
  // disconnects mid-stream, pipeline rejects and we propagate the abort
  // upstream by virtue of the AbortController inside undici (cleaning
  // up the HF connection).
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    // Client likely disconnected before the response finished. Nothing
    // useful to do — Vercel will end the function. Log so we can see
    // it in `vercel logs` if it ever becomes a debugging target.
    // eslint-disable-next-line no-console
    console.warn('demucs-stream pipeline aborted:', err);
  }
}
