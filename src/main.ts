import { sdk } from '@farcaster/miniapp-sdk';
import { decodeFunctionResult, encodeFunctionData, keccak256, toBytes } from 'viem';
import {
  buildCastMintTokenUri,
  CastMintHistoryItem,
  CastMintPreviewStyle,
  createMintHistoryItem,
  extractCastAuthorFromUrl,
  findCastInApiResponse,
  getCastHashFromUrl,
  isValidEvmAddress,
  normalizeCastUrl,
} from './castNft';

const PUBLIC_FARCASTER_API = 'https://api.warpcast.com/v2';
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
  castText: '',
  author: '',
  castUrl: '',
  minting: false,
  lastMintHash: '',
  previewStyle: 'neon' as CastMintPreviewStyle,
  detectedUser: '',
  isMiniApp: false,
  posterUrl: '',
  history: [] as CastMintHistoryItem[],
};

let castLookupRequest = 0;

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'success' ? '#00d084' : '#ff3b30'};
    color: ${type === 'success' ? '#000' : '#fff'};
    padding: 14px 20px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    z-index: 9999;
    animation: slideUp 0.3s ease;
    max-width: calc(100vw - 32px);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideDown 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function loadHistory(): CastMintHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory(item: CastMintHistoryItem) {
  try {
    const history = loadHistory();
    history.unshift(item);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
    state.history = history.slice(0, HISTORY_LIMIT);
    updateMintCount();
  } catch (e) {
    console.error('Failed to save history:', e);
  }
}

function updateMintCount() {
  const countEl = document.getElementById('mintCount');
  if (countEl) {
    countEl.textContent = state.history.length.toString();
  }
}

function updatePreview() {
  const placeholder = document.getElementById('previewPlaceholder');
  const castPreview = document.getElementById('previewCast');
  const castText = document.getElementById('castText');
  const castAuthorName = document.getElementById('castAuthorName');
  const castAuthorUsername = document.getElementById('castAuthorUsername');
  const previewStyle = document.getElementById('previewStyle');

  if (!state.castText || !state.author) {
    if (placeholder) placeholder.hidden = false;
    if (castPreview) castPreview.hidden = true;
    return;
  }

  if (placeholder) placeholder.hidden = true;
  if (castPreview) castPreview.hidden = false;
  if (castText) castText.textContent = state.castText;
  if (castAuthorName) castAuthorName.textContent = state.author;
  if (castAuthorUsername) castAuthorUsername.textContent = `@${state.author}`;
  if (previewStyle) {
    const styleName = state.previewStyle.charAt(0).toUpperCase() + state.previewStyle.slice(1);
    previewStyle.textContent = styleName;
  }
}

async function warpcastGet(path: string) {
  const response = await fetch(`${PUBLIC_FARCASTER_API}${path}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    mode: 'cors',
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Cast or username not found');
    }
    throw new Error(`Warpcast API error: ${response.status}`);
  }

  return response.json();
}

async function fetchCastData(castUrl: string) {
  const normalized = normalizeCastUrl(castUrl);
  const castHash = getCastHashFromUrl(normalized);
  const author = extractCastAuthorFromUrl(normalized);

  if (!castHash || !author) {
    throw new Error('Invalid cast URL format');
  }

  const requestId = ++castLookupRequest;
  
  try {
    const userData = await warpcastGet(`/user-by-username?username=${encodeURIComponent(author)}`);
    const fid = Number(userData?.result?.user?.fid);

    if (requestId !== castLookupRequest) {
      return null;
    }

    if (!Number.isInteger(fid) || fid <= 0) {
      throw new Error('Unable to resolve cast author');
    }

    const castPages: unknown[] = [];
    let cursor = '';

    for (let page = 0; page < 3; page += 1) {
      const path = `/casts?fid=${fid}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const data = await warpcastGet(path);
      castPages.push(data);

      if (requestId !== castLookupRequest) {
        return null;
      }

      const nextCursor = data?.next?.cursor || data?.result?.next?.cursor || '';
      if (!nextCursor) break;
      cursor = nextCursor;
    }

    const allCasts = castPages.flatMap((page) => {
      const typed = page as { result?: { casts?: unknown[] }; casts?: unknown[] };
      return typed.result?.casts || typed.casts || [];
    });
    const cast = findCastInApiResponse({ casts: allCasts }, castHash);

    if (!cast || !cast.text) {
      throw new Error('Cast not found in recent author casts');
    }

    return {
      text: cast.text,
      author: cast.author || author,
      hash: castHash,
    };
  } catch (error) {
    if (requestId !== castLookupRequest) {
      return null;
    }
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Network error - check your connection');
    }
    
    throw error;
  }
}

async function handleGenerate(e: Event) {
  e.preventDefault();

  const urlInput = document.getElementById('castUrl') as HTMLInputElement;
  const generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
  const mintBtn = document.getElementById('mintBtn') as HTMLButtonElement;
  const profileInfo = document.getElementById('profileInfo') as HTMLDivElement;

  const castUrl = urlInput.value.trim();

  if (!castUrl) {
    showToast('Please enter a cast URL', 'error');
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = 'Loading...';
  generateBtn.classList.add('loading');

  try {
    const castData = await fetchCastData(castUrl);

    if (!castData) {
      return;
    }

    state.castText = castData.text;
    state.author = castData.author;
    state.castUrl = castUrl;

    updatePreview();

    if (profileInfo) {
      profileInfo.textContent = `Ready to mint as @${state.author}`;
      profileInfo.hidden = false;
    }

    if (mintBtn) {
      mintBtn.hidden = false;
    }

    showToast('NFT preview generated!');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Failed to load cast', 'error');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate NFT';
    generateBtn.classList.remove('loading');
  }
}

async function handleMint() {
  const mintBtn = document.getElementById('mintBtn') as HTMLButtonElement;
  const successActions = document.getElementById('successActions') as HTMLDivElement;

  if (!state.castText || !state.author) {
    showToast('Please generate an NFT first', 'error');
    return;
  }

  mintBtn.disabled = true;
  mintBtn.textContent = 'Minting...';
  mintBtn.classList.add('loading');
  state.minting = true;

  try {
    const provider = await sdk.wallet.getEthereumProvider() as EthereumProvider;
    if (!provider) {
      throw new Error('Wallet provider unavailable');
    }

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_CHAIN_ID_HEX }],
    });

    const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
    const userAddress = accounts[0];

    if (!isValidEvmAddress(userAddress)) {
      throw new Error('Invalid wallet address');
    }

    if (!mintCompatibilityChecked) {
      try {
        const code = await provider.request({
          method: 'eth_getCode',
          params: [MINT_CONTRACT_ADDRESS, 'latest'],
        }) as string;

        if (!code || code === '0x' || code.length < 10) {
          mintCompatibilityWarning = 'Contract not deployed on Base';
        } else if (!code.toLowerCase().includes(EXPECTED_MINT_SELECTOR_IN_BYTECODE)) {
          mintCompatibilityWarning = 'Contract may not support mintTo function';
        }

        try {
          const priceData = encodeFunctionData({
            abi: MINT_PRICE_ABI,
            functionName: 'mintPrice',
            args: [],
          });

          const priceResult = await provider.request({
            method: 'eth_call',
            params: [{ to: MINT_CONTRACT_ADDRESS, data: priceData }, 'latest'],
          }) as string;

          const decoded = decodeFunctionResult({
            abi: MINT_PRICE_ABI,
            functionName: 'mintPrice',
            data: priceResult as `0x${string}`,
          });

          mintPriceWei = decoded;
        } catch {
          mintPriceWei = 0n;
        }

        mintCompatibilityChecked = true;
      } catch (e) {
        console.warn('Contract check failed:', e);
      }
    }

    if (mintCompatibilityWarning) {
      showToast(mintCompatibilityWarning, 'error');
      return;
    }

    const tokenUri = buildCastMintTokenUri({
      castText: state.castText,
      author: state.author,
      castUrl: state.castUrl,
    });

    const data = encodeFunctionData({
      abi: MINT_ABI,
      functionName: MINT_FUNCTION_NAME,
      args: [userAddress as `0x${string}`, tokenUri],
    });

    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: userAddress,
        to: MINT_CONTRACT_ADDRESS,
        data,
        value: `0x${mintPriceWei.toString(16)}`,
      }],
    }) as string;

    state.lastMintHash = txHash;

    const historyItem = createMintHistoryItem(
      {
        castText: state.castText,
        author: state.author,
        castUrl: state.castUrl,
        txHash,
        style: state.previewStyle,
      }
    );
    saveHistory(historyItem);

    showToast('NFT minted successfully! 🎉');

    if (mintBtn) mintBtn.hidden = true;
    if (successActions) successActions.hidden = false;

  } catch (error) {
    console.error('Mint error:', error);
    showToast(error instanceof Error ? error.message : 'Minting failed', 'error');
  } finally {
    state.minting = false;
    mintBtn.disabled = false;
    mintBtn.textContent = 'Mint on Base';
    mintBtn.classList.remove('loading');
  }
}

function handleStyleChange(e: Event) {
  const target = e.target as HTMLElement;
  const option = target.closest('.style-option') as HTMLElement;
  
  if (!option) return;

  const style = option.dataset.style as CastMintPreviewStyle;
  
  document.querySelectorAll('.style-option').forEach(el => el.classList.remove('active'));
  option.classList.add('active');
  
  state.previewStyle = style;
  updatePreview();
}

function handleShare() {
  if (!state.lastMintHash) {
    showToast('No mint to share', 'error');
    return;
  }

  const shareText = `Just minted a Farcaster cast as an NFT on Base! 🎨\n\nTx: https://basescan.org/tx/${state.lastMintHash}`;
  
  if (navigator.share) {
    navigator.share({ text: shareText }).catch(() => {});
  } else {
    navigator.clipboard.writeText(shareText).then(() => {
      showToast('Link copied to clipboard!');
    });
  }
}

function handleNew() {
  const urlInput = document.getElementById('castUrl') as HTMLInputElement;
  const mintBtn = document.getElementById('mintBtn') as HTMLButtonElement;
  const successActions = document.getElementById('successActions') as HTMLDivElement;
  const profileInfo = document.getElementById('profileInfo') as HTMLDivElement;
  const placeholder = document.getElementById('previewPlaceholder');
  const castPreview = document.getElementById('previewCast');

  urlInput.value = '';
  state.castText = '';
  state.author = '';
  state.castUrl = '';
  state.lastMintHash = '';

  if (mintBtn) mintBtn.hidden = true;
  if (successActions) successActions.hidden = true;
  if (profileInfo) profileInfo.hidden = true;
  if (placeholder) placeholder.hidden = false;
  if (castPreview) castPreview.hidden = true;

  urlInput.focus();
}

function handleClose() {
  if (state.isMiniApp) {
    sdk.actions.close();
  } else {
    window.history.back();
  }
}

async function init() {
  try {
    await sdk.actions.ready();
    state.isMiniApp = true;
    
    const context = await sdk.context;
    if (context?.user?.username) {
      state.detectedUser = context.user.username;
    }
  } catch (e) {
    console.log('Not in Farcaster Mini App context');
    state.isMiniApp = false;
  }

  state.history = loadHistory();
  updateMintCount();

  const form = document.getElementById('castForm');
  const mintBtn = document.getElementById('mintBtn');
  const shareBtn = document.getElementById('shareBtn');
  const newBtn = document.getElementById('newBtn');
  const closeBtn = document.getElementById('closeBtn');
  const stylePicker = document.querySelector('.style-picker');

  form?.addEventListener('submit', handleGenerate);
  mintBtn?.addEventListener('click', handleMint);
  shareBtn?.addEventListener('click', handleShare);
  newBtn?.addEventListener('click', handleNew);
  closeBtn?.addEventListener('click', handleClose);
  stylePicker?.addEventListener('click', handleStyleChange);
}

init();
