/**
 * Vercel Edge Function — Songsterr CORS proxy.
 *
 * Songsterr's API doesn't set Access-Control-Allow-Origin, so browsers
 * block direct fetches from our Vercel domain. This function proxies
 * requests to songsterr.com and adds the necessary CORS headers.
 *
 * Stays on Edge runtime: the handler uses the Web Fetch API signature
 * `(request: Request) => Response`, which Edge runs natively. A previous
 * attempt to drop the `runtime: 'edge'` config (to inherit the Fluid
 * Compute default) crashed in prod with FUNCTION_INVOCATION_FAILED — the
 * Node.js runtime expects `(req, res)` from `@vercel/node`. Migrating to
 * Fluid is queued as a follow-up that rewrites all three /api handlers.
 *
 * Usage from the frontend:
 *   fetch('/api/songsterr?path=/songs.json?pattern=metallica')
 *
 * Deployed automatically by Vercel when it detects the /api directory.
 */

export const config = { runtime: 'edge' };

const SONGSTERR_BASE = 'https://www.songsterr.com/api';
const ALLOWED_PATHS = ['/songs', '/song/', '/meta/'];

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');

  if (!path) {
    return new Response(JSON.stringify({ error: 'Missing ?path= parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Only allow known Songsterr API paths to prevent open proxy abuse.
  const isAllowed = ALLOWED_PATHS.some((p) => path.startsWith(p));
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Path not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const upstream = await fetch(`${SONGSTERR_BASE}${path}`, {
      headers: { Accept: 'application/json' },
    });

    const body = await upstream.arrayBuffer();

    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Upstream error: ${(err as Error).message}` }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}
