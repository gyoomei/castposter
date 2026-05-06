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

type ShareTextFit = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
};

function estimateTextUnits(value: string): number {
  return Array.from(value).reduce((total, char) => {
    if (/\s/.test(char)) return total + 0.32;
    if (/[il.,'!|]/.test(char)) return total + 0.34;
    if (/[MW@#%&]/.test(char)) return total + 0.9;
    if (/[^\x00-\x7F]/.test(char)) return total + 0.95;
    return total + 0.58;
  }, 0);
}

function splitLongWord(word: string, maxUnits: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const char of Array.from(word)) {
    if (current && estimateTextUnits(`${current}${char}`) > maxUnits) {
      chunks.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapTextByUnits(value: string, maxUnits: number): string[] {
  const words = value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const pieces = estimateTextUnits(word) > maxUnits ? splitLongWord(word, maxUnits) : [word];
    for (const piece of pieces) {
      const next = current ? `${current} ${piece}` : piece;
      if (current && estimateTextUnits(next) > maxUnits) {
        lines.push(current);
        current = piece;
      } else {
        current = next;
      }
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : ['I minted a Farcaster cast as an NFT'];
}

function fitShareText(value: string): ShareTextFit {
  const boxWidth = 980;
  const boxHeight = 300;
  const ratio = 1.18;

  for (let fontSize = 56; fontSize >= 26; fontSize -= 2) {
    const lineHeight = Math.round(fontSize * ratio);
    const maxLines = Math.max(1, Math.floor(boxHeight / lineHeight));
    const maxUnits = boxWidth / fontSize;
    const lines = wrapTextByUnits(value, maxUnits);
    if (lines.length <= maxLines) return { lines, fontSize, lineHeight };
  }

  const fontSize = 26;
  const lineHeight = Math.round(fontSize * ratio);
  const maxLines = Math.max(1, Math.floor(boxHeight / lineHeight));
  const lines = wrapTextByUnits(value, boxWidth / fontSize).slice(0, maxLines);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1] || '';
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1)).replace(/…$/, '')}…`;
  }
  return { lines, fontSize, lineHeight };
}

function buildShareCardSvg(requestUrl: URL): string {
  const castText = requestUrl.searchParams.get('text') || requestUrl.searchParams.get('cast') || 'I minted a Farcaster cast as an NFT';
  const rawAuthor = (requestUrl.searchParams.get('author') || '').replace(/^@+/, '').trim();
  const authorLabel = rawAuthor ? `@${rawAuthor}` : 'Farcaster creator';
  const style = requestUrl.searchParams.get('style') || 'neon';
  const textFit = fitShareText(castText);
  const lines = textFit.lines
    .map((line, index) => `<text x="110" y="${325 + index * textFit.lineHeight}">${escapeXml(line)}</text>`)
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
  <rect x="110" y="232" width="410" height="54" rx="27" fill="rgba(255,255,255,.09)" stroke="${accent}" stroke-opacity=".42"/>
  <text x="136" y="268" fill="${accent}" font-family="Arial,sans-serif" font-size="25" font-weight="900">CAST BY ${escapeXml(authorLabel)}</text>
  <g fill="#ffffff" font-family="Arial,sans-serif" font-size="${textFit.fontSize}" font-weight="900">
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
