import { SDK } from '@farcaster/sdk';

async function main() {
  // Initialize SDK
  const sdk = new SDK({
    domain: window.location.hostname,
    secure: window.location.protocol === 'https:'
  });

  try {
    // CRITICAL: Call ready() to hide splash screen
    await sdk.actions.ready();
    console.log('CastPoster ready');

    // Setup UI
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
        <div style="padding: 20px; font-family: system-ui;">
          <h1>🎯 CastPoster</h1>
          <p>Ready to post! Open the composer to share your thoughts.</p>
          <button id="composeBtn" style="padding: 12px 24px; font-size: 16px; cursor: pointer;">
            ✍️ Compose Cast
          </button>
          <div id="status" style="margin-top: 20px; color: #666;"></div>
        </div>
      `;

      const composeBtn = document.getElementById('composeBtn');
      const status = document.getElementById('status');

      if (composeBtn) {
        composeBtn.addEventListener('click', async () => {
          try {
            status.textContent = 'Opening composer...';
            await sdk.actions.composeCast({
              text: 'Hello from CastPoster Mini App! 🚀'
            });
            status.textContent = 'Cast composed!';
          } catch (err) {
            status.textContent = `Error: ${err.message}`;
          }
        });
      }
    }
  } catch (error) {
    console.error('SDK Error:', error);
    document.getElementById('app').innerHTML = `
      <div style="padding: 20px; color: red;">
        <h1>Error</h1>
        <p>${error.message}</p>
      </div>
    `;
  }
}

main();
