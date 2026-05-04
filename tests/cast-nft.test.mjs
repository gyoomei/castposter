import assert from 'node:assert/strict';
import { buildCastNftMetadata, getCastNftSeed } from '../dist-test/castNft.js';

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

console.log('cast-nft tests passed');
