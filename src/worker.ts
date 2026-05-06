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
const WARPCAST_PAGE_LIMIT = 50;
const SHARE_CARD_CACHE_SECONDS = 300;
const SHARE_CARD_VERSION = '24';

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

type ShareCardData = {
  text: string;
  author: string;
  style: string;
};

function normalizeHash(value = ''): string {
  return value.trim().toLowerCase();
}

function getCastCandidates(payload: unknown): Array<{ hash?: string; castHash?: string; merkleRoot?: string; text?: string }> {
  const typed = payload as {
    result?: { casts?: Array<{ hash?: string; castHash?: string; merkleRoot?: string; text?: string }>; cast?: { hash?: string; castHash?: string; merkleRoot?: string; text?: string } };
    casts?: Array<{ hash?: string; castHash?: string; merkleRoot?: string; text?: string }>;
    cast?: { hash?: string; castHash?: string; merkleRoot?: string; text?: string };
  };
  const candidates = [
    typed?.result?.casts,
    typed?.result?.cast ? [typed.result.cast] : null,
    typed?.casts,
    typed?.cast ? [typed.cast] : null,
  ];
  return candidates.find(Array.isArray) || [];
}

function findCastText(payload: unknown, targetHash: string): string {
  const normalizedTarget = normalizeHash(targetHash);
  const candidates = getCastCandidates(payload);
  const cast = candidates.find((item) => [item.hash, item.castHash, item.merkleRoot].some((value) => normalizeHash(value || '') === normalizedTarget));
  return cast?.text || '';
}

async function fetchCastTextByHash(author: string, hash: string): Promise<string> {
  if (!author || !hash) return '';

  const userUrl = new URL(`${WARPCAST_API}/user-by-username`);
  userUrl.searchParams.set('username', author);
  const userResponse = await fetch(userUrl.toString(), { headers: { Accept: 'application/json' } });
  if (!userResponse.ok) return '';
  const userData = await userResponse.json();
  const fid = Number(userData?.result?.user?.fid);
  if (!Number.isInteger(fid) || fid <= 0) return '';

  let cursor = '';
  for (let page = 0; page < 3; page += 1) {
    const castsUrl = new URL(`${WARPCAST_API}/casts`);
    castsUrl.searchParams.set('fid', String(fid));
    castsUrl.searchParams.set('limit', String(WARPCAST_PAGE_LIMIT));
    if (cursor) castsUrl.searchParams.set('cursor', cursor);

    const castsResponse = await fetch(castsUrl.toString(), { headers: { Accept: 'application/json' } });
    if (!castsResponse.ok) return '';
    const castsData = await castsResponse.json();
    const text = findCastText(castsData, hash);
    if (text) return text;

    cursor = castsData?.next?.cursor || castsData?.result?.next?.cursor || '';
    if (!cursor) break;
  }

  return '';
}

async function getShareCardData(requestUrl: URL): Promise<ShareCardData> {
  const rawAuthor = (requestUrl.searchParams.get('author') || '').replace(/^@+/, '').trim();
  const hash = requestUrl.searchParams.get('hash') || '';
  const fallbackText = requestUrl.searchParams.get('text') || requestUrl.searchParams.get('cast') || '';
  const fetchedText = rawAuthor && hash ? await fetchCastTextByHash(rawAuthor, hash).catch(() => '') : '';

  return {
    text: fetchedText || fallbackText || 'I minted a Farcaster cast as an NFT',
    author: rawAuthor,
    style: requestUrl.searchParams.get('style') || 'neon',
  };
}

function buildShareCardSvg(data: ShareCardData): string {
  const castText = data.text;
  const authorLabel = data.author ? `@${data.author}` : 'Farcaster creator';
  const style = data.style;
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

function imageResponse(body: BodyInit, contentType: string): Response {
  return withCors(new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${SHARE_CARD_CACHE_SECONDS}`,
    },
  }));
}

function svgResponse(svg: string): Response {
  return imageResponse(svg, 'image/svg+xml; charset=utf-8');
}

function escapeHtml(value = ''): string {
  return escapeXml(value).replace(/'/g, '&#39;');
}

function escapeMetaJson(value: string): string {
  return value.replace(/'/g, '&#39;');
}

function buildFallbackPngUrl(requestUrl: URL): string {
  return new URL(`/og.png?v=${requestUrl.searchParams.get('v') || SHARE_CARD_VERSION}`, requestUrl.origin).toString();
}

function sharePageHtml(requestUrl: URL): string {
  const params = new URLSearchParams(requestUrl.searchParams);
  params.set('v', requestUrl.searchParams.get('v') || SHARE_CARD_VERSION);
  const imageUrl = buildFallbackPngUrl(requestUrl);
  const svgImageUrl = new URL(`/api/share-card?${params.toString()}`, requestUrl.origin).toString();
  const appUrl = new URL('/', requestUrl.origin);
  appUrl.searchParams.set('v', requestUrl.searchParams.get('v') || SHARE_CARD_VERSION);
  const appUrlString = appUrl.toString();
  const miniappPayload = JSON.stringify({
    version: '1',
    imageUrl,
    button: {
      title: 'Mint This Cast',
      action: {
        type: 'launch_frame',
        name: 'CastMint',
        url: appUrlString,
        splashImageUrl: `${requestUrl.origin}/icon.png?v=${requestUrl.searchParams.get('v') || SHARE_CARD_VERSION}`,
        splashBackgroundColor: '#02040a',
      },
    },
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CastMint — Cast to NFT</title>
  <meta http-equiv="refresh" content="0; url=${escapeHtml(appUrlString)}">
  <meta name="description" content="Turn any Farcaster cast into a collectible NFT on Base.">
  <meta property="og:title" content="CastMint — Cast to NFT">
  <meta property="og:description" content="Turn any Farcaster cast into a collectible NFT on Base.">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="800">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
  <meta name="fc:miniapp" content='${escapeMetaJson(miniappPayload)}'>
  <meta name="fc:frame" content='${escapeMetaJson(miniappPayload)}'>
  <link rel="canonical" href="${escapeHtml(appUrlString)}">
</head>
<body style="margin:0;background:#02040a;color:#f8fafc;font-family:Inter,system-ui,sans-serif;display:grid;min-height:100vh;place-items:center;text-align:center;padding:24px;">
  <main>
    <img src="${escapeHtml(imageUrl)}" alt="CastMint share card" style="width:min(100%,600px);border-radius:24px;box-shadow:0 24px 80px rgba(6,182,212,.24);">
    <h1>CastMint</h1>
    <p>Turn any Farcaster cast into a collectible NFT on Base.</p>
    <p><a href="${escapeHtml(appUrlString)}" style="color:#22d3ee;font-weight:800;">Launch CastMint</a></p>
    <p style="font-size:12px;color:#64748b;">SVG card: <a href="${escapeHtml(svgImageUrl)}" style="color:#22d3ee;">open dynamic card</a></p>
  </main>
</body>
</html>`;
}

function htmlResponse(html: string): Response {
  return withCors(new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=${SHARE_CARD_CACHE_SECONDS}`,
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

    if (url.pathname === '/api/share-card' || url.pathname === '/share') {
      const cache = (caches as CacheStorageWithDefault).default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const cached = await cache.match(cacheKey);
      if (cached) return withCors(cached);

      const response = url.pathname === '/share'
        ? htmlResponse(sharePageHtml(url))
        : svgResponse(buildShareCardSvg(await getShareCardData(url)));
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
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
