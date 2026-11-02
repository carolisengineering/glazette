# Glazette

Glazette is a photo-first pottery journal for studio potters. It runs entirely on your device: pieces, photos, glazes and firings are stored locally in the browser, there is no server or account, and offline PWA support is planned. It is built with React, Vite and TypeScript, and deployed as static assets on Cloudflare Workers.

## Run

```sh
pnpm install
pnpm dev
```

## Test

```sh
pnpm test        # unit tests (Vitest)
pnpm lint        # Biome
pnpm typecheck   # tsc -b
```

Playwright end-to-end tests arrive in a later PR.

## Build

```sh
pnpm build       # outputs to dist/
```

## Deploy

Pushes to `main` deploy automatically through GitHub Actions after the checks pass. Add these two secrets in the repository settings (Settings, Secrets and variables, Actions):

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

For a manual deploy, run `pnpm exec wrangler login` once, then `pnpm run deploy`.
