# Citrus Care

[![CI](https://github.com/ozimid/citrus-care/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ozimid/citrus-care/actions/workflows/ci.yml)

**Photo-driven plant care that runs entirely on your phone.** Snap a leaf, a whole plant, or a pruning cut in the Android app; an AI model running **on the device** returns a structured diagnosis (health score, symptoms, likely causes, ranked care steps); every plant gets a timeline, and re-assessment shows better / same / worse. Weather-aware watering guidance included.

**Website + APK:** [citruscare.net](https://citruscare.net)

## The privacy claim — verify it yourself

This app has **no accounts, no server, no analytics, and no cloud AI**. Your photos, plants, and history never leave the phone. That's not a policy — it's the architecture, and this repo is public so you can check:

- The only AI is an on-device model via [`react-native-executorch`](https://github.com/software-mansion/react-native-executorch) (see `apps/mobile/src/components/LocalEngineSession.tsx`). There is no API key in this codebase because there is nothing to call.
- The only network requests the app makes: the one-time model download (~1.3 GB, from the library's public model registry) and — if you give a plant a ZIP code — an anonymous [Open-Meteo](https://open-meteo.com/) weather lookup (`apps/mobile/src/lib/weather-io.ts`).
- All data lives in on-device storage (`apps/mobile/src/lib/*-store*.ts`); backup is a manual JSON export you keep yourself (`apps/mobile/src/lib/backup.ts`).
- An architecture test (`apps/mobile/src/lib/arch-guard.test.ts`) fails CI if anyone adds a backend, auth, or cloud-AI dependency.

## Repo structure

```
apps/mobile/       THE product: Expo/React Native Android app — fully local.
                   Standalone install, NOT an npm workspace (React version isolation)
apps/web/          Static marketing landing (Next.js) — citruscare.net
packages/shared/   Types + Zod schemas shared by mobile and web tests
supabase/          Frozen history from an earlier architecture — unused, kept as record
```

## Build & run

There are **no environment variables and no secrets** — clone and go.

```bash
# Web landing
npm install
npm run dev          # http://localhost:3002
npm test             # Vitest
npm run e2e          # Playwright (once: npx playwright install chromium)
npm run typecheck

# Mobile app (standalone — its own install)
cd apps/mobile
npm install
npx vitest run       # unit tests (pure modules)
npx tsc --noEmit
npx expo start       # dev server (on-device AI needs a dev/EAS build, not Expo Go)
```

Android builds are made with [EAS](https://docs.expo.dev/build/introduction/): `eas build --profile preview --platform android`. Released APKs are attached to [GitHub Releases](https://github.com/ozimid/citrus-care/releases).

## Device requirements

A recent Android phone with ~2 GB free storage. First run downloads the on-device AI model (~1.3 GB) over Wi-Fi; phones that can't run it get an honest error instead of a broken experience.

## License

Source-available for transparency: the code is public so the privacy claims are verifiable. All rights reserved for now — a permissive license may come later if the project opens to contributions.

## Known gotchas

- If `npm run build` fails with `Cannot read properties of null (reading 'useContext')` on `/_global-error`, your shell has `NODE_ENV=development` exported. The build script already unsets it; if you invoke `next build` directly, do `unset NODE_ENV` first. ([Next.js issue #87719](https://github.com/vercel/next.js/issues/87719))
