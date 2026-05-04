import { sdk } from '@farcaster/miniapp-sdk';
import {
  buildCastNftMetadata,
  extractCastAuthorFromUrl,
  findCastInApiResponse,
  getCastHashFromUrl,
  getCastNftSeed,
  normalizeCastUrl,
} from './castNft';

const SAMPLE_CAST = 'Paste a Farcaster cast URL to generate the NFT preview.';
const PUBLIC_FARCASTER_API = 'https://api.farcaster.xyz/v2';

const state = {
  castText: SAMPLE_CAST,
  author: 'gyoo',
  castUrl: '',
  status: 'Ready to transform a cast into an NFT concept.',
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

  metadataPanel.innerHTML = `
    <div class="meta-row"><span>Name</span><strong>${escapeHtml(metadata.name)}</strong></div>
    <div class="meta-row"><span>Source</span><strong>Farcaster Cast</strong></div>
    <div class="meta-row"><span>Seed</span><strong>${seed}</strong></div>
  `;
}

function syncInputs() {
  const urlInput = document.getElementById('castUrl') as HTMLInputElement | null;
  if (urlInput) urlInput.value = state.castUrl;
}

function setStatus(message: string) {
  state.status = message;
  const status = document.getElementById('status');
  if (status) status.textContent = message;
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
          <div class="badge">Farcaster Mini App · Base NFT Concept</div>
          <h1>Paste cast URL. Get NFT preview.</h1>
          <p>No manual text or creator fields. CastMint reads the original cast and updates the animated NFT card automatically.</p>
        </div>
        <div class="hero-hint">
          <span>01</span><strong>Paste URL</strong>
          <span>02</span><strong>Auto-read cast</strong>
          <span>03</span><strong>Preview NFT</strong>
        </div>
      </section>
      <section class="workspace">
        <div id="previewCard" class="preview-card"></div>
        <form id="castForm" class="control-card">
          <label><span>Cast URL</span><input id="castUrl" inputmode="url" autocomplete="off" placeholder="https://warpcast.com/username/0x..." /></label>
          <button id="generateBtn" class="primary-btn" type="submit">Generate NFT Preview</button>
          <button id="mintBtn" class="mint-btn" type="button">Mint on Base Soon</button>
          <div id="metadataPanel" class="metadata-panel"></div><div id="status" class="status">${escapeHtml(state.status)}</div>
        </form>
      </section>
    </main>`;

  syncInputs(); renderPreview(); bindEvents();
}

function bindEvents() {
  const form = document.getElementById('castForm') as HTMLFormElement | null;
  const urlInput = document.getElementById('castUrl') as HTMLInputElement | null;
  const mintBtn = document.getElementById('mintBtn') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement | null;

  const updateFromInputs = () => {
    state.castUrl = normalizeCastUrl(urlInput?.value || '');
    renderPreview();
  };

  const resolveUrlInput = async () => {
    const requestId = (castLookupRequest += 1);
    const rawUrl = urlInput?.value.trim() || '';
    const normalizedUrl = normalizeCastUrl(rawUrl);
    state.castUrl = normalizedUrl;
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
        syncInputs(); renderPreview(); setStatus('Cast text loaded from URL. NFT preview updated.');
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
  mintBtn?.addEventListener('click', () => setStatus('Mint flow placeholder: next step is ERC-721 contract + IPFS metadata upload.'));
  closeBtn?.addEventListener('click', async () => {
    try { setStatus('Closing mini app…'); await sdk.actions.close(); }
    catch { if (window.history.length > 1) window.history.back(); else window.location.href = 'https://farcaster.xyz/'; }
  });
}

async function initMiniApp() {
  renderApp();
  try { sdk.back.onback = async () => { try { await sdk.actions.close(); } catch { if (window.history.length > 1) window.history.back(); } }; await sdk.back.show(); }
  catch (err) { console.warn('Farcaster back handling unavailable outside Mini App:', err); }
  try { await sdk.actions.ready(); console.log('CastMint ready'); }
  catch (err) { console.warn('ready() failed outside Farcaster Mini App:', err); }
}

initMiniApp();
