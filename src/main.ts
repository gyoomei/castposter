import { sdk } from '@farcaster/miniapp-sdk';
import {
  buildCastNftMetadata,
  extractCastAuthorFromUrl,
  findCastInApiResponse,
  getCastHashFromUrl,
  getCastNftSeed,
  normalizeCastUrl,
} from './castNft';

const APP_URL = 'https://castposter.vercel.app/?v=5';
const SAMPLE_CAST = 'Mint the moment: turning this Farcaster cast into a collectible on Base. ✨';
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
      <p class="cast-quote">${escapeHtml(state.castText || 'Paste a cast URL or text to preview your collectible.')}</p>
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
  const castInput = document.getElementById('castText') as HTMLTextAreaElement | null;
  const authorInput = document.getElementById('authorName') as HTMLInputElement | null;
  const urlInput = document.getElementById('castUrl') as HTMLInputElement | null;
  if (castInput) castInput.value = state.castText;
  if (authorInput) authorInput.value = state.author;
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
  const castsPayload = await fetchJson(`${PUBLIC_FARCASTER_API}/casts?fid=${encodeURIComponent(String(fid))}&limit=50`);
  return findCastInApiResponse(castsPayload, hash);
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
          <h1>Turn any cast into a collectible NFT.</h1>
          <p>Paste a Farcaster cast, generate an animated NFT card, then mint/share the concept from one clean mobile flow.</p>
        </div>
        <div class="action-stack"><button id="loadSampleBtn" class="ghost-btn">✨ Try sample cast</button><button id="shareBtn" class="ghost-btn">📣 Share concept</button></div>
      </section>
      <section class="workspace">
        <div id="previewCard" class="preview-card"></div>
        <form id="castForm" class="control-card">
          <label><span>Cast text</span><textarea id="castText" maxlength="280" rows="4" placeholder="Paste the cast you want to immortalize..."></textarea></label>
          <div class="grid-2">
            <label><span>Creator</span><input id="authorName" maxlength="32" placeholder="username" /></label>
            <label><span>Cast URL</span><input id="castUrl" inputmode="url" placeholder="https://warpcast.com/username/0x..." /></label>
          </div>
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
  const castInput = document.getElementById('castText') as HTMLTextAreaElement | null;
  const authorInput = document.getElementById('authorName') as HTMLInputElement | null;
  const urlInput = document.getElementById('castUrl') as HTMLInputElement | null;
  const sampleBtn = document.getElementById('loadSampleBtn') as HTMLButtonElement | null;
  const mintBtn = document.getElementById('mintBtn') as HTMLButtonElement | null;
  const shareBtn = document.getElementById('shareBtn') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement | null;

  const updateFromInputs = () => {
    state.castText = castInput?.value.trim() || '';
    state.author = authorInput?.value.trim().replace(/^@/, '') || 'caster';
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
      if (authorInput) authorInput.value = fallbackAuthor;
      renderPreview();
    }
    if (!getCastHashFromUrl(normalizedUrl)) {
      setStatus('Cast URL detected. Add the cast text manually if the URL has no cast hash.'); return;
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
      } else setStatus('Cast URL saved, but the public API could not find the cast text. Paste text manually as fallback.');
    } catch (err) {
      if (requestId !== castLookupRequest) return;
      console.warn('Cast URL lookup failed:', err);
      setStatus('Cast URL saved. Public lookup is unavailable here, so paste the cast text manually as fallback.');
    }
  };

  castInput?.addEventListener('input', updateFromInputs);
  authorInput?.addEventListener('input', updateFromInputs);
  urlInput?.addEventListener('input', () => { updateFromInputs(); window.setTimeout(resolveUrlInput, 250); });
  urlInput?.addEventListener('change', resolveUrlInput);

  form?.addEventListener('submit', (event) => { event.preventDefault(); updateFromInputs(); setStatus('NFT preview generated. Mint contract wiring is the next production step.'); });
  sampleBtn?.addEventListener('click', () => { state.castText = SAMPLE_CAST; state.author = 'gyoo'; state.castUrl = 'https://warpcast.com/gyoo/0xsample'; syncInputs(); renderPreview(); setStatus('Sample cast loaded. Edit it or share the concept.'); });
  mintBtn?.addEventListener('click', () => setStatus('Mint flow placeholder: next step is ERC-721 contract + IPFS metadata upload.'));
  shareBtn?.addEventListener('click', async () => {
    try { setStatus('Opening Farcaster composer…'); await sdk.actions.composeCast({ text: `I am turning a Farcaster cast into a collectible NFT on Base with CastMint ✨\n\nCast → NFT, minted from the moment.`, embeds: [APP_URL] }); setStatus('Composer opened.'); }
    catch (err) { const message = err instanceof Error ? err.message : String(err); setStatus(`Composer unavailable: ${message}`); }
  });
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
