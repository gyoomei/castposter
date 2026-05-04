export type CastNftInput = {
  castText: string;
  author: string;
  castUrl?: string;
};

export type CastNftMetadata = {
  name: string;
  description: string;
  external_url?: string;
  image?: string;
  attributes: Array<{ trait_type: string; value: string }>;
};

export type CastLookupResult = {
  text: string;
  author: string;
};

type PublicCast = {
  hash?: string;
  castHash?: string;
  merkleRoot?: string;
  text?: string;
  author?: {
    username?: string;
    displayName?: string;
  };
};

function normalizeHash(value = ''): string {
  return value.trim().toLowerCase();
}

function getCastCandidates(payload: unknown): PublicCast[] {
  const typed = payload as {
    result?: { casts?: PublicCast[]; cast?: PublicCast };
    casts?: PublicCast[];
    cast?: PublicCast;
  };
  const candidates = [
    typed?.result?.casts,
    typed?.result?.cast ? [typed.result.cast] : null,
    typed?.casts,
    typed?.cast ? [typed.cast] : null,
  ];
  return candidates.find(Array.isArray) || [];
}

export function getCastNftSeed(castText: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < castText.length; index += 1) {
    hash ^= castText.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeCastUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

export function getCastHashFromUrl(rawUrl: string): string {
  const url = normalizeCastUrl(rawUrl);
  const match = url.match(/\/(0x[a-f0-9]{4,64})(?:[/?#]|$)/i);
  return match?.[1]?.toLowerCase() || '';
}

export function extractCastAuthorFromUrl(rawUrl: string): string {
  const url = normalizeCastUrl(rawUrl);
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const username = parts[0] || '';
    return username.replace(/^@/, '').replace(/\.eth$/i, '') || 'caster';
  } catch {
    return 'caster';
  }
}

export function isValidEvmAddress(value = ''): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toBase64(value: string): string {
  const globalBuffer = (globalThis as unknown as { Buffer?: { from: (value: string, encoding?: string) => { toString: (encoding: string) => string } } }).Buffer;
  if (globalBuffer) return globalBuffer.from(value, 'utf8').toString('base64');

  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export function buildCastMintImageSvg(input: CastNftInput): string {
  const cleanCast = input.castText.trim().replace(/\s+/g, ' ') || 'Paste a cast URL to mint.';
  const cleanAuthor = input.author.trim().replace(/^@/, '') || 'caster';
  const seed = getCastNftSeed(`${cleanAuthor}:${cleanCast}`);
  const shortCast = cleanCast.length > 190 ? `${cleanCast.slice(0, 187)}…` : cleanCast;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#07111f"/><stop offset=".45" stop-color="#172554"/><stop offset="1" stop-color="#450a3a"/></linearGradient>
    <radialGradient id="glow" cx="30%" cy="20%" r="80%"><stop offset="0" stop-color="#55e7ff" stop-opacity=".65"/><stop offset=".45" stop-color="#ff5bd7" stop-opacity=".22"/><stop offset="1" stop-color="#050711" stop-opacity="0"/></radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="42"/></filter>
  </defs>
  <rect width="1200" height="1600" rx="88" fill="url(#bg)"/>
  <rect width="1200" height="1600" rx="88" fill="url(#glow)"/>
  <circle cx="1030" cy="210" r="160" fill="#ff5bd7" opacity=".35" filter="url(#blur)"/>
  <circle cx="180" cy="1310" r="210" fill="#55e7ff" opacity=".30" filter="url(#blur)"/>
  <rect x="76" y="84" width="1048" height="1432" rx="70" fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.28)" stroke-width="3"/>
  <text x="126" y="170" fill="#dffbff" font-family="Inter,Arial,sans-serif" font-size="42" font-weight="900" letter-spacing="8">CASTMINT</text>
  <text x="870" y="170" fill="#ffe08a" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="900">#${escapeXml(seed)}</text>
  <text x="130" y="510" fill="rgba(255,255,255,.18)" font-family="Georgia,serif" font-size="220" font-weight="900">“</text>
  <foreignObject x="128" y="560" width="944" height="500">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#fff;font-family:Inter,Arial,sans-serif;font-size:64px;line-height:1.13;font-weight:950;letter-spacing:-3px;overflow:hidden;">${escapeXml(shortCast)}</div>
  </foreignObject>
  <text x="126" y="1326" fill="#9aa4bd" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="800">CREATOR</text>
  <text x="126" y="1386" fill="#fff" font-family="Inter,Arial,sans-serif" font-size="48" font-weight="950">@${escapeXml(cleanAuthor)}</text>
  <text x="874" y="1326" fill="#9aa4bd" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="800">CHAIN</text>
  <text x="874" y="1386" fill="#fff" font-family="Inter,Arial,sans-serif" font-size="48" font-weight="950">BASE</text>
</svg>`;
}

export function buildCastMintTokenUri(input: CastNftInput): string {
  const metadata = buildCastNftMetadata(input);
  const svg = buildCastMintImageSvg(input);
  const payload = {
    ...metadata,
    image: `data:image/svg+xml;base64,${toBase64(svg)}`,
  };
  return `data:application/json;base64,${toBase64(JSON.stringify(payload))}`;
}

export function findCastInApiResponse(payload: unknown, targetHash: string): CastLookupResult | null {
  const casts = getCastCandidates(payload);
  if (!Array.isArray(casts)) return null;

  const normalizedTarget = normalizeHash(targetHash);
  const shortTarget = normalizedTarget.slice(0, 10);
  const cast = casts.find((item) => {
    const itemHash = normalizeHash(item.hash || item.castHash || item.merkleRoot || '');
    return itemHash === normalizedTarget || (shortTarget.length >= 10 && itemHash.startsWith(shortTarget));
  });
  const text = cast?.text?.trim();
  if (!cast || !text) return null;

  return {
    text,
    author: cast.author?.username?.trim() || cast.author?.displayName?.trim() || 'caster',
  };
}

export function buildCastNftMetadata(input: CastNftInput): CastNftMetadata {
  const cleanCast = input.castText.trim().replace(/\s+/g, ' ');
  const cleanAuthor = input.author.trim().replace(/^@/, '') || 'caster';
  const seed = getCastNftSeed(`${cleanAuthor}:${cleanCast}`);

  return {
    name: `CastMint #${seed}`,
    description: `A collectible NFT generated from this Farcaster cast: “${cleanCast}”`,
    external_url: normalizeCastUrl(input.castUrl || '') || undefined,
    attributes: [
      { trait_type: 'Source', value: 'Farcaster Cast' },
      { trait_type: 'Creator', value: `@${cleanAuthor}` },
      { trait_type: 'Cast Seed', value: seed },
      { trait_type: 'Chain', value: 'Base' },
    ],
  };
}
