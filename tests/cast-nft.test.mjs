import assert from 'node:assert/strict';
import {
  buildCastMintTokenUri,
  buildCastNftMetadata,
  isValidEvmAddress,
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
  ['Source', 'Creator', 'Cast Seed', 'Chain'],
  'metadata should include source, creator, seed, and chain attributes',
);


const tokenUri = buildCastMintTokenUri({
  castText: sample,
  author: 'gyoo',
  castUrl: 'warpcast.com/gyoo/0x123',
});
assert.equal(tokenUri.startsWith('data:application/json;base64,'), true, 'mint token URI should be an onchain data URI');
const decodedMetadata = JSON.parse(Buffer.from(tokenUri.split(',')[1], 'base64').toString('utf8'));
assert.equal(decodedMetadata.name, metadata.name, 'mint token URI should reuse CastMint metadata name');
assert.equal(decodedMetadata.external_url, 'https://warpcast.com/gyoo/0x123', 'mint token URI should normalize source cast URL');
assert.equal(decodedMetadata.image.startsWith('data:image/svg+xml;base64,'), true, 'mint token URI should include an embedded SVG image');
assert.equal(decodedMetadata.attributes.some((item) => item.trait_type === 'Chain' && item.value === 'Base'), true, 'mint metadata should mark Base as chain');

assert.equal(isValidEvmAddress('0x0000000000000000000000000000000000000001'), true, 'valid EVM address should pass');
assert.equal(isValidEvmAddress('0x123'), false, 'short EVM address should fail');
assert.equal(isValidEvmAddress('not-an-address'), false, 'non-address should fail');

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


const singleCastPayload = {
  result: {
    cast: {
      merkleRoot: '0xeba9210d0a8e0bae70c523645d2fb72bf45467af',
      text: 'Original cast text from direct lookup',
      author: { username: 'sayligood' },
    },
  },
};
assert.deepEqual(
  findCastInApiResponse(singleCastPayload, '0xeba9210d0a8e0bae70c523645d2fb72bf45467af'),
  { text: 'Original cast text from direct lookup', author: 'sayligood' },
  'cast text should also be extracted from single cast API payloads',
);

const shortUrlHashPayload = {
  result: {
    casts: [
      {
        hash: '0xeba9210d0a8e0bae70c523645d2fb72bf45467af',
        text: 'Full hash cast should match short cast URLs too',
        author: { displayName: 'Forger' },
      },
    ],
  },
};
assert.deepEqual(
  findCastInApiResponse(shortUrlHashPayload, '0xeba9210d'),
  { text: 'Full hash cast should match short cast URLs too', author: 'Forger' },
  'short Warpcast URL hashes should match full API hashes so preview follows the original cast',
);

console.log('cast-nft tests passed');
