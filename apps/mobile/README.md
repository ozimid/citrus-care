# Citrus Care — Mobile (Expo)

Native mobile app per locked decision **D-11** (Obsidian: Architecture § Locked decisions) and the design doc **Design - Citrus Care Native App**; since **D-16** the app IS the product. Implemented so far: **Google sign-in + authenticated Plants list** (Welcome screen → Plants tab with health rings, pull-to-refresh, Profile tab with sign-out), the **new-plant sheet** (shared `newPlantSchema`), **camera capture** (FAB → full-screen `expo-camera` viewfinder with the three-mode guide Leaf/Whole plant/Cut, gallery import, plant selector, downscale to 1600px JPEG q0.85, review screen), the **local-first assess pipeline** (save the JPEG on the phone → POST `/assess` with the base64 image → diagnosis screen with score ring, symptom chips, causes, ranked care plan; Plants list refreshes with the new score), **plant detail** (timeline with local thumbnails, before/after slider, quarantine alerts, edit/delete), and **re-assessment reminders** (local notifications; listed/cancellable on Profile). Photos live ONLY on this phone (`photos/{plantId}/…` in app documents + an AsyncStorage index); the server stores structured diagnoses, never images.

## Deliberately NOT an npm workspace

This package is excluded from the root `workspaces` so React Native's pinned `react` version can never collide with the web app's React in hoisted `node_modules`. Install and run it standalone:

```bash
cd apps/mobile
npm install
npx expo start           # QR code -> Expo Go on your phone (see sign-in caveat below)
```

Shared types/schemas come from `packages/shared` via the `@citrus/shared` alias — `tsconfig.json` paths for the compiler, `metro.config.js` for the bundler (plus the monorepo-root `node_modules` for `zod`). Note `app.json` sets `experiments.onDemandFilesystem: false`: Expo's on-demand filesystem breaks `expo export` for files outside the project root, which `packages/shared` is.

## Configuration (required once)

The app reads config from **`.env` (gitignored, preferred)** or `app.json > expo.extra` (committed — placeholders only, never put the real anon key there). Env vars win over `extra`; `YOUR_*` values are treated as unset. Create `apps/mobile/.env`:

```bash
EXPO_PUBLIC_SUPABASE_URL=...            # = NEXT_PUBLIC_SUPABASE_URL in apps/web/.env.local
EXPO_PUBLIC_SUPABASE_ANON_KEY=...       # = NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/web/.env.local
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...    # existing web OAuth client (apps/web/app/_lib/google-auth-config.ts)
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...    # created below
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...# created below
EXPO_PUBLIC_API_ORIGIN=...              # optional — see "API origin" below
```

Until Supabase + at least one Google client ID are set, the Welcome screen renders with the button disabled and a "not configured" hint.

### API origin (assess pipeline)

The assess flow talks to the standalone Hono service (`apps/api`, dev port 3003) with `Authorization: Bearer <supabase access token>`. The phone can't reach `localhost` on your dev machine, so the base URL defaults to **`http://192.168.1.205:3002/api`** — the web dev server's `/api/assess` rewrite (see `DEFAULT_API_ORIGIN` in `src/lib/api.ts`). If your machine has a different LAN IP — or you're pointing at a deployed API — set `EXPO_PUBLIC_API_ORIGIN` in `.env` (or `extra.apiOrigin` in `app.json`; env wins, `YOUR_*` placeholders are ignored, trailing slash stripped):

```bash
EXPO_PUBLIC_API_ORIGIN=http://<your-lan-ip>:3003   # `npm run dev` at the repo root starts the api on 3003
```

Note for Android dev builds: the default origin is plain `http`, which Android permits in debug builds only; production builds should point at an `https` origin.

## Google Cloud Console setup (the one manual step)

Google sign-in uses `expo-auth-session` → Supabase `signInWithIdToken`. Native Google OAuth needs **platform-specific client IDs** in the same Google Cloud project that already holds the web client (project `203990346092`, the one referenced in `apps/web/app/_lib/google-auth-config.ts`).

In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials):

1. **iOS client** — Create credentials → OAuth client ID → *iOS*.
   - Bundle ID: `com.citruscare.app` (must match `app.json > expo.ios.bundleIdentifier`).
   - No redirect URI to enter — Google derives it; the app redirects to `com.citruscare.app:/oauthredirect`.
   - Copy the client ID into `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
2. **Android client** — Create credentials → OAuth client ID → *Android*.
   - Package name: `com.citruscare.app` (matches `app.json > expo.android.package`).
   - SHA-1 fingerprint: for a local debug build, `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`; for EAS builds, `npx eas credentials -p android` shows the keystore SHA-1.
   - Copy the client ID into `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`.
3. **Web client** — reuse the existing one (no new client): the ID in `apps/web/app/_lib/google-auth-config.ts` → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
4. **Supabase Dashboard** → Authentication → Providers → Google → add the new **iOS and Android client IDs** to the *Authorized Client IDs / Client IDs* list (comma-separated, alongside the web client ID). Without this, `signInWithIdToken` rejects the token's audience.

**Expo Go cannot complete Google sign-in** — inside Expo Go the application ID is `host.exp.exponent`, which matches none of your Google clients. Use a development build instead:

```bash
npx expo run:ios       # or: npx expo run:android
# or a cloud dev build: npx eas build --profile development
```

Expo Go still works for everything up to the sign-in tap (Welcome screen, theming).

## Commands

```bash
npm test               # vitest (logic tests, run mode)
npm run typecheck      # tsc --noEmit
npx expo start         # dev server / Expo Go
npx expo export        # metro production bundle (proves the app builds)
```

## Testing (vitest, not jest-expo — why)

Tests target **pure logic modules only** (`src/lib/*.test.ts`): auth session reducer + id_token extraction, plants row mapping/sub-labels/latest-score, health-band thresholds, config resolution, new-plant validation/insert-row building, photo downscale math (1600px/q0.85), the local photo store index (mapping/upsert/remove — `photo-store.test.ts`), capture-mode definitions + plant preselection, API origin resolution + Bearer fetch (`api.test.ts`), the local-first assess flow + generic error strings (`assess.test.ts`), timeline mapping + local-photo joins (`plant-detail.test.ts`), plant mutations (`plant-mutations.test.ts`), and reminder scheduling/permission logic (`reminders.test.ts`). vitest was chosen over jest-expo because these modules import no react-native/expo code, the rest of the monorepo already uses vitest, and it needs zero Babel/transform config. Anything importing react-native stays thin (`*-io.ts`, screens) and is exercised by `expo export` bundling instead. Health-band thresholds intentionally mirror `apps/web/app/_lib/health-style.ts` (<40 Poor, <70 Fair, ≥70 Good) — web/mobile parity.

## Structure

- `App.tsx` — session restore + conditional render (Welcome ⇄ tabs, capture as a full-screen Modal); no nav library yet on purpose
- `src/lib/` — `supabase.ts` (AsyncStorage-persisted client), `auth.ts` (Google → `signInWithIdToken`), `auth-state.ts` (reducer), `plants.ts` (query + mapping), `new-plant.ts` (form validation → insert payload, shared `newPlantSchema` + 5-digit ZIP rule), `photo.ts` (downscale math mirroring web image-utils) / `photo-io.ts` (thin `expo-image-manipulator` wrapper), `capture-modes.ts` (Leaf/Whole plant/Cut definitions + plant preselection), `health.ts` (bands), `api.ts` (origin resolution + Bearer fetch) / `api-io.ts` (expo-constants + Supabase wiring), `assess.ts` (local save → direct-image `/assess` → Zod-parsed diagnosis, generic error strings, engine seam for D-15), `photo-store.ts` (on-phone photo index, pure) / `photo-store-io.ts` (expo-file-system + AsyncStorage wiring), `reminders.ts` (schedule/cancel/list logic) / `reminders-io.ts` (thin `expo-notifications` wrapper), `config.ts`/`app-config.ts` (env/extra resolution), `theme.ts` (design-doc §5 tokens)
- `src/screens/` — `WelcomeScreen`, `PlantsScreen`, `ProfileScreen` (account, reminders, sign-out), `CaptureScreen` (camera + permission flow), `ReviewScreen` (post-capture → Analyze with progress states), `DiagnosisScreen` (score ring, symptoms, causes, care plan, remind-me CTA)
- `src/components/` — `TabBar.tsx` (Plants · Assess FAB · Profile per design §3), `NewPlantSheet.tsx`, `CaptureOverlay.tsx` (mode pill + guide shapes + hint), `PlantPickerSheet.tsx`

## Re-assessment reminders (local-only, by design)

"🔔 Remind me in 2 weeks" on the diagnosis screen schedules a **local** `expo-notifications` notification (design doc §9 open question 6 resolved pragmatically: local first, server-driven push later). Notification permission is requested at that tap — contextual opt-in, never at launch. Scheduled reminders are listed and cancellable on the Profile tab. Known limitations of local scheduling: **deleting (or on iOS, offloading) the app silently loses all reminders**, they don't sync across devices, and they fire in the device's local timezone as scheduled — a future server-push upgrade (EAS + a scheduler table) would fix all three. Capture modes leaf/whole-plant remain client-side framing guidance only; the server's `/assess` accepts just `isCutCare` (Cut mode), so no unsupported fields are sent.

## Testing on a phone (never done mobile testing?)

Full from-zero walkthrough (Expo Go preview → credentials → installable EAS dev build → feature checklist) lives in Obsidian: `Project RESOURCES/Citrus Care v1/Testing - Android for Web Developers.md`.

## Next implementation steps (from the design doc)

1. ~~Google sign-in~~ ✅  2. ~~Plants tab~~ ✅  3. ~~New-plant sheet~~ ✅
4. ~~Camera capture (`expo-camera`) with the three-mode guide: Leaf close-up (default) / Whole plant / Pruning cut~~ ✅
5. ~~`/api/assess` call + diagnosis result screen~~ ✅
6. ~~Re-assessment reminders (`expo-notifications`, local — see the reminders section above)~~ ✅

All design-doc implementation steps are done, including the §8 parity items (plant detail/edit/delete, timeline with deltas, before/after slider, quarantine alerts). Next feature: the on-device engine spike (D-15) behind the `engine` seam in `assess.ts`.
