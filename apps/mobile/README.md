# Citrus Care — Mobile (Expo)

**This app is the product.** Photo-driven plant care that runs entirely on the phone: no accounts, no
server, no API keys, and nothing ever leaves the device except the one-time model download and anonymous
weather lookups (locked decision **D-17**).

## What it does

- **Assess** — snap a leaf, a whole plant or a pruning cut; Gemma 4 E2B runs on the phone and returns a
  structured diagnosis (health score, symptoms, causes, ranked actions). A re-assessment shows
  better/same/worse, computed deterministically from the scores.
- **Ask about this plant (F38)** — a per-plant chat grounded in that plant's own stored record: its care
  profile, its last assessment, its watering dates, its species pruning rules.
- **Where to prune (F23)** — photograph the plant and the model marks the regions to cut, over a
  deterministic season verdict and a species rule pack sourced from extension services
  (`docs/research/pruning-rules.md`). The rules are correct whether or not the model marks anything.
- **Watering** — weather-aware next-water dates from an on-device care profile plus anonymous Open-Meteo.
- **Timeline, before/after slider, reminders, backup** — all local.

Design contract for the two AI tools: `docs/design/plant-tools.md`.

## Setup

```bash
cd apps/mobile
npm install               # NOT an npm workspace — install it standalone
npx expo start            # dev server
```

**There is no configuration.** No `.env`, no keys, no Supabase, no OAuth client IDs — all of that was
deleted with the backend in D-17. If you find a doc telling you to set `EXPO_PUBLIC_*` variables, it is
older than the pivot.

The on-device model is downloaded **in the app**, once, over Wi-Fi: Profile → On-device AI (~1.3 GB).
Until it is installed, assessments, chat and pruning show an honest "not ready" state with a setup card;
everything else works.

### Deliberately not an npm workspace

Excluded from the root `workspaces` so React Native's pinned `react` can never collide with the web app's
React in hoisted `node_modules`. Shared types come from `packages/shared` via the `@citrus/shared` alias —
`tsconfig.json` paths for the compiler, `metro.config.js` for the bundler. Note `app.json` sets
`experiments.onDemandFilesystem: false`: Expo's on-demand filesystem breaks `expo export` for files
outside the project root, which `packages/shared` is.

## Commands

```bash
npm test                  # vitest (pure logic), run mode
npm run typecheck         # tsc --noEmit
npx expo start            # dev server / dev build
npx expo export --platform android   # metro production bundle — proves the app builds
```

### Building an APK locally

EAS cloud builds are optional; the local path needs no quota and takes ~8 minutes:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME=~/Library/Android/sdk \
npx eas-cli build --local --profile preview --platform android --output ./build-local.apk
```

## Architecture: the pure / `-io` split

Every module that touches AsyncStorage, the filesystem or an expo API is split in two:

- `src/lib/<name>.ts` — **pure**. All the logic. Imports no react-native and no expo, so plain vitest can
  test it with zero transform config. Reads degrade to empty/default; they never throw.
- `src/lib/<name>-io.ts` — **thin wiring**. Untested by policy, exercised by `expo export` and on device.

`src/lib/arch-guard.test.ts` enforces this by scanning the source tree, along with two other rules: no
backend/auth/cloud-AI imports anywhere, and every on-device flow must run under the shared inference
budget (`inference-budget.ts` — 25 s slow hint, 120 s interrupt ceiling).

The single model session runs **one request at a time** (FIFO mutex in `LocalEngineProvider`), so a
diagnosis, a care profile, a chat answer and a pruning run can never overlap.

## Testing

vitest, not jest-expo — the pure modules import no native code, the rest of the monorepo already uses
vitest, and it needs no Babel config. **Screens and `-io` files are not unit-tested by policy**; when
branching logic in a screen turns out to matter, it gets extracted into a pure module and tested there.

The full inventory, and the device V&V checklist that automated tests cannot replace, live in the
Obsidian **Test Plan** doc.
