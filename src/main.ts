import { sdk } from '@farcaster/miniapp-sdk';
import { decodeFunctionResult, encodeFunctionData, formatEther, keccak256, toBytes } from 'viem';
import {
  buildCastMintTokenUri,
  buildCastNftMetadata,
  extractCastAuthorFromUrl,
  findCastInApiResponse,
  getCastHashFromUrl,
  getCastNftSeed,
  isValidEvmAddress,
  normalizeCastUrl,
} from './castNft';

const SAMPLE_CAST = 'Paste a Farcaster cast URL to generate the NFT preview.';
const PUBLIC_FARCASTER_API = 'https://api.farcaster.xyz/v2';
const BASE_CHAIN_ID_HEX = '0x2105';
const DEFAULT_MINT_CONTRACT_ADDRESS = '0xd70309f170C88012727A725079f37D621Cb679c3';
const MINT_CONTRACT_ADDRESS = import.meta.env.VITE_CASTMINT_CONTRACT_ADDRESS || DEFAULT_MINT_CONTRACT_ADDRESS;
const MINT_FUNCTION_NAME = import.meta.env.VITE_CASTMINT_FUNCTION_NAME || 'mintTo';
const MINT_ABI = [
  {
    type: 'function',
    name: MINT_FUNCTION_NAME,
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenURI', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const;
const MINT_PRICE_ABI = [
  {
    type: 'function',
    name: 'mintPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'price', type: 'uint256' }],
  },
] as const;
const EXPECTED_MINT_SELECTOR = keccak256(toBytes(`${MINT_FUNCTION_NAME}(address,string)`)).slice(2, 10).toLowerCase();
const EXPECTED_MINT_SELECTOR_IN_BYTECODE = EXPECTED_MINT_SELECTOR.replace(/^0+/, '') || EXPECTED_MINT_SELECTOR;
let mintCompatibilityChecked = false;
let mintCompatibilityWarning = '';
let mintPriceWei = 0n;

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
};

const state = {
  castText: SAMPLE_CAST,
  author: 'gyoo',
  castUrl: '',
  status: 'Ready to transform a cast into an NFT concept.',
  minting: false,
  lastMintHash: '',
};

let castLookupRequest = 0;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function shortAddress(seed: string) {
  return `${seed.slice(0, 4).toUpperCase()}-${seed.slice(4).toUpperCase()}`;
}

function getMintButtonLabel() {
  if (state.minting) return 'Minting on Base…';
  if (!isValidEvmAddress(MINT_CONTRACT_ADDRESS)) return 'Mint Contract Needed';
  if (mintCompatibilityWarning) return 'Mint ABI Needed';
  return mintPriceWei > 0n ? `Mint on Base · ${formatEther(mintPriceWei)} ETH` : 'Mint on Base';
}

async function readMintPrice() {
  if (!isValidEvmAddress(MINT_CONTRACT_ADDRESS)) return 0n;
  try {
    const response = await fetch('https://base-rpc.publicnode.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_call',
        params: [{
          to: MINT_CONTRACT_ADDRESS,
          data: encodeFunctionData({ abi: MINT_PRICE_ABI, functionName: 'mintPrice' }),
        }, 'latest'],
      }),
    });
    const payload = await response.json();
    const result = typeof payload?.result === 'string' ? payload.result : '0x';
    if (result && result !== '0x') {
      mintPriceWei = decodeFunctionResult({ abi: MINT_PRICE_ABI, functionName: 'mintPrice', data: result }) as bigint;
    }
  } catch (err) {
    console.warn('Mint price read skipped:', err);
  } finally {
    syncActionButtons();
  }
  return mintPriceWei;
}

async function checkMintCompatibility() {
  if (mintCompatibilityChecked || !isValidEvmAddress(MINT_CONTRACT_ADDRESS)) return !mintCompatibilityWarning;
  mintCompatibilityChecked = true;
  try {
    const response = await fetch('https://base-rpc.publicnode.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [MINT_CONTRACT_ADDRESS, 'latest'],
      }),
    });
    const payload = await response.json();
    const code = String(payload?.result || '').toLowerCase();
    if (code && code !== '0x' && !code.includes(EXPECTED_MINT_SELECTOR) && !code.includes(EXPECTED_MINT_SELECTOR_IN_BYTECODE)) {
      mintCompatibilityWarning = `Mint ABI mismatch: contract ${MINT_CONTRACT_ADDRESS} does not expose ${MINT_FUNCTION_NAME}(address,string).`;
      setStatus('Mint contract found, but ABI belum cocok.');
      renderPreview();
      return false;
    }
    await readMintPrice();
  } catch (err) {
    console.warn('Mint compatibility check skipped:', err);
  } finally {
    syncActionButtons();
  }
  return !mintCompatibilityWarning;
}

function renderPreview() {
  const preview = document.getElementById('previewCard');
  const metadataPanel = document.getElementById('metadataPanel');
  if (!preview || !metadataPanel) return;

  const metadata = buildCastNftMetadata({ castText: state.castText, author: state.author, castUrl: state.castUrl });
  const seed = getCastNftSeed(`${state.author}:${state.castText}`);

  preview.innerHTML = `
    <div class="nft-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="nft-frame">
      <div class="nft-topline"><span>CAST NFT</span><span>#${shortAddress(seed)}</span></div>
      <div class="quote-mark">“</div>
      <p class="cast-quote">${escapeHtml(state.castText || 'Paste a cast URL to preview your collectible.')}</p>
      <div class="nft-footer">
        <div><small>Creator</small><strong>@${escapeHtml(state.author || 'caster')}</strong></div>
        <div><small>Chain</small><strong>Base</strong></div>
      </div>
    </div>
  `;

  metadataPanel.innerHTML = '';
}

function syncInputs() {
  const urlInput = document.getElementById('castUrl') as HTMLInputElement | null;
  if (urlInput) urlInput.value = state.castUrl;
}

function syncMintButton() {
  const mintBtn = document.getElementById('mintBtn') as HTMLButtonElement | null;
  if (!mintBtn) return;
  mintBtn.textContent = getMintButtonLabel();
  mintBtn.disabled = state.minting;
}

function syncShareButton() {
  const shareBtn = document.getElementById('shareBtn') as HTMLButtonElement | null;
  if (!shareBtn) return;
  shareBtn.hidden = !state.lastMintHash;
  shareBtn.disabled = !state.lastMintHash || state.minting;
}

function syncActionButtons() {
  syncMintButton();
  syncShareButton();
}

function setStatus(message: string) {
  state.status = message;
  const status = document.getElementById('status');
  if (status) status.textContent = message;
  syncActionButtons();
}

async function shareMintSuccess() {
  if (!state.lastMintHash) {
    setStatus('Mint dulu, setelah berhasil tombol share akan aktif.');
    return;
  }

  const appUrl = `${window.location.origin}/?v=9`;
  const castLine = state.castUrl ? `Original cast: ${state.castUrl}\n` : '';
  const txLine = `Base tx: https://basescan.org/tx/${state.lastMintHash}`;
  const text = `Just minted a Farcaster cast as an NFT on Base with CastMint ✦\n\n@${state.author || 'caster'} → collectible onchain.\n${castLine}${txLine}\n\nMint yours:`;

  setStatus('Opening Farcaster share composer…');
  try {
    await sdk.actions.composeCast({ text, embeds: [appUrl] });
    setStatus('Share composer opened. Review and cast when ready.');
  } catch (err) {
    console.warn('Native share failed, using fallback:', err);
    const fallbackText = `${text}\n${appUrl}`;
    try { await navigator.clipboard.writeText(fallbackText); } catch { /* optional */ }
    window.open(`https://warpcast.com/~/compose?text=${encodeURIComponent(fallbackText)}`, '_blank', 'noopener,noreferrer');
    setStatus('Share text copied. Warpcast compose opened as fallback.');
  }
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchLocalCastApi(normalizedUrl: string) {
  const localApiUrl = `${window.location.origin}/api/cast?url=${encodeURIComponent(normalizedUrl)}`;
  const response = await fetch(localApiUrl, { headers: { Accept: 'application/json' } });
  const contentType = response.headers.get('content-type') || '';
  if (response.ok && contentType.includes('application/json')) {
    const payload = (await response.json()) as { text?: string; author?: string; cast?: { text?: string; author?: { username?: string; displayName?: string } | string } };
    const directText = payload.text?.trim();
    if (directText) return { text: directText, author: payload.author?.trim() || 'caster' };
    const nestedText = payload.cast?.text?.trim();
    if (nestedText) {
      const nestedAuthor = typeof payload.cast.author === 'string'
        ? payload.cast.author
        : payload.cast.author?.username || payload.cast.author?.displayName;
      return { text: nestedText, author: nestedAuthor?.trim() || 'caster' };
    }
  }
  return null;
}

async function resolveCastFromUrl(rawUrl: string) {
  const normalizedUrl = normalizeCastUrl(rawUrl);
  const hash = getCastHashFromUrl(normalizedUrl);
  const username = extractCastAuthorFromUrl(normalizedUrl);
  if (!normalizedUrl || !hash || !username) return null;

  try {
    const localResult = await fetchLocalCastApi(normalizedUrl);
    if (localResult) return localResult;
  } catch (err) {
    console.warn('Local cast API unavailable, trying direct public API:', err);
  }

  const userPayload = await fetchJson(`${PUBLIC_FARCASTER_API}/user-by-username?username=${encodeURIComponent(username)}`);
  const fid = userPayload?.result?.user?.fid;
  if (!fid) throw new Error('FID not found');

  let cursor = '';
  for (let page = 0; page < 20; page += 1) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const castsPayload = await fetchJson(`${PUBLIC_FARCASTER_API}/casts?fid=${encodeURIComponent(String(fid))}&limit=50${cursorParam}`);
    const foundCast = findCastInApiResponse(castsPayload, hash);
    if (foundCast) return foundCast;
    cursor = castsPayload?.result?.next?.cursor || castsPayload?.result?.cursor || castsPayload?.next?.cursor || castsPayload?.cursor || '';
    if (!cursor) break;
  }

  return null;
}

async function getEthereumProvider(): Promise<EthereumProvider | null> {
  try {
    const miniProvider = await sdk.wallet.getEthereumProvider();
    if (miniProvider) return miniProvider as unknown as EthereumProvider;
  } catch (err) {
    console.warn('Farcaster wallet provider unavailable:', err);
  }

  const browserProvider = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  return browserProvider || null;
}

async function ensureBaseNetwork(provider: EthereumProvider) {
  const currentChainId = await provider.request({ method: 'eth_chainId' });
  if (typeof currentChainId === 'string' && currentChainId.toLowerCase() === BASE_CHAIN_ID_HEX) return;

  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID_HEX }] });
  } catch (switchError) {
    const errorCode = (switchError as { code?: number }).code;
    if (errorCode !== 4902) throw switchError;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: BASE_CHAIN_ID_HEX,
        chainName: 'Base',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://mainnet.base.org'],
        blockExplorerUrls: ['https://basescan.org'],
      }],
    });
  }
}

async function mintCastNft() {
  if (state.minting) return;
  const normalizedUrl = normalizeCastUrl(state.castUrl);
  if (!normalizedUrl || !getCastHashFromUrl(normalizedUrl)) {
    setStatus('Paste a valid Farcaster cast URL first, then mint.');
    return;
  }
  if (state.castText === SAMPLE_CAST) {
    setStatus('Load the original cast text first so the NFT metadata matches the cast.');
    return;
  }
  if (!isValidEvmAddress(MINT_CONTRACT_ADDRESS)) {
    setStatus('Mint belum bisa dikirim: alamat contract Base belum valid.');
    return;
  }
  const isMintCompatible = await checkMintCompatibility();
  if (!isMintCompatible) {
    setStatus('Mint ditahan: ABI mint belum cocok.');
    return;
  }

  state.minting = true;
  state.lastMintHash = '';
  setStatus('Connecting wallet…');
  try {
    const provider = await getEthereumProvider();
    if (!provider) throw new Error('No Ethereum wallet provider found');

    await ensureBaseNetwork(provider);
    const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
    const account = accounts?.[0];
    if (!isValidEvmAddress(account || '')) throw new Error('Wallet account unavailable');

    const tokenUri = buildCastMintTokenUri({ castText: state.castText, author: state.author, castUrl: normalizedUrl });
    const data = encodeFunctionData({
      abi: MINT_ABI,
      functionName: MINT_FUNCTION_NAME,
      args: [account, tokenUri],
    });

    setStatus('Confirm mint transaction in your wallet…');
    const hash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: account,
        to: MINT_CONTRACT_ADDRESS,
        data,
        value: mintPriceWei > 0n ? `0x${mintPriceWei.toString(16)}` : '0x0',
      }],
    }) as string;

    state.lastMintHash = hash;
    setStatus(`Mint success on Base: ${hash.slice(0, 10)}…${hash.slice(-6)}. Share button unlocked.`);
  } catch (err) {
    console.warn('Mint failed:', err);
    const message = err instanceof Error ? err.message : 'Wallet rejected or transaction failed';
    setStatus(`Mint failed: ${message}`);
  } finally {
    state.minting = false;
    syncActionButtons();
  }
}

function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <main class="app-shell">
      <section class="hero-panel">
        <nav class="topbar">
          <div class="brand-mark">✦</div><div><strong>CastMint</strong><span>Cast → NFT</span></div>
          <button id="closeBtn" class="icon-btn" aria-label="Back to Farcaster">←</button>
        </nav>
        <div class="hero-copy">
          <div class="badge">Farcaster Mini App · Base NFT Mint</div>
          <h1>Paste cast URL. Mint it on Base.</h1>
          <p>No manual text or creator fields. CastMint reads the original cast and prepares a wallet mint with embedded onchain metadata.</p>
        </div>
        <div class="hero-glowline" aria-hidden="true"></div>
        <div class="hero-hint">
          <span>01</span><strong>Paste URL</strong>
          <span>02</span><strong>Auto-read cast</strong>
          <span>03</span><strong>Mint on Base</strong>
        </div>
      </section>
      <section class="workspace">
        <div id="previewCard" class="preview-card"></div>
        <form id="castForm" class="control-card">
          <label><span>Cast URL</span><input id="castUrl" inputmode="url" autocomplete="off" placeholder="https://warpcast.com/username/0x..." /></label>
          <button id="generateBtn" class="primary-btn" type="submit">Generate NFT Preview</button>
          <button id="mintBtn" class="mint-btn" type="button">${getMintButtonLabel()}</button>
          <button id="shareBtn" class="share-btn" type="button" hidden>Share minted NFT</button>
          <div id="metadataPanel" class="metadata-panel"></div><div id="status" class="status">${escapeHtml(state.status)}</div>
        </form>
      </section>
    </main>`;

  syncInputs(); renderPreview(); syncActionButtons(); bindEvents();
}

function bindEvents() {
  const form = document.getElementById('castForm') as HTMLFormElement | null;
  const urlInput = document.getElementById('castUrl') as HTMLInputElement | null;
  const mintBtn = document.getElementById('mintBtn') as HTMLButtonElement | null;
  const shareBtn = document.getElementById('shareBtn') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement | null;

  const updateFromInputs = () => {
    state.castUrl = normalizeCastUrl(urlInput?.value || '');
    state.lastMintHash = '';
    renderPreview();
    syncActionButtons();
  };

  const resolveUrlInput = async () => {
    const requestId = (castLookupRequest += 1);
    const rawUrl = urlInput?.value.trim() || '';
    const normalizedUrl = normalizeCastUrl(rawUrl);
    state.castUrl = normalizedUrl;
    state.lastMintHash = '';
    if (!normalizedUrl) { setStatus('Ready to transform a cast into an NFT concept.'); return; }

    const fallbackAuthor = extractCastAuthorFromUrl(normalizedUrl);
    if (fallbackAuthor && fallbackAuthor !== 'caster') {
      state.author = fallbackAuthor;
      renderPreview();
    }
    if (!getCastHashFromUrl(normalizedUrl)) {
      setStatus('Cast URL detected, but no cast hash found. Paste a full cast URL.'); return;
    }

    setStatus('Fetching cast text from Farcaster…');
    try {
      const resolved = await resolveCastFromUrl(normalizedUrl);
      if (requestId !== castLookupRequest) return;
      if (resolved?.text) {
        state.castText = resolved.text;
        state.author = resolved.author || fallbackAuthor || state.author;
        state.castUrl = normalizedUrl;
        syncInputs(); renderPreview(); setStatus('Cast text loaded from URL. Ready to mint on Base.');
      } else setStatus('Cast URL saved, but the public API could not find the original cast text.');
    } catch (err) {
      if (requestId !== castLookupRequest) return;
      console.warn('Cast URL lookup failed:', err);
      setStatus('Cast URL saved. Public lookup is unavailable right now, try again in a moment.');
    }
  };

  urlInput?.addEventListener('input', () => { updateFromInputs(); window.setTimeout(resolveUrlInput, 250); });
  urlInput?.addEventListener('change', resolveUrlInput);

  form?.addEventListener('submit', (event) => { event.preventDefault(); resolveUrlInput(); });
  mintBtn?.addEventListener('click', mintCastNft);
  shareBtn?.addEventListener('click', shareMintSuccess);
  closeBtn?.addEventListener('click', async () => {
    try { setStatus('Closing mini app…'); await sdk.actions.close(); }
    catch { if (window.history.length > 1) window.history.back(); else window.location.href = 'https://farcaster.xyz/'; }
  });
}

async function initMiniApp() {
  renderApp();
  void checkMintCompatibility();
  try { sdk.back.onback = async () => { try { await sdk.actions.close(); } catch { if (window.history.length > 1) window.history.back(); } }; await sdk.back.show(); }
  catch (err) { console.warn('Farcaster back handling unavailable outside Mini App:', err); }
  try { await sdk.actions.ready(); console.log('CastMint ready'); }
  catch (err) { console.warn('ready() failed outside Farcaster Mini App:', err); }
}

initMiniApp();
