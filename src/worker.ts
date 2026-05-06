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
