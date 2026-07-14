# Citrus Care

[![CI](https://github.com/ozimid/citrus-care/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ozimid/citrus-care/actions/workflows/ci.yml)

Photo-driven plant care. Snap a leaf, get a structured AI diagnosis from Gemini 2.5 Flash, track each plant over time, see better/same/worse on re-assessment.

## Repo structure (strictly separated)

```
apps/web/          Frontend + its backend-for-frontend (Next.js 16 App Router:
                   pages/components AND the API route handlers + server actions —
                   colocated because that is how Next.js works; app/_lib and
                   app/api are the backend surface)
apps/mobile/       Native mobile app (Expo/React Native, decision D-11) —
                   standalone install, NOT an npm workspace (React version isolation)
packages/shared/   Types + Zod schemas consumed by web and mobile
supabase/          Database: migrations, RLS policies, storage bucket config
```

Root `package.json` is an npm workspace (`apps/web`, `packages/*`); root scripts proxy to the web app (`npm run dev`, `npm test`, …). Deploy: root `Dockerfile` + `fly.toml` build `apps/web`.

## Product docs (Obsidian)

Source of truth for everything product-level (PRD, architecture decisions, feature specs, competitive landscape, test plan, security log):

`~/Documents/Obsidian Vault/Alex/ARPA/6. FINANCIALS/2. FINANCIALS PROJECTS/3. IN PROGRESS WIP - 1/Citrus Care/`

Start with `Citrus Care PRD v1.md`. This repo only contains code + code-adjacent docs (`SHIP.md`, `supabase/README.md`).

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Supabase**
   - Create a free project at supabase.com.
   - In SQL editor, run every file in `supabase/migrations/` in order (0001 → 0002 → 0003).
   - Storage bucket `photos` is created by migration 0002.
   - **Google sign-in:** Dashboard → **Authentication** → **Providers** → **Google** → Enable. Paste Client ID + Client Secret from [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (OAuth 2.0 Web client). Authorized redirect URI in Google must be `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` (shown in the Supabase Google provider panel).
   - For email signup CAPTCHA: Dashboard → **Auth** → **Settings** → **Bot/Abuse Protection** → Turnstile → paste Cloudflare Turnstile **secret** key.
   - **URL Configuration:** Site URL `http://localhost:3002`, Redirect URLs `http://localhost:3002/**` (and your production URL when deployed).

3. **Cloudflare Turnstile** (free)
   - Create a Turnstile site at `cloudflare.com/products/turnstile`.
   - Copy the **site** key into `.env.local` as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
   - Copy the **secret** key into Supabase as above (it never touches this app).

4. **Environment** (`.env.local`)
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
   GEMINI_API_KEY=YOUR_GEMINI_API_KEY
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=YOUR_TURNSTILE_SITE_KEY
   ```

5. **Run**
   ```bash
   npm run dev               # http://localhost:3002
   npm test                  # Vitest unit
   npx playwright test       # E2e (run once: npx playwright install chromium)
   npx tsc --noEmit          # Typecheck
   ```

## PWA

Installable. Manifest at `/manifest.json`, service worker at `/sw.js` (registered only in production). Icon is a scalable SVG at `/icon.svg`. Before public launch, replace with 192/512 PNG icons (Real Favicon Generator) and update `public/manifest.json`.

## Deploy

Vercel — connect repo, paste the five env vars above, deploy. See `SHIP.md` for the full pre-flight + post-deploy checklist.

## CI

`.github/workflows/ci.yml` runs typecheck + lint + vitest on every push to `main` and every PR.

## Known gotchas

- If `npm run build` fails with `Cannot read properties of null (reading 'useContext')` on `/_global-error`, your shell has `NODE_ENV=development` exported. The build script already unsets it; if you invoke `next build` directly, do `unset NODE_ENV` first. ([Next.js issue #87719](https://github.com/vercel/next.js/issues/87719))
- `proxy.ts` (Next.js 16) replaced `middleware.ts`. The exported function is `proxy`, not `middleware`.
