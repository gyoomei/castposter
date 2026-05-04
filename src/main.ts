import { sdk } from '@farcaster/miniapp-sdk';
import { buildCastNftMetadata, getCastNftSeed } from './castNft';

const APP_URL = 'https://castposter.vercel.app/?v=4';
const SAMPLE_CAST = 'Mint the moment: turning this Farcaster cast into a collectible on Base. ✨';

const state = {
  castText: SAMPLE_CAST,
  author: 'gyoo',
  castUrl: '',
  status: 'Ready to transform a cast into an NFT concept.',
};

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

  const metadata = buildCastNftMetadata({
    castText: state.castText,
    author: state.author,
    castUrl: state.castUrl,
  });
  const seed = getCastNftSeed(`${state.author}:${state.castText}`);

  preview.innerHTML = `
    <div class="nft-orbit" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
    <div class="nft-frame">
      <div class="nft-topline">
        <span>CAST NFT</span>
        <span>#${shortAddress(seed)}</span>
      </div>
      <div class="quote-mark">“</div>
      <p class="cast-quote">${escapeHtml(state.castText || 'Paste a cast to preview your collectible.')}</p>
      <div class="nft-footer">
        <div>
          <small>Creator</small>
          <strong>@${escapeHtml(state.author || 'caster')}</strong>
        </div>
        <div>
          <small>Chain</small>
          <strong>Base</strong>
        </div>
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

function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <main class="app-shell">
      <section class="hero-panel">
        <nav class="topbar">
          <div class="brand-mark">✦</div>
          <div>
            <strong>CastMint</strong>
            <span>Cast → NFT</span>
          </div>
          <button id="closeBtn" class="icon-btn" aria-label="Back to Farcaster">←</button>
        </nav>

        <div class="hero-copy">
          <div class="badge">Farcaster Mini App · Base NFT Concept</div>
          <h1>Turn any cast into a collectible NFT.</h1>
          <p>Paste a Farcaster cast, generate an animated NFT card, then mint/share the concept from one clean mobile flow.</p>
        </div>

        <div class="action-stack">
          <button id="loadSampleBtn" class="ghost-btn">✨ Try sample cast</button>
          <button id="shareBtn" class="ghost-btn">📣 Share concept</button>
        </div>
      </section>

      <section class="workspace">
        <div id="previewCard" class="preview-card"></div>

        <form id="castForm" class="control-card">
          <label>
            <span>Cast text</span>
            <textarea id="castText" maxlength="280" rows="4" placeholder="Paste the cast you want to immortalize..."></textarea>
          </label>
          <div class="grid-2">
            <label>
              <span>Creator</span>
              <input id="authorName" maxlength="32" placeholder="username" />
            </label>
            <label>
              <span>Cast URL</span>
              <input id="castUrl" inputmode="url" placeholder="optional" />
            </label>
          </div>
          <button id="generateBtn" class="primary-btn" type="submit">Generate NFT Preview</button>
          <button id="mintBtn" class="mint-btn" type="button">Mint on Base Soon</button>
          <div id="metadataPanel" class="metadata-panel"></div>
          <div id="status" class="status">${escapeHtml(state.status)}</div>
        </form>
      </section>
    </main>
  `;

  syncInputs();
  renderPreview();
  bindEvents();
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
    state.castUrl = urlInput?.value.trim() || '';
    renderPreview();
  };

  castInput?.addEventListener('input', updateFromInputs);
  authorInput?.addEventListener('input', updateFromInputs);
  urlInput?.addEventListener('input', updateFromInputs);

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    updateFromInputs();
    setStatus('NFT preview generated. Mint contract wiring is the next production step.');
  });

  sampleBtn?.addEventListener('click', () => {
    state.castText = SAMPLE_CAST;
    state.author = 'gyoo';
    state.castUrl = 'https://warpcast.com/';
    syncInputs();
    renderPreview();
    setStatus('Sample cast loaded. Edit it or share the concept.');
  });

  mintBtn?.addEventListener('click', () => {
    setStatus('Mint flow placeholder: next step is ERC-721 contract + IPFS metadata upload.');
  });

  shareBtn?.addEventListener('click', async () => {
    try {
      setStatus('Opening Farcaster composer…');
      await sdk.actions.composeCast({
        text: `I am turning a Farcaster cast into a collectible NFT on Base with CastMint ✨\n\nCast → NFT, minted from the moment.`,
        embeds: [APP_URL],
      });
      setStatus('Composer opened.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Composer unavailable: ${message}`);
    }
  });

  closeBtn?.addEventListener('click', async () => {
    try {
      setStatus('Closing mini app…');
      await sdk.actions.close();
    } catch {
      if (window.history.length > 1) window.history.back();
      else window.location.href = 'https://farcaster.xyz/';
    }
  });
}

async function initMiniApp() {
  renderApp();

  try {
    sdk.back.onback = async () => {
      try {
        await sdk.actions.close();
      } catch {
        if (window.history.length > 1) window.history.back();
      }
    };
    await sdk.back.show();
  } catch (err) {
    console.warn('Farcaster back handling unavailable outside Mini App:', err);
  }

  try {
    await sdk.actions.ready();
    console.log('CastMint ready');
  } catch (err) {
    console.warn('ready() failed outside Farcaster Mini App:', err);
  }
}

initMiniApp();
