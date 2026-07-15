# Citrus Care

[![CI](https://github.com/ozimid/citrus-care/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ozimid/citrus-care/actions/workflows/ci.yml)

Photo-driven plant care, native-app-first (decision D-16). Snap a leaf in the Android app, get a structured AI diagnosis from Gemini 2.5 Flash, track each plant over time, see better/same/worse on re-assessment. Photos live only on the phone; Supabase stores auth, plants, and structured diagnoses. The web app is a static marketing landing.

## Repo structure (strictly separated)

```
apps/web/          Static marketing landing (Next.js 16 App Router) + the
                   /api/assess rewrite to apps/api (dev convenience: the phone
                   reaches the API through the web dev server's port)
apps/api/          Standalone Hono API service: the AI pipeline (/assess).
                   The escalation request carries the JPEG base64 in the body —
                   no photo storage anywhere server-side
apps/mobile/       THE product: native app (Expo/React Native, decision D-11) —
                   standalone install, NOT an npm workspace (React version isolation)
packages/shared/   Types + Zod schemas consumed by mobile (and web tests)
supabase/          Database: migrations + RLS (auth, plants, assessments)
```

Root `package.json` is an npm workspace (`apps/web`, `apps/api`, `packages/*`); root scripts proxy to the web app (`npm run dev`, `npm test`, …). Deploy: root `Dockerfile` + `fly.toml` build `apps/web`.

## Product docs (Obsidian)

Source of truth for everything product-level (PRD, architecture decisions, feature specs, competitive landscape, test plan, security log):

`~/Documents/Obsidian Vault/Alex/ARPA/6. FINANCIALS/2. FINANCIALS PROJECTS/3. IN PROGRESS WIP - 1/Citrus Care/`

Start with `Citrus Care PRD v1.md`. This repo only contains code + code-adjacent docs (`SHIP.md`, `supabase/README.md`).

## Setup

1. **Install**
   ```bash
   npm install
   cd apps/mobile && npm install   # mobile is standalone, not a workspace
   ```

2. **Supabase**
   - Create a free project at supabase.com.
   - In SQL editor, run every file in `supabase/migrations/` in order (0001 → 0005).
   - **Google sign-in:** Dashboard → **Authentication** → **Providers** → **Google** → Enable. The mobile app signs in with the native Google SDK; paste Client ID + Client Secret from [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

3. **Environment** (`apps/web/.env.local` — read by apps/api in dev as a fallback)
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   GEMINI_API_KEY=YOUR_GEMINI_API_KEY
   ```

4. **Run**
   ```bash
   npm run dev               # web (landing) http://localhost:3002 + api :3003
   npm test                  # Vitest unit (web + api)
   npm run e2e               # Playwright (run once: npx playwright install chromium)
   npm run typecheck         # tsc --noEmit
   cd apps/mobile && npm test && npx expo start   # the app itself
   ```

## Photos are local-first (D-16)

The phone saves every downscaled JPEG under the app's documents directory (`photos/{plantId}/…`) and keeps an AsyncStorage index mapping assessment ids to local uris. A photo travels the network exactly once — inside the `/assess` request body when escalating to Gemini — and is never stored server-side (`assessments.photo_path` is null for new rows). Deleting a plant deletes its local photos.

## Deploy

Fly.io — root `Dockerfile` + `fly.toml` deploy the landing. See `SHIP.md` for the checklist.

## CI

`.github/workflows/ci.yml` runs typecheck + lint + vitest on every push to `main` and every PR.

## Known gotchas

- If `npm run build` fails with `Cannot read properties of null (reading 'useContext')` on `/_global-error`, your shell has `NODE_ENV=development` exported. The build script already unsets it; if you invoke `next build` directly, do `unset NODE_ENV` first. ([Next.js issue #87719](https://github.com/vercel/next.js/issues/87719))
