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

### Website tutorial video

The one-minute Android recording is self-hosted at `/media/citrus-care-tutorial-v1.mp4`, bundled in the existing Fly.io image through `apps/web/public`. `TutorialVideo.tsx` uses native playback controls and does not attach the video source until Play. The download link works without JavaScript. No external video player, analytics, upload endpoint, or additional hosting service is involved; normal Fly compute/bandwidth charges still apply.

Only the optimized 9.4 MB copy is committed, not the 74.2 MB Desktop original. Encoding preserves 1080×2392/30fps: H.264 (`libx264`, CRF 24, slow preset, `yuv420p`, keyframe interval 60), AAC 96 kbps, `-map_metadata -1`, and `-movflags +faststart`. The WebP poster is a frame from the recording; the VTT contains authored on-screen instructions, **not a narration transcript**. The recording’s audio is retained.

To replace it, review the new recording for private information and audio rights, optimize a separate copy, and use a **new versioned filename** for all changed media. Update the player paths and exact immutable-cache allowlist in `next.config.ts`, then deploy normally. Do not overwrite v1: browsers cache these files for a year. The service worker intentionally excludes `/media/`, including direct navigation and byte-range requests, to avoid filling offline storage or interfering with seeking. Do not create a video-only GitHub release: the latest-release download URL must keep pointing to the Android APK.

Known host limitation: Next 16.2.9's production static-file handler reports an unsatisfiable byte range as HTTP 500 with the correct `Content-Range: bytes */size`, rather than development's 416. This also occurs on the pre-existing live manifest, independently of the tutorial. Valid initial, middle, and suffix ranges return 206 and native seeking works; no custom streaming endpoint or framework upgrade was added for this unrelated error-status behavior.

## Device requirements

A recent Android phone with ~2 GB free storage. First run downloads the on-device AI model (~1.3 GB) over Wi-Fi; phones that can't run it get an honest error instead of a broken experience.

## License

Source-available for transparency: the code is public so the privacy claims are verifiable. All rights reserved for now — a permissive license may come later if the project opens to contributions.

## Known gotchas

- If `npm run build` fails with `Cannot read properties of null (reading 'useContext')` on `/_global-error`, your shell has `NODE_ENV=development` exported. The build script already unsets it; if you invoke `next build` directly, do `unset NODE_ENV` first. ([Next.js issue #87719](https://github.com/vercel/next.js/issues/87719))
