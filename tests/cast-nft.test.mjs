import assert from 'node:assert/strict';
import {
  buildCastNftMetadata,
  extractCastAuthorFromUrl,
  findCastInApiResponse,
  getCastNftSeed,
  normalizeCastUrl,
} from '../dist-test/castNft.js';

const sample = 'Building on Base from a Farcaster cast 🚀';

assert.equal(getCastNftSeed(sample).length, 8, 'seed should be compact and deterministic');
assert.equal(getCastNftSeed(sample), getCastNftSeed(sample), 'seed should be stable');

const metadata = buildCastNftMetadata({
  castText: sample,
  author: 'gyoo',
  castUrl: 'https://warpcast.com/gyoo/0x123',
});

assert.equal(metadata.name.startsWith('CastMint #'), true, 'metadata should use CastMint series name');
assert.equal(metadata.description.includes(sample), true, 'description should include cast text');
assert.equal(metadata.external_url, 'https://warpcast.com/gyoo/0x123');
assert.deepEqual(
  metadata.attributes.map((item) => item.trait_type),
  ['Source', 'Creator', 'Cast Seed'],
  'metadata should include source, creator, and seed attributes',
);

assert.equal(
  normalizeCastUrl('warpcast.com/dwr.eth/0x55c2b3a9'),
  'https://warpcast.com/dwr.eth/0x55c2b3a9',
  'cast URLs pasted without scheme should be normalized',
);
assert.equal(
  extractCastAuthorFromUrl('https://farcaster.xyz/sayligood/0xeba9210d0a8e0bae70c523645d2fb72bf45467af'),
  'sayligood',
  'author should be inferred from a Farcaster cast URL',
);

const apiPayload = {
  result: {
    casts: [
      { hash: '0x111', text: 'Wrong cast', author: { username: 'alice' } },
      {
        hash: '0xeba9210d0a8e0bae70c523645d2fb72bf45467af',
        text: 'My Base wallet score is 763 (Power) ⚡',
        author: { username: 'sayligood' },
      },
    ],
  },
};
assert.deepEqual(
  findCastInApiResponse(apiPayload, '0xeba9210d0a8e0bae70c523645d2fb72bf45467af'),
  { text: 'My Base wallet score is 763 (Power) ⚡', author: 'sayligood' },
  'cast text should be extracted from a public cast API response by hash',
);

console.log('cast-nft tests passed');
