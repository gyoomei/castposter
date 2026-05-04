const PUBLIC_FARCASTER_API = 'https://api.farcaster.xyz/v2';

function normalizeCastUrl(rawUrl = '') {
  const trimmed = String(rawUrl).trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

function getCastHashFromUrl(rawUrl = '') {
  const url = normalizeCastUrl(rawUrl);
  const match = url.match(/\/(0x[a-f0-9]{4,64})(?:[/?#]|$)/i);
  return match?.[1]?.toLowerCase() || '';
}

function extractCastAuthorFromUrl(rawUrl = '') {
  const url = normalizeCastUrl(rawUrl);
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const username = parts[0] || '';
    return username.replace(/^@/, '').replace(/\.eth$/i, '') || '';
  } catch {
    return '';
  }
}

function castCandidates(payload) {
  const candidates = [
    payload?.result?.casts,
    payload?.result?.cast ? [payload.result.cast] : null,
    payload?.casts,
    payload?.cast ? [payload.cast] : null,
  ];
  return candidates.find(Array.isArray) || [];
}

function normalizeHash(value = '') {
  return String(value).trim().toLowerCase();
}

function findCastInApiResponse(payload, targetHash) {
  const casts = castCandidates(payload);
  if (!Array.isArray(casts)) return null;
  const normalizedTarget = normalizeHash(targetHash);
  const shortTarget = normalizedTarget.slice(0, 10);
  const cast = casts.find((item) => {
    const itemHash = normalizeHash(item?.hash || item?.castHash || item?.merkleRoot);
    return itemHash === normalizedTarget || (shortTarget.length >= 10 && itemHash.startsWith(shortTarget));
  });
  const text = cast?.text?.trim();
  if (!cast || !text) return null;
  return {
    text,
    author: cast.author?.username?.trim() || cast.author?.displayName?.trim() || 'caster',
  };
}

async function tryFetchCastByHub(fid, hash) {
  const hubUrl = `https://hub-api.neynar.com/v1/castById?fid=${encodeURIComponent(String(fid))}&hash=${encodeURIComponent(hash)}`;
  try {
    return findCastInApiResponse(await fetchJson(hubUrl), hash);
  } catch {
    return null;
  }
}

async function findCastByHash(fid, hash) {
  const hubCast = await tryFetchCastByHub(fid, hash);
  if (hubCast) return hubCast;

  let cursor = '';
  for (let page = 0; page < 20; page += 1) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const payload = await fetchJson(`${PUBLIC_FARCASTER_API}/casts?fid=${encodeURIComponent(String(fid))}&limit=50${cursorParam}`);
    const cast = findCastInApiResponse(payload, hash);
    if (cast) return cast;
    cursor = payload?.result?.next?.cursor || payload?.result?.cursor || payload?.next?.cursor || payload?.cursor || '';
    if (!cursor) break;
  }
  return null;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CastMint/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rawUrl = req.query?.url || '';
    const normalizedUrl = normalizeCastUrl(Array.isArray(rawUrl) ? rawUrl[0] : rawUrl);
    const hash = getCastHashFromUrl(normalizedUrl);
    const username = extractCastAuthorFromUrl(normalizedUrl);

    if (!normalizedUrl || !hash || !username) {
      res.status(400).json({ error: 'Invalid Farcaster cast URL' });
      return;
    }

    const userPayload = await fetchJson(`${PUBLIC_FARCASTER_API}/user-by-username?username=${encodeURIComponent(username)}`);
    const fid = userPayload?.result?.user?.fid;
    if (!fid) {
      res.status(404).json({ error: 'Farcaster user not found' });
      return;
    }

    const cast = await findCastByHash(fid, hash);
    if (!cast) {
      res.status(404).json({ error: 'Cast text not found' });
      return;
    }

    res.status(200).json({ ...cast, url: normalizedUrl, hash });
  } catch (error) {
    res.status(502).json({ error: 'Unable to fetch cast text right now' });
  }
}
