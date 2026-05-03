# CastPoster 🎯

A Farcaster Mini App for composing and posting casts.

## Features

- ✍️ Compose casts directly from the Mini App
- 🔄 Farcaster SDK integration
- 📱 Mobile-optimized UI
- ⚡ Vite-powered development

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Domain & Manifest

1. Update `public/.well-known/farcaster.json` with your domain
2. Sign the manifest at: https://farcaster.xyz/~/developers/mini-apps/manifest?domain=YOUR_DOMAIN
3. Replace `payload` and `signature` in the manifest

### 3. Run Development Server

```bash
npm run dev
```

### 4. Deploy

```bash
npm run build
# Deploy the `dist/` folder to your HTTPS domain
```

## Project Structure

```
CastPoster/
├── src/
│   └── main.ts          # SDK initialization and app logic
├── public/
│   ├── .well-known/
│   │   └── farcaster.json  # Mini App manifest (MUST be signed)
│   └── icon.png         # App icon
├── index.html           # Entry point with Mini App meta tags
├── package.json        # Dependencies
├── tsconfig.json       # TypeScript config
└── vite.config.ts      # Vite configuration
```

## Critical Requirements

- **HTTPS required** — Mini Apps only work on secure origins
- **SDK ready() called** — prevents infinite splash screen
- **Manifest accessible** — at `https://YOUR_DOMAIN/.well-known/farcaster.json`
- **Valid signature** — unsigned manifests are rejected

## Security Notes

⚠️ **Never commit unverified manifest signatures.** The `farcaster.json` must be signed via the Farcaster developer tools before deployment.

---

Built with @farcaster/sdk
