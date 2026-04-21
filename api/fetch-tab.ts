/**
 * Vercel Edge Function — arbitrary .gp / .xml / .tex file CORS proxy.
 *
 * Songsterr killed its public .gp download endpoint in 2024, but plenty
 * of smaller sites (mysongbook.com, azpro.de, tabs.ultimate-guitar.com
 * mirrors, personal pages) still host tab files freely. Most don't set
 * Access-Control-Allow-Origin, so the browser can't fetch them directly.
 *
 * This proxy fetches the URL, validates it's a reasonable tab file, and
 * streams the bytes back with CORS headers.
 *
 * Usage from the frontend:
 *   fetch('/api/fetch-tab?url=' + encodeURIComponent('https://…/song.gp5'))
 *
 * Security measures:
 *   • HTTPS only
 *   • Extension whitelist (.gp / .gp3 / .gp4 / .gp5 / .gpx / .xml /
 *     .musicxml / .mxl / .tex / .alphatex)
 *   • 10 MB cap — rejects via Content-Length header if the server reports
 *     it, and again after reading if the server lied
 *   • 15s upstream timeout
 *   • Blocks private/loopback hostnames to curb naive SSRF. Vercel's Edge
 *     runtime already blocks private IPs at the network layer, but the
 *     hostname check catches obvious attempts early with a cleaner error.
 */

export const config = { runtime: 'edge' };

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — plenty for any real tab.
const TIMEOUT_MS = 15000;

const ALLOWED_EXTENSIONS = [
  '.gp',
  '.gp3',
  '.gp4',
  '.gp5',
  '.gpx',
  '.xml',
  '.musicxml',
  '.mxl',
  '.tex',
  '.alphatex',
];

/**
 * Hostname prefixes that must never be proxied — RFC1918 private space,
 * loopback, and link-local. These are a best-effort safety net: Vercel's
 * Edge runtime already blocks private IPs at the network layer, but we
 * reject early with a clean error message.
 *
 * Each entry is either a full host (match ==) or a dotted prefix (match
 * startsWith). The trailing dot on numeric prefixes matters — without it
 * "172.2" would also match the PUBLIC range "172.200.*".
 */
const BLOCKED_HOSTS = new Set(['localhost']);
const BLOCKED_HOST_PREFIXES = [
  '127.',
  '10.',
  '169.254.',
  '192.168.',
  // 172.16.0.0 – 172.31.255.255 (the private /12). Enumerate each /16
  // so startsWith doesn't accidentally match the public 172.32–255.*.
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
];
const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost'];

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return jsonError(400, 'Paramètre ?url= manquant.');
  }

  // Parse + validate the target URL.
  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonError(400, 'URL invalide.');
  }

  if (targetUrl.protocol !== 'https:') {
    return jsonError(400, 'Seules les URLs HTTPS sont autorisées.');
  }

  const host = targetUrl.hostname.toLowerCase();
  const isPrivate =
    BLOCKED_HOSTS.has(host) ||
    BLOCKED_HOST_PREFIXES.some((p) => host.startsWith(p)) ||
    BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s));
  if (isPrivate) {
    return jsonError(403, 'Hôte privé ou local interdit.');
  }

  // Extension whitelist — checked on the pathname, ignoring query / hash.
  const pathname = targetUrl.pathname.toLowerCase();
  const hasAllowedExt = ALLOWED_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  if (!hasAllowedExt) {
    return jsonError(
      400,
      `L'URL doit se terminer par: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    );
  }

  // Fetch with timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Some hosts refuse requests without a UA. Declare ourselves openly.
        'User-Agent': 'OmniTab/1.0 (+https://omnitab-henna.vercel.app)',
      },
    });

    if (!upstream.ok) {
      return jsonError(
        upstream.status,
        `Le serveur distant a répondu ${upstream.status}.`,
      );
    }

    // Fast-reject via Content-Length if the server reports one.
    const contentLength = upstream.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_SIZE_BYTES) {
      return jsonError(
        413,
        `Fichier trop gros (max ${MAX_SIZE_BYTES / 1024 / 1024} Mo).`,
      );
    }

    // Read fully, then re-check size in case the header was wrong or missing.
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_SIZE_BYTES) {
      return jsonError(
        413,
        `Fichier trop gros (max ${MAX_SIZE_BYTES / 1024 / 1024} Mo).`,
      );
    }

    const filename = pathname.split('/').pop() ?? 'tab';
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return jsonError(504, 'Temps de réponse dépassé (15s).');
    }
    return jsonError(502, `Erreur réseau: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
