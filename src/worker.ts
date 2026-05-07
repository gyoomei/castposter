import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';

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
const SHARE_CARD_VERSION = '28';

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

function getShareStyleTheme(style: string) {
  if (style === 'minimal') {
    return {
      bg: '#f8fafc',
      bg2: '#e0f2fe',
      card: '#ffffff',
      panel: '#f1f5f9',
      text: '#0f172a',
      muted: '#64748b',
      accent: '#0ea5e9',
      accent2: '#14b8a6',
      quote: '#111827',
      label: 'MINIMAL',
    };
  }

  if (style === 'poster') {
    return {
      bg: '#431407',
      bg2: '#f97316',
      card: '#fff7ed',
      panel: '#fed7aa',
      text: '#431407',
      muted: '#9a3412',
      accent: '#f97316',
      accent2: '#fde047',
      quote: '#431407',
      label: 'POSTER',
    };
  }

  return {
    bg: '#02040a',
    bg2: '#111a35',
    card: '#07111f',
    panel: '#0b1730',
    text: '#f8fafc',
    muted: '#94a3b8',
    accent: '#55e7ff',
    accent2: '#ff5bd7',
    quote: '#ffffff',
    label: 'NEON',
  };
}

function buildShareCardSvg(data: ShareCardData): string {
  const castText = data.text;
  const authorLabel = data.author ? `@${data.author}` : 'Farcaster creator';
  const theme = getShareStyleTheme(data.style);
  const textFit = fitShareText(castText);
  const quoteX = 218;
  const quoteY = 322;
  const lines = textFit.lines
    .map((line, index) => `<text x="${quoteX}" y="${quoteY + index * textFit.lineHeight}">${escapeXml(line)}</text>`)
    .join('\n        ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_IMAGE_WIDTH}" height="${SHARE_IMAGE_HEIGHT}" viewBox="0 0 ${SHARE_IMAGE_WIDTH} ${SHARE_IMAGE_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.bg}"/><stop offset=".58" stop-color="${theme.bg2}"/><stop offset="1" stop-color="${theme.accent2}"/></linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${theme.accent}"/><stop offset="1" stop-color="${theme.accent2}"/></linearGradient>
  </defs>
  <rect width="1200" height="800" rx="54" fill="url(#bg)"/>
  <circle cx="1030" cy="120" r="245" fill="${theme.accent2}" opacity=".25"/>
  <circle cx="135" cy="715" r="255" fill="${theme.accent}" opacity=".22"/>
  <path d="M82 642 C286 568 447 704 650 622 C852 540 958 618 1120 536" fill="none" stroke="${theme.accent}" stroke-width="3" opacity=".22"/>

  <g transform="translate(126 74) rotate(-3 474 326)">
    <rect x="0" y="0" width="948" height="652" rx="44" fill="${theme.card}" stroke="url(#edge)" stroke-width="7"/>
    <rect x="34" y="34" width="880" height="584" rx="34" fill="${theme.panel}" opacity=".62"/>
    <rect x="64" y="58" width="210" height="54" rx="27" fill="${theme.accent}" opacity=".16" stroke="${theme.accent}"/>
    <text x="86" y="94" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="25" font-weight="900" letter-spacing="5">${theme.label}</text>
    <text x="304" y="94" fill="${theme.muted}" font-family="Arial,sans-serif" font-size="22" font-weight="800" letter-spacing="3">CASTMINT • BASE NFT</text>

    <text x="64" y="218" fill="${theme.accent}" font-family="Georgia,serif" font-size="112" font-weight="900" opacity=".9">“</text>
    <g fill="${theme.quote}" font-family="Arial,sans-serif" font-size="${textFit.fontSize}" font-weight="900" letter-spacing="-.8">
        ${lines}
    </g>

    <rect x="64" y="500" width="470" height="76" rx="38" fill="${theme.accent}" opacity=".14" stroke="${theme.accent}" stroke-width="2"/>
    <text x="98" y="548" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="27" font-weight="900">CAST BY ${escapeXml(authorLabel)}</text>
    <rect x="624" y="506" width="224" height="62" rx="31" fill="url(#edge)"/>
    <text x="656" y="546" fill="#ffffff" font-family="Arial,sans-serif" font-size="25" font-weight="900">Mint This</text>
  </g>

  <text x="78" y="736" fill="#ffffff" font-family="Arial,sans-serif" font-size="31" font-weight="900" opacity=".96">Generated NFT preview from a Farcaster cast</text>
  <text x="78" y="774" fill="#dbeafe" font-family="Arial,sans-serif" font-size="22" font-weight="700" opacity=".76">Open CastMint to mint your own collectible on Base</text>
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

let resvgInitPromise: Promise<void> | null = null;

async function ensureResvgReady(): Promise<void> {
  if (!resvgInitPromise) {
    resvgInitPromise = initWasm(resvgWasmModule);
  }
  return resvgInitPromise;
}

async function pngResponse(svg: string): Promise<Response> {
  await ensureResvgReady();
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: SHARE_IMAGE_WIDTH },
  });
  try {
    const png = renderer.render().asPng();
    return imageResponse(png, 'image/png');
  } finally {
    renderer.free();
  }
}

function escapeHtml(value = ''): string {
  return escapeXml(value).replace(/'/g, '&#39;');
}

function escapeMetaJson(value: string): string {
  return value.replace(/'/g, '&#39;');
}

function buildShareImageUrl(requestUrl: URL): string {
  const params = new URLSearchParams(requestUrl.searchParams);
  params.set('v', requestUrl.searchParams.get('v') || SHARE_CARD_VERSION);
  return new URL(`/api/share-card.png?${params.toString()}`, requestUrl.origin).toString();
}

function sharePageHtml(requestUrl: URL): string {
  const params = new URLSearchParams(requestUrl.searchParams);
  params.set('v', requestUrl.searchParams.get('v') || SHARE_CARD_VERSION);
  const imageUrl = buildShareImageUrl(requestUrl);
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

    if (url.pathname === '/api/share-card' || url.pathname === '/api/share-card.png' || url.pathname === '/share') {
      const cache = (caches as CacheStorageWithDefault).default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const cached = await cache.match(cacheKey);
      if (cached) return withCors(cached);

      const response = url.pathname === '/share'
        ? htmlResponse(sharePageHtml(url))
        : await pngResponse(buildShareCardSvg(await getShareCardData(url)));
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
