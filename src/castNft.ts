export type CastNftInput = {
  castText: string;
  author: string;
  castUrl?: string;
  style?: CastMintPreviewStyle;
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


type SvgTextFit = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
};

type SvgTextFitOptions = {
  boxWidth: number;
  boxHeight: number;
  maxFontSize: number;
  minFontSize: number;
  lineHeightRatio?: number;
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
  return lines.length ? lines : ['Paste a cast URL to mint.'];
}

function fitSvgText(value: string, options: SvgTextFitOptions): SvgTextFit {
  const ratio = options.lineHeightRatio || 1.18;
  for (let fontSize = options.maxFontSize; fontSize >= options.minFontSize; fontSize -= 2) {
    const lineHeight = Math.round(fontSize * ratio);
    const maxLines = Math.max(1, Math.floor(options.boxHeight / lineHeight));
    const maxUnits = options.boxWidth / fontSize;
    const lines = wrapTextByUnits(value, maxUnits);
    if (lines.length <= maxLines) return { lines, fontSize, lineHeight };
  }

  const fontSize = options.minFontSize;
  const lineHeight = Math.round(fontSize * ratio);
  const maxLines = Math.max(1, Math.floor(options.boxHeight / lineHeight));
  const maxUnits = options.boxWidth / fontSize;
  const lines = wrapTextByUnits(value, maxUnits).slice(0, maxLines);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1] || '';
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1)).replace(/…$/, '')}…`;
  }
  return { lines, fontSize, lineHeight };
}

function buildTextLines(lines: string[], x: number, startY: number, lineHeight: number): string {
  return lines
    .map((line, index) => `<text x="${x}" y="${startY + (index * lineHeight)}">${escapeXml(line)}</text>`)
    .join('\n  ');
}

function buildSimpleImageSvg(cleanAuthor: string, seed: string, cleanCast: string, style: CastMintPreviewStyle): string {
  const castFit = fitSvgText(cleanCast, { boxWidth: 900, boxHeight: 650, maxFontSize: 66, minFontSize: 32 });
  const castTextLines = buildTextLines(castFit.lines, 126, 445, castFit.lineHeight);
  const safeAuthor = escapeXml(cleanAuthor);
  const safeSeed = escapeXml(seed);
  const accent = style === 'poster' ? '#f97316' : style === 'minimal' ? '#0ea5e9' : '#7c3aed';
  const accentTwo = style === 'poster' ? '#facc15' : style === 'minimal' ? '#94a3b8' : '#55e7ff';
  const background = style === 'poster' ? '#fff7ed' : style === 'minimal' ? '#ffffff' : '#f8fafc';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" rx="76" fill="${background}"/>
  <rect x="72" y="84" width="1056" height="1432" rx="58" fill="#ffffff" stroke="#dbe4ef" stroke-width="4"/>
  <rect x="72" y="84" width="1056" height="22" rx="11" fill="${accent}"/>
  <rect x="72" y="84" width="528" height="22" rx="11" fill="${accentTwo}" opacity=".9"/>
  <text x="126" y="202" fill="#0f172a" font-family="Arial,sans-serif" font-size="52" font-weight="950" letter-spacing="7">CASTMINT</text>
  <text x="126" y="264" fill="#64748b" font-family="Arial,sans-serif" font-size="27" font-weight="850" letter-spacing="3">FARCASTER CAST NFT</text>
  <rect x="126" y="318" width="948" height="2" fill="#e2e8f0"/>
  <g fill="#0f172a" font-family="Arial,sans-serif" font-size="${castFit.fontSize}" font-weight="950" dominant-baseline="text-before-edge">
  ${castTextLines}
  </g>
  <rect x="126" y="1224" width="948" height="150" rx="32" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="2"/>
  <circle cx="188" cy="1299" r="32" fill="${accent}"/>
  <text x="244" y="1285" fill="#64748b" font-family="Arial,sans-serif" font-size="24" font-weight="850" letter-spacing="2">CAST BY</text>
  <text x="244" y="1344" fill="#0f172a" font-family="Arial,sans-serif" font-size="50" font-weight="950">@${safeAuthor}</text>
  <text x="126" y="1460" fill="#94a3b8" font-family="Arial,sans-serif" font-size="26" font-weight="850">BASE • #${safeSeed}</text>
</svg>`;
}

export function buildCastMintImageSvg(input: CastNftInput): string {
  const cleanCast = input.castText.trim().replace(/\s+/g, ' ') || 'Paste a cast URL to mint.';
  const cleanAuthor = input.author.trim().replace(/^@/, '') || 'caster';
  const style = getPreviewStyle(input.style);
  const seed = getCastNftSeed(`${style}:${cleanAuthor}:${cleanCast}`);

  return buildSimpleImageSvg(cleanAuthor, seed, cleanCast, style);
}

export function buildCastMintImageDataUri(input: CastNftInput): string {
  return `data:image/svg+xml;base64,${toBase64(buildCastMintImageSvg(input))}`;
}

export function buildCastMintTokenUri(input: CastNftInput): string {
  const metadata = buildCastNftMetadata(input);
  const payload = {
    ...metadata,
    image: buildCastMintImageDataUri(input),
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
  const style = getPreviewStyle(input.style);
  const seed = getCastNftSeed(`${style}:${cleanAuthor}:${cleanCast}`);

  return {
    name: `CastMint #${seed}`,
    description: `A collectible NFT generated from this Farcaster cast: “${cleanCast}”`,
    external_url: normalizeCastUrl(input.castUrl || '') || undefined,
    attributes: [
      { trait_type: 'Source', value: 'Farcaster Cast' },
      { trait_type: 'Creator', value: `@${cleanAuthor}` },
      { trait_type: 'Cast Seed', value: seed },
      { trait_type: 'Style', value: style.charAt(0).toUpperCase() + style.slice(1) },
      { trait_type: 'Chain', value: 'Base' },
    ],
  };
}
