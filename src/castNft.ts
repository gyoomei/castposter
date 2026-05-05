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

export type CastMintPreviewStyle = 'neon' | 'poster' | 'minimal';

export const CASTMINT_PREVIEW_STYLES: Array<{ id: CastMintPreviewStyle; label: string; description: string }> = [
  { id: 'neon', label: 'Neon', description: 'Animated premium card with Base glow.' },
  { id: 'poster', label: 'Poster', description: 'Bold result-poster layout for sharing.' },
  { id: 'minimal', label: 'Clean', description: 'Minimal collectible card with calm contrast.' },
];

export type CastMintHistoryItem = {
  castUrl: string;
  author: string;
  castText: string;
  txHash: string;
  mintedAt: string;
  style: CastMintPreviewStyle;
};

export function getPreviewStyle(value = ''): CastMintPreviewStyle {
  return CASTMINT_PREVIEW_STYLES.some((item) => item.id === value) ? value as CastMintPreviewStyle : 'neon';
}

export function formatTxHash(txHash = ''): string {
  const clean = txHash.trim();
  if (clean.length <= 18) return clean;
  return `${clean.slice(0, 10)}…${clean.slice(-6)}`;
}

export function createMintHistoryItem(input: CastNftInput & { txHash: string; mintedAt?: string; style?: string }): CastMintHistoryItem {
  return {
    castUrl: normalizeCastUrl(input.castUrl || ''),
    author: input.author.trim().replace(/^@/, '') || 'caster',
    castText: input.castText.trim().replace(/\s+/g, ' '),
    txHash: input.txHash.trim(),
    mintedAt: input.mintedAt || new Date().toISOString(),
    style: getPreviewStyle(input.style),
  };
}

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
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#050711"/><stop offset=".40" stop-color="#0f172a"/><stop offset=".75" stop-color="#1e1b4b"/><stop offset="1" stop-color="#4a044e"/></linearGradient>
    <radialGradient id="glow1" cx="25%" cy="18%" r="75%"><stop offset="0" stop-color="#55e7ff" stop-opacity=".72"/><stop offset=".50" stop-color="#55e7ff" stop-opacity=".18"/><stop offset="1" stop-color="#050711" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="82%" cy="78%" r="70%"><stop offset="0" stop-color="#ff5bd7" stop-opacity=".55"/><stop offset=".50" stop-color="#ff5bd7" stop-opacity=".14"/><stop offset="1" stop-color="#050711" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow3" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#7c3aed" stop-opacity=".22"/><stop offset="1" stop-color="#050711" stop-opacity="0"/></radialGradient>
    <filter id="blur1"><feGaussianBlur stdDeviation="52"/></filter>
    <filter id="blur2"><feGaussianBlur stdDeviation="38"/></filter>
    <linearGradient id="border" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#55e7ff" stop-opacity=".80"/><stop offset=".50" stop-color="#ff5bd7" stop-opacity=".70"/><stop offset="1" stop-color="#ffd166" stop-opacity=".60"/></linearGradient>
    <linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="transparent"/><stop offset=".50" stop-color="rgba(255,255,255,.06)"/><stop offset="1" stop-color="transparent"/></linearGradient>
  </defs>
  <rect width="1200" height="1600" rx="92" fill="url(#bg)"/>
  <rect width="1200" height="1600" rx="92" fill="url(#glow1)"/>
  <rect width="1200" height="1600" rx="92" fill="url(#glow2)"/>
  <rect width="1200" height="1600" rx="92" fill="url(#glow3)"/>
  <circle cx="1050" cy="190" r="180" fill="#ff5bd7" opacity=".30" filter="url(#blur1)"/>
  <circle cx="160" cy="1320" r="230" fill="#55e7ff" opacity=".26" filter="url(#blur2)"/>
  <circle cx="600" cy="800" r="320" fill="#7c3aed" opacity=".14" filter="url(#blur1)"/>
  <rect x="70" y="78" width="1060" height="1444" rx="78" fill="rgba(255,255,255,.055)" stroke="url(#border)" stroke-width="3.5"/>
  <rect x="70" y="78" width="1060" height="1444" rx="78" fill="url(#shimmer)"/>
  <text x="126" y="172" fill="#dffbff" font-family="Inter,Arial,sans-serif" font-size="44" font-weight="900" letter-spacing="9">CASTMINT</text>
  <text x="858" y="172" fill="#ffd166" font-family="Inter,Arial,sans-serif" font-size="36" font-weight="900">#${escapeXml(seed)}</text>
  <text x="130" y="504" fill="rgba(255,255,255,.16)" font-family="Georgia,serif" font-size="230" font-weight="900">“</text>
  <foreignObject x="128" y="554" width="944" height="510">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#fff;font-family:Inter,Arial,sans-serif;font-size:64px;line-height:1.13;font-weight:950;letter-spacing:-3px;overflow:hidden;text-shadow:0 2px 24px rgba(0,0,0,.35);">${escapeXml(shortCast)}</div>
  </foreignObject>
  <text x="126" y="1322" fill="#9aa4bd" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="800" letter-spacing="2">CREATOR</text>
  <text x="126" y="1388" fill="#fff" font-family="Inter,Arial,sans-serif" font-size="50" font-weight="950">@${escapeXml(cleanAuthor)}</text>
  <text x="874" y="1322" fill="#9aa4bd" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="800" letter-spacing="2">CHAIN</text>
  <text x="874" y="1388" fill="#fff" font-family="Inter,Arial,sans-serif" font-size="50" font-weight="950">BASE</text>
  <circle cx="114" cy="1486" r="5" fill="#55e7ff" opacity=".85"/>
  <circle cx="134" cy="1486" r="5" fill="#ff5bd7" opacity=".85"/>
  <circle cx="154" cy="1486" r="5" fill="#ffd166" opacity=".85"/>
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
