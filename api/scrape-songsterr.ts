export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const songId = url.searchParams.get('id');

  if (!songId) {
    return jsonError(400, 'Paramètre ?id= manquant.');
  }

  try {
    // 1. Fetch the HTML page. 
    // The exact slug doesn't matter, Songsterr resolves the page purely by the `-s[ID]` suffix.
    const targetUrl = `https://www.songsterr.com/a/wsa/x-tab-s${songId}`;
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'OmniTab/1.0 (+https://omnitab-henna.vercel.app)',
      },
    });

    if (!res.ok) {
      return jsonError(res.status, 'Impossible de joindre Songsterr.');
    }

    const html = await res.text();

    // 2. Extract the S3 / CDN URL of the Guitar Pro file from the HTML.
    // The file URL is usually embedded in the JSON state (e.g., "source":"https://.../revision.gp5")
    const match = html.match(/(https:\/\/[^"]+\.gp[345x]?)/i);
    
    if (match && match[1]) {
      return new Response(JSON.stringify({ url: match[1] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return jsonError(404, 'URL du fichier Guitar Pro introuvable sur la page.');
  } catch (err) {
    return jsonError(500, `Erreur serveur: ${(err as Error).message}`);
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
