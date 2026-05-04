export type CastNftInput = {
  castText: string;
  author: string;
  castUrl?: string;
};

export type CastNftMetadata = {
  name: string;
  description: string;
  external_url?: string;
  attributes: Array<{ trait_type: string; value: string }>;
};

export function getCastNftSeed(castText: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < castText.length; index += 1) {
    hash ^= castText.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildCastNftMetadata(input: CastNftInput): CastNftMetadata {
  const cleanCast = input.castText.trim().replace(/\s+/g, ' ');
  const cleanAuthor = input.author.trim().replace(/^@/, '') || 'caster';
  const seed = getCastNftSeed(`${cleanAuthor}:${cleanCast}`);

  return {
    name: `CastMint #${seed}`,
    description: `A collectible NFT concept generated from this Farcaster cast: “${cleanCast}”`,
    external_url: input.castUrl?.trim() || undefined,
    attributes: [
      { trait_type: 'Source', value: 'Farcaster Cast' },
      { trait_type: 'Creator', value: `@${cleanAuthor}` },
      { trait_type: 'Cast Seed', value: seed },
    ],
  };
}
