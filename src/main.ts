import { sdk } from '@farcaster/miniapp-sdk';
import { decodeFunctionResult, encodeFunctionData, formatEther, keccak256, toBytes } from 'viem';
import {
  buildCastMintTokenUri,
  CASTMINT_PREVIEW_STYLES,
  CastMintHistoryItem,
  CastMintPreviewStyle,
  createMintHistoryItem,
  extractCastAuthorFromUrl,
  findCastInApiResponse,
  formatTxHash,
  getCastHashFromUrl,
  getPreviewStyle,
  getCastNftSeed,
  isValidEvmAddress,
  normalizeCastUrl,
} from './castNft';

const SAMPLE_CAST = 'Paste a Farcaster cast URL to generate the NFT preview.';
const PUBLIC_FARCASTER_API = 'https://api.farcaster.xyz/v2';
const BASE_CHAIN_ID_HEX = '0x2105';
const DEFAULT_MINT_CONTRACT_ADDRESS = '0xd70309f170C88012727A725079f37D621Cb679c3';
const env = import.meta.env as { VITE_CASTMINT_CONTRACT_ADDRESS?: string; VITE_CASTMINT_FUNCTION_NAME?: string };
const MINT_CONTRACT_ADDRESS = env.VITE_CASTMINT_CONTRACT_ADDRESS || DEFAULT_MINT_CONTRACT_ADDRESS;
const MINT_FUNCTION_NAME = env.VITE_CASTMINT_FUNCTION_NAME || 'mintTo';
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
const HISTORY_STORAGE_KEY = 'castmint.mintHistory.v1';
const HISTORY_LIMIT = 5;

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
  previewStyle: 'neon' as CastMintPreviewStyle,
  detectedUser: '',
  isMiniApp: false,
  addMiniAppAvailable: false,
  posterUrl: '',
  history: [] as CastMintHistoryItem[],
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

function shortText(value: string, maxLength = 88) {
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

function readMintHistory(): CastMintHistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.txHash === 'string')
      .map((item) => createMintHistoryItem({
        castText: String(item.castText || ''),
        author: String(item.author || 'caster'),
        castUrl: String(item.castUrl || ''),
        txHash: String(item.txHash || ''),
        mintedAt: String(item.mintedAt || ''),
        style: String(item.style || 'neon'),
      }))
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveMintHistory(items: CastMintHistoryItem[]) {
  try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT))); }
  catch (err) { console.warn('Mint history save skipped:', err); }
}

function addMintHistoryItem(txHash: string) {
  const item = createMintHistoryItem({
    castText: state.castText,
    author: state.author,
    castUrl: state.castUrl,
    txHash,
    style: state.previewStyle,
  });
  state.history = [item, ...state.history.filter((entry) => entry.txHash !== txHash)].slice(0, HISTORY_LIMIT);
  saveMintHistory(state.history);
  return item;
}

function renderPosterSvg(item: CastMintHistoryItem) {
  const seed = getCastNftSeed(`${item.author}:${item.castText}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#050711"/><stop offset=".40" stop-color="#0f172a"/><stop offset=".75" stop-color="#1e1b4b"/><stop offset="1" stop-color="#4a044e"/></linearGradient>
    <radialGradient id="a" cx="25%" cy="16%" r="80%"><stop offset="0" stop-color="#55e7ff" stop-opacity=".75"/><stop offset="1" stop-color="#55e7ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="b" cx="82%" cy="80%" r="75%"><stop offset="0" stop-color="#ff5bd7" stop-opacity=".52"/><stop offset="1" stop-color="#ff5bd7" stop-opacity="0"/></radialGradient>
    <linearGradient id="border" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#55e7ff" stop-opacity=".75"/><stop offset=".50" stop-color="#ff5bd7" stop-opacity=".65"/><stop offset="1" stop-color="#ffd166" stop-opacity=".55"/></linearGradient>
  </defs>
  <rect width="1200" height="1600" rx="92" fill="url(#bg)"/><rect width="1200" height="1600" rx="92" fill="url(#a)"/><rect width="1200" height="1600" rx="92" fill="url(#b)"/>
  <rect x="70" y="78" width="1060" height="1444" rx="78" fill="rgba(255,255,255,.055)" stroke="url(#border)" stroke-width="3.5"/>
  <text x="126" y="176" fill="#dffbff" font-family="Inter,Arial,sans-serif" font-size="44" font-weight="900" letter-spacing="9">CASTMINT</text>
  <text x="126" y="256" fill="#ffd166" font-family="Inter,Arial,sans-serif" font-size="32" font-weight="900">MINTED ON BASE</text>
  <text x="130" y="498" fill="rgba(255,255,255,.16)" font-family="Georgia,serif" font-size="230" font-weight="900">“</text>
  <foreignObject x="126" y="548" width="948" height="520"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#fff;font-family:Inter,Arial,sans-serif;font-size:62px;line-height:1.12;font-weight:950;letter-spacing:-3px;overflow:hidden;text-shadow:0 2px 24px rgba(0,0,0,.35);">${escapeHtml(shortText(item.castText, 170))}</div></foreignObject>
  <text x="126" y="1258" fill="#9aa4bd" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="800" letter-spacing="2">CREATOR</text><text x="126" y="1318" fill="#fff" font-family="Inter,Arial,sans-serif" font-size="50" font-weight="950">@${escapeHtml(item.author)}</text>
  <text x="126" y="1402" fill="#9aa4bd" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="800">TX ${escapeHtml(formatTxHash(item.txHash))}</text>
  <text x="848" y="1402" fill="#ffe08a" font-family="Inter,Arial,sans-serif" font-size="36" font-weight="950">#${escapeHtml(seed)}</text>
  <circle cx="114" cy="1486" r="5" fill="#55e7ff" opacity=".85"/>
  <circle cx="134" cy="1486" r="5" fill="#ff5bd7" opacity=".85"/>
  <circle cx="154" cy="1486" r="5" fill="#ffd166" opacity=".85"/>
</svg>`;
}

function posterDataUrl(item: CastMintHistoryItem) {
  const bytes = new TextEncoder().encode(renderPosterSvg(item));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `data:image/svg+xml;base64,${btoa(binary)}`;
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

  const seed = getCastNftSeed(`${state.author}:${state.castText}`);
  const styleClass = `style-${getPreviewStyle(state.previewStyle)}`;
  const styleLabel = CASTMINT_PREVIEW_STYLES.find((item) => item.id === state.previewStyle)?.label || 'Neon';

  preview.className = `preview-card ${styleClass}`;
  preview.innerHTML = `
    <div class="nft-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="nft-frame">
      <div class="nft-topline"><span>CAST NFT</span><span>${escapeHtml(styleLabel)} · #${shortAddress(seed)}</span></div>
      <div class="quote-mark">“</div>
      <p class="cast-quote">${escapeHtml(state.castText || 'Paste a cast URL to preview your collectible.')}</p>
      <div class="nft-footer">
        <div><small>Creator</small><strong>@${escapeHtml(state.author || 'caster')}</strong></div>
        <div><small>Chain</small><strong>Base</strong></div>
      </div>
    </div>
  `;

  metadataPanel.innerHTML = '';
  renderSuccessCard();
  renderHistory();
}

function renderStylePicker() {
  const picker = document.getElementById('stylePicker');
  if (!picker) return;
  picker.innerHTML = CASTMINT_PREVIEW_STYLES.map((style) => `
    <button type="button" class="style-chip ${style.id === state.previewStyle ? 'active' : ''}" data-style="${style.id}">
      <strong>${escapeHtml(style.label)}</strong><span>${escapeHtml(style.description)}</span>
    </button>
  `).join('');
  picker.querySelectorAll<HTMLButtonElement>('.style-chip').forEach((button) => {
    button.addEventListener('click', () => {
      state.previewStyle = getPreviewStyle(button.dataset.style || '');
      state.posterUrl = '';
      renderStylePicker();
      renderPreview();
      setStatus(`Preview style switched to ${CASTMINT_PREVIEW_STYLES.find((item) => item.id === state.previewStyle)?.label || 'Neon'}.`);
    });
  });
}

function renderSuccessCard() {
  const card = document.getElementById('successCard');
  if (!card) return;
  if (!state.lastMintHash) { card.hidden = true; card.innerHTML = ''; return; }
  const txUrl = `https://basescan.org/tx/${state.lastMintHash}`;
  card.hidden = false;
  card.innerHTML = `
    <div class="success-kicker">Mint complete ✦</div>
    <h2>Cast NFT minted on Base</h2>
    <p>@${escapeHtml(state.author || 'caster')} · ${escapeHtml(formatTxHash(state.lastMintHash))}</p>
    <div class="success-actions">
      <a class="mini-link" href="${txUrl}" target="_blank" rel="noopener noreferrer">View on Basescan</a>
      <button id="posterBtn" class="mini-link" type="button">Create result poster</button>
      <button id="mintAnotherBtn" class="mini-link subtle" type="button">Mint another cast</button>
    </div>
    ${state.posterUrl ? `<img class="poster-preview" src="${state.posterUrl}" alt="CastMint result poster preview" />` : ''}
  `;
  document.getElementById('posterBtn')?.addEventListener('click', createResultPoster);
  document.getElementById('mintAnotherBtn')?.addEventListener('click', () => {
    state.lastMintHash = '';
    state.posterUrl = '';
    setStatus('Ready for another cast URL.');
    renderPreview();
  });
}

function renderHistory() {
  const history = document.getElementById('historyPanel');
  if (!history) return;
  if (!state.history.length) {
    history.innerHTML = '<div class="history-empty">Local mint history will appear here after a successful mint.</div>';
    return;
  }
  history.innerHTML = state.history.map((item) => `
    <article class="history-item">
      <div><strong>@${escapeHtml(item.author)}</strong><span>${escapeHtml(shortText(item.castText, 70))}</span></div>
      <a href="https://basescan.org/tx/${item.txHash}" target="_blank" rel="noopener noreferrer">${escapeHtml(formatTxHash(item.txHash))}</a>
    </article>
  `).join('');
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
  const txLine = `Base tx: https://basescan.org/tx/${state.lastMintHash}`;
  const text = `Just minted a Farcaster cast as an NFT on Base with CastMint ✦\n\n"${shortText(state.castText, 120)}"\n— @${state.author || 'caster'}\n\n${txLine}\n\nMint yours:`;

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

async function createResultPoster() {
  if (!state.lastMintHash) { setStatus('Mint dulu sebelum membuat result poster.'); return; }
  const item = state.history.find((entry) => entry.txHash === state.lastMintHash) || createMintHistoryItem({
    castText: state.castText,
    author: state.author,
    castUrl: state.castUrl,
    txHash: state.lastMintHash,
    style: state.previewStyle,
  });
  state.posterUrl = posterDataUrl(item);
  renderSuccessCard();
  setStatus('Result poster generated locally. Long-press/save image, then share it anywhere.');
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
    if (nestedText && payload.cast) {
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
      args: [account as `0x${string}`, tokenUri],
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
    state.posterUrl = '';
    addMintHistoryItem(hash);
    renderPreview();
    setStatus(`Mint success on Base: ${formatTxHash(hash)}. Success card, history, and share unlocked.`);
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
      </section>
      <section class="workspace">
        <div id="previewCard" class="preview-card"></div>
        <form id="castForm" class="control-card">
          <label><span>Cast URL</span><input id="castUrl" inputmode="url" autocomplete="off" placeholder="https://warpcast.com/username/0x..." /></label>
          <button id="generateBtn" class="primary-btn" type="submit">Generate NFT Preview</button>
          <button id="mintBtn" class="mint-btn" type="button">${getMintButtonLabel()}</button>
          <div class="mini-profile" id="miniProfile">${state.detectedUser ? `Detected Farcaster user: @${escapeHtml(state.detectedUser)}` : 'Open in Farcaster for auto user detection.'}</div>
          <div class="style-picker" id="stylePicker"></div>
          <button id="shareBtn" class="share-btn" type="button" hidden>Share minted NFT</button>
          <section id="successCard" class="success-card" hidden></section>
          <section class="history-card"><div class="section-title">Local mint history</div><div id="historyPanel"></div></section>
          <div id="metadataPanel" class="metadata-panel"></div><div id="status" class="status">${escapeHtml(state.status)}</div>
        </form>
      </section>
    </main>`;

  syncInputs(); renderStylePicker(); renderPreview(); syncActionButtons(); bindEvents();
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
    state.posterUrl = '';
    renderPreview();
    syncActionButtons();
  };

  const resolveUrlInput = async () => {
    const requestId = (castLookupRequest += 1);
    const rawUrl = urlInput?.value.trim() || '';
    const normalizedUrl = normalizeCastUrl(rawUrl);
    state.castUrl = normalizedUrl;
    state.lastMintHash = '';
    state.posterUrl = '';
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
  state.history = readMintHistory();
  try {
    const context = await sdk.context;
    const user = context?.user;
    state.detectedUser = user?.username || user?.displayName || '';
    state.isMiniApp = Boolean(context?.client || user);
    state.addMiniAppAvailable = true;
  } catch (err) {
    console.warn('Farcaster context unavailable outside Mini App:', err);
  }
  renderApp();
  void checkMintCompatibility();
  try { sdk.back.onback = async () => { try { await sdk.actions.close(); } catch { if (window.history.length > 1) window.history.back(); } }; await sdk.back.show(); }
  catch (err) { console.warn('Farcaster back handling unavailable outside Mini App:', err); }
  try { await sdk.actions.ready(); console.log('CastMint ready'); }
  catch (err) { console.warn('ready() failed outside Farcaster Mini App:', err); }
}

initMiniApp();
