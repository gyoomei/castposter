import { sdk } from '@farcaster/miniapp-sdk';

const DEFAULT_CAST = 'Hello from CastPoster Mini App! 🚀';

function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <main class="shell">
      <section class="hero-card">
        <div class="badge">Farcaster Mini App</div>
        <h1>🎯 CastPoster</h1>
        <p>Compose a clean cast directly inside Farcaster with native Mini App navigation.</p>
        <button id="composeBtn" class="primary-btn">✍️ Compose Cast</button>
        <button id="closeBtn" class="ghost-btn">← Back to Farcaster</button>
        <div id="status" class="status">Ready</div>
      </section>
    </main>
  `;

  const composeBtn = document.getElementById('composeBtn') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement | null;
  const status = document.getElementById('status');

  composeBtn?.addEventListener('click', async () => {
    try {
      if (status) status.textContent = 'Opening composer…';
      await sdk.actions.composeCast({ text: DEFAULT_CAST });
      if (status) status.textContent = 'Composer opened';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (status) status.textContent = `Composer unavailable: ${message}`;
    }
  });

  closeBtn?.addEventListener('click', async () => {
    try {
      if (status) status.textContent = 'Closing mini app…';
      await sdk.actions.close();
    } catch (err) {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = 'https://farcaster.xyz/';
      }
    }
  });
}

async function initMiniApp() {
  renderApp();

  try {
    // Use Farcaster's native back button and close the mini app instead of
    // falling back to the previous browser history entry.
    sdk.back.onback = async () => {
      try {
        await sdk.actions.close();
      } catch (err) {
        if (window.history.length > 1) window.history.back();
      }
    };
    await sdk.back.show();
  } catch (err) {
    console.warn('Farcaster back handling unavailable outside Mini App:', err);
  }

  try {
    await sdk.actions.ready();
    console.log('CastPoster ready');
  } catch (err) {
    console.warn('ready() failed outside Farcaster Mini App:', err);
  }
}

initMiniApp();
