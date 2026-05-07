export type CastNftInput = {
  castText: string;
  author: string;
  castUrl?: string;
  style?: CastMintPreviewStyle;
  editionNumber?: number;
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
  editionNumber?: number;
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
    editionNumber: normalizeEditionNumber(input.editionNumber),
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

export function normalizeEditionNumber(value?: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const normalized = Math.trunc(Number(value));
  return normalized >= 1 && normalized <= 10000 ? normalized : undefined;
}

export function formatEditionLabel(value?: number): string {
  const edition = normalizeEditionNumber(value);
  return edition ? `NFT #${edition}` : 'NFT #—';
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

function buildMinimalImageSvg(cleanAuthor: string, seed: string, cleanCast: string, editionLabel: string): string {
  const castFit = fitSvgText(cleanCast, { boxWidth: 900, boxHeight: 540, maxFontSize: 66, minFontSize: 34 });
  const castTextLines = buildTextLines(castFit.lines, 126, 565, castFit.lineHeight);
  const safeAuthor = escapeXml(cleanAuthor);
  const safeSeed = escapeXml(seed);
  const safeEditionLabel = escapeXml(editionLabel);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" rx="72" fill="#f8fafc"/>
  <rect x="78" y="86" width="1044" height="1428" rx="56" fill="#ffffff" stroke="#dbe4ef" stroke-width="4"/>
  <circle cx="1010" cy="210" r="88" fill="#e0f2fe"/>
  <circle cx="922" cy="294" r="44" fill="#fef3c7"/>
  <text x="126" y="180" fill="#0f172a" font-family="Arial,sans-serif" font-size="44" font-weight="900" letter-spacing="7">CASTMINT</text>
  <text x="126" y="236" fill="#64748b" font-family="Arial,sans-serif" font-size="24" font-weight="800">MINIMAL EDITION • BASE • ${safeEditionLabel}</text>
  <line x1="126" y1="315" x2="1074" y2="315" stroke="#e2e8f0" stroke-width="3"/>
  <text x="126" y="445" fill="#cbd5e1" font-family="Georgia,serif" font-size="156" font-weight="900">“</text>
  <g fill="#0f172a" font-family="Arial,sans-serif" font-size="${castFit.fontSize}" font-weight="900" dominant-baseline="text-before-edge">
  ${castTextLines}
  </g>
  <rect x="126" y="1210" width="948" height="156" rx="34" fill="#f1f5f9"/>
  <text x="172" y="1278" fill="#64748b" font-family="Arial,sans-serif" font-size="24" font-weight="800" letter-spacing="2">CREATOR</text>
  <text x="172" y="1338" fill="#0f172a" font-family="Arial,sans-serif" font-size="52" font-weight="950">@${safeAuthor}</text>
  <text x="126" y="1454" fill="#94a3b8" font-family="Arial,sans-serif" font-size="26" font-weight="800">#${safeSeed}</text>
</svg>`;
}

function buildPosterImageSvg(cleanAuthor: string, seed: string, cleanCast: string, editionLabel: string): string {
  const posterCast = cleanCast.toUpperCase();
  const castFit = fitSvgText(posterCast, { boxWidth: 900, boxHeight: 600, maxFontSize: 72, minFontSize: 32 });
  const castTextLines = buildTextLines(castFit.lines, 126, 505, castFit.lineHeight);
  const safeAuthor = escapeXml(cleanAuthor);
  const safeSeed = escapeXml(seed);
  const safeEditionLabel = escapeXml(editionLabel);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <defs>
    <linearGradient id="posterBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d00"/><stop offset=".48" stop-color="#7c2d12"/><stop offset="1" stop-color="#050505"/></linearGradient>
    <linearGradient id="posterAccent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fde047"/><stop offset="1" stop-color="#fb7185"/></linearGradient>
  </defs>
  <rect width="1200" height="1600" fill="url(#posterBg)"/>
  <rect x="72" y="80" width="1056" height="1440" fill="none" stroke="#fde047" stroke-width="10"/>
  <rect x="112" y="120" width="976" height="1360" fill="rgba(0,0,0,.42)"/>
  <text x="126" y="210" fill="#fde047" font-family="Arial Black,Arial,sans-serif" font-size="86" font-weight="900" letter-spacing="-2">CAST</text>
  <text x="126" y="304" fill="#fff" font-family="Arial Black,Arial,sans-serif" font-size="86" font-weight="900" letter-spacing="-2">POSTER</text>
  <rect x="126" y="348" width="364" height="18" fill="url(#posterAccent)"/>
  <g fill="#ffffff" font-family="Arial Black,Arial,sans-serif" font-size="${castFit.fontSize}" font-weight="900" dominant-baseline="text-before-edge">
  ${castTextLines}
  </g>
  <rect x="126" y="1230" width="948" height="170" fill="#fde047"/>
  <text x="166" y="1302" fill="#111" font-family="Arial,sans-serif" font-size="28" font-weight="950" letter-spacing="3">ORIGINAL CASTER</text>
  <text x="166" y="1372" fill="#111" font-family="Arial,sans-serif" font-size="54" font-weight="950">@${safeAuthor}</text>
  <text x="126" y="1468" fill="#fff" font-family="Arial,sans-serif" font-size="30" font-weight="900">BASE • ${safeEditionLabel} • #${safeSeed}</text>
</svg>`;
}

function buildNeonImageSvg(cleanAuthor: string, _seed: string, cleanCast: string, editionLabel: string): string {
  const castFit = fitSvgText(cleanCast, { boxWidth: 900, boxHeight: 520, maxFontSize: 60, minFontSize: 30 });
  const castTextLines = buildTextLines(castFit.lines, 128, 650, castFit.lineHeight);
  const safeAuthor = escapeXml(cleanAuthor);
  const safeEditionLabel = escapeXml(editionLabel);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#02040a"/><stop offset=".35" stop-color="#0b1224"/><stop offset=".70" stop-color="#1a1035"/><stop offset="1" stop-color="#3a0a3d"/></linearGradient>
    <radialGradient id="glow1" cx="22%" cy="14%" r="78%"><stop offset="0" stop-color="#55e7ff" stop-opacity=".78"/><stop offset=".45" stop-color="#55e7ff" stop-opacity=".16"/><stop offset="1" stop-color="#02040a" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="84%" cy="82%" r="72%"><stop offset="0" stop-color="#ff5bd7" stop-opacity=".60"/><stop offset=".45" stop-color="#ff5bd7" stop-opacity=".12"/><stop offset="1" stop-color="#02040a" stop-opacity="0"/></radialGradient>
    <linearGradient id="border" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#55e7ff"/><stop offset=".50" stop-color="#ff5bd7"/><stop offset="1" stop-color="#ffd166"/></linearGradient>
    <linearGradient id="titleGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#dffbff"/><stop offset=".60" stop-color="#ffd166"/></linearGradient>
  </defs>
  <rect width="1200" height="1600" rx="92" fill="url(#bg)"/>
  <rect width="1200" height="1600" rx="92" fill="url(#glow1)"/>
  <rect width="1200" height="1600" rx="92" fill="url(#glow2)"/>
  <circle cx="1080" cy="160" r="200" fill="#ff5bd7" opacity=".26"/>
  <circle cx="140" cy="1360" r="260" fill="#55e7ff" opacity=".22"/>
  <rect x="68" y="76" width="1064" height="1448" rx="80" fill="rgba(255,255,255,.045)" stroke="url(#border)" stroke-width="4"/>
  <text x="126" y="172" fill="url(#titleGrad)" font-family="Arial,sans-serif" font-size="46" font-weight="900" letter-spacing="10">CASTMINT</text>
  <rect x="126" y="196" width="180" height="3" rx="1.5" fill="#55e7ff" opacity=".85"/>
  <text x="798" y="172" fill="#ffd166" font-family="Arial,sans-serif" font-size="38" font-weight="900">${safeEditionLabel}</text>
  <text x="126" y="246" fill="#55e7ff" font-family="Arial,sans-serif" font-size="22" font-weight="800" letter-spacing="4">MINTED ON BASE</text>
  <text x="130" y="510" fill="rgba(255,255,255,.18)" font-family="Georgia,serif" font-size="240" font-weight="900">“</text>
  <g fill="#ffffff" font-family="Arial,sans-serif" font-size="${castFit.fontSize}" font-weight="900" dominant-baseline="text-before-edge">
  ${castTextLines}
  </g>
  <text x="126" y="1330" fill="#9aa4bd" font-family="Arial,sans-serif" font-size="26" font-weight="800" letter-spacing="2">CREATOR</text>
  <text x="126" y="1396" fill="#fff" font-family="Arial,sans-serif" font-size="52" font-weight="950">@${safeAuthor}</text>
  <text x="876" y="1330" fill="#9aa4bd" font-family="Arial,sans-serif" font-size="26" font-weight="800" letter-spacing="2">CHAIN</text>
  <text x="876" y="1396" fill="#fff" font-family="Arial,sans-serif" font-size="52" font-weight="950">BASE</text>
  <rect x="126" y="1460" width="80" height="3" rx="1.5" fill="#55e7ff" opacity=".85"/>
  <rect x="218" y="1460" width="50" height="3" rx="1.5" fill="#ff5bd7" opacity=".85"/>
  <rect x="280" y="1460" width="30" height="3" rx="1.5" fill="#ffd166" opacity=".85"/>
</svg>`;
}

export function buildCastMintImageSvg(input: CastNftInput): string {
  const cleanCast = input.castText.trim().replace(/\s+/g, ' ') || 'Paste a cast URL to mint.';
  const cleanAuthor = input.author.trim().replace(/^@/, '') || 'caster';
  const style = getPreviewStyle(input.style);
  const seed = getCastNftSeed(`${style}:${cleanAuthor}:${cleanCast}`);

  const editionLabel = formatEditionLabel(input.editionNumber);

  if (style === 'minimal') return buildMinimalImageSvg(cleanAuthor, seed, cleanCast, editionLabel);
  if (style === 'poster') return buildPosterImageSvg(cleanAuthor, seed, cleanCast, editionLabel);
  return buildNeonImageSvg(cleanAuthor, seed, cleanCast, editionLabel);
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
  const editionNumber = normalizeEditionNumber(input.editionNumber);

  return {
    name: editionNumber ? `CastMint ${formatEditionLabel(editionNumber)}` : `CastMint #${seed}`,
    description: `A collectible NFT generated from this Farcaster cast: “${cleanCast}”`,
    external_url: normalizeCastUrl(input.castUrl || '') || undefined,
    attributes: [
      { trait_type: 'Source', value: 'Farcaster Cast' },
      { trait_type: 'Creator', value: `@${cleanAuthor}` },
      { trait_type: 'Cast Seed', value: seed },
      ...(editionNumber ? [{ trait_type: 'Edition', value: formatEditionLabel(editionNumber) }] : []),
      { trait_type: 'Style', value: style.charAt(0).toUpperCase() + style.slice(1) },
      { trait_type: 'Chain', value: 'Base' },
    ],
  };
}
