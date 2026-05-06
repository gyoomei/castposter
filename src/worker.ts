type Env = {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
};

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

type CacheStorageWithDefault = CacheStorage & {
  default: Cache;
};

type WorkerExport = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

const WARPCAST_API = 'https://api.warpcast.com/v2';
const CACHE_SECONDS = 45;
const SHARE_IMAGE_WIDTH = 1200;
const SHARE_IMAGE_HEIGHT = 800;

function escapeXml(value = ''): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapSvgText(value: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }

    if (lines.length === maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, '').slice(0, Math.max(0, maxCharsPerLine - 1))}…`;
  }

  return lines.length ? lines : ['I minted a Farcaster cast as an NFT'];
}

function buildShareCardSvg(requestUrl: URL): string {
  const castText = requestUrl.searchParams.get('text') || requestUrl.searchParams.get('cast') || 'I minted a Farcaster cast as an NFT';
  const style = requestUrl.searchParams.get('style') || 'neon';
  const lines = wrapSvgText(castText, 32, 5)
    .map((line, index) => `<text x="110" y="${305 + index * 66}">${escapeXml(line)}</text>`)
    .join('\n      ');

  const accent = style === 'poster' ? '#fde047' : style === 'minimal' ? '#38bdf8' : '#55e7ff';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" viewBox="0 0 ${SHARE_IMAGE_WIDTH} ${SHARE_IMAGE_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#02040a"/><stop offset=".55" stop-color="#111a35"/><stop offset="1" stop-color="#3a0a3d"/></linearGradient>
    <linearGradient id="border" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#55e7ff"/><stop offset=".55" stop-color="#ff5bd7"/><stop offset="1" stop-color="#ffd166"/></linearGradient>
  </defs>
  <rect width="1200" height="800" rx="54" fill="url(#bg)"/>
  <circle cx="1020" cy="120" r="230" fill="#ff5bd7" opacity=".23"/>
  <circle cx="125" cy="720" r="260" fill="#55e7ff" opacity=".20"/>
  <rect x="54" y="54" width="1092" height="692" rx="42" fill="rgba(255,255,255,.055)" stroke="url(#border)" stroke-width="5"/>
  <text x="110" y="150" fill="${accent}" font-family="Arial,sans-serif" font-size="48" font-weight="900" letter-spacing="8">CASTMINT</text>
  <text x="110" y="205" fill="#9aa4bd" font-family="Arial,sans-serif" font-size="28" font-weight="800" letter-spacing="3">FARCASTER CAST NFT • BASE</text>
  <g fill="#ffffff" font-family="Arial,sans-serif" font-size="52" font-weight="900">
      ${lines}
  </g>
  <rect x="110" y="660" width="255" height="4" rx="2" fill="${accent}"/>
  <text x="110" y="710" fill="#ffffff" font-family="Arial,sans-serif" font-size="30" font-weight="900">Mint your own cast NFT</text>
</svg>`;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type');
  headers.set('Vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return withCors(new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  }));
}

function svgResponse(svg: string): Response {
  return withCors(new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  }));
}

function buildWarpcastUrl(requestUrl: URL): URL | null {
  const prefix = '/api/warpcast';
  if (!requestUrl.pathname.startsWith(prefix)) return null;

  const upstreamPath = requestUrl.pathname.slice(prefix.length);
  if (!upstreamPath || upstreamPath === '/') return null;

  const allowedPaths = new Set(['/user-by-username', '/casts']);
  if (!allowedPaths.has(upstreamPath)) return null;

  const upstream = new URL(`${WARPCAST_API}${upstreamPath}`);
  requestUrl.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));
  return upstream;
}

const worker: WorkerExport = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === '/api/share-card') {
      return svgResponse(buildShareCardSvg(url));
    }

    const upstream = buildWarpcastUrl(url);
    if (!upstream) {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
      const cache = (caches as CacheStorageWithDefault).default;
      const cacheKey = new Request(upstream.toString(), { method: 'GET' });
      const cached = await cache.match(cacheKey);
      if (cached) return withCors(cached);

      const upstreamResponse = await fetch(upstream, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'castposter-miniapp/1.0',
        },
      });

      const headers = new Headers(upstreamResponse.headers);
      headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
      headers.delete('set-cookie');

      const response = withCors(new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers,
      }));

      if (upstreamResponse.ok) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    } catch (error) {
      console.error('Warpcast proxy failed:', error);
      return jsonResponse({ error: 'Warpcast proxy unavailable' }, 502);
    }
  },
};

export default worker;
