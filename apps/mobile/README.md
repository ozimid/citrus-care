# Citrus Care — Mobile (Expo)

Native mobile app per locked decision **D-11** (Obsidian: Architecture § Locked decisions) and the design doc **Design - Citrus Care Native App**. Implemented so far: **Google sign-in + authenticated Plants list** (Welcome screen → Plants tab with health rings, pull-to-refresh, Profile tab with sign-out). Backend is the same Supabase project + `/api/assess` pipeline as `apps/web` — same account, same plants.

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
```

Until Supabase + at least one Google client ID are set, the Welcome screen renders with the button disabled and a "not configured" hint.

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

Tests target **pure logic modules only** (`src/lib/*.test.ts`): auth session reducer + id_token extraction, plants row mapping/sub-labels/latest-score, health-band thresholds, config resolution. vitest was chosen over jest-expo because these modules import no react-native/expo code, the rest of the monorepo already uses vitest, and it needs zero Babel/transform config. Anything importing react-native stays thin and is exercised by `expo export` bundling instead. Health-band thresholds intentionally mirror `apps/web/app/_lib/health-style.ts` (<40 Poor, <70 Fair, ≥70 Good) — web/mobile parity.

## Structure

- `App.tsx` — session restore + conditional render (Welcome ⇄ tabs); no nav library yet on purpose
- `src/lib/` — `supabase.ts` (AsyncStorage-persisted client), `auth.ts` (Google → `signInWithIdToken`), `auth-state.ts` (reducer), `plants.ts` (query + mapping), `health.ts` (bands), `config.ts`/`app-config.ts` (env/extra resolution), `theme.ts` (design-doc §5 tokens)
- `src/screens/` — `WelcomeScreen`, `PlantsScreen`, `ProfileScreen`
- `src/components/TabBar.tsx` — Plants · camera FAB (disabled, "Soon") · Profile per design §3

## Next implementation steps (from the design doc)

1. ~~Google sign-in~~ ✅  2. ~~Plants tab~~ ✅
3. New-plant sheet (mobile currently points users to the web app to add plants)
4. Camera capture (`expo-camera`) with the three-mode guide: Leaf close-up (default) / Whole plant / Pruning cut
5. `/api/assess` call + diagnosis result screen
6. Push re-assessment reminders (`expo-notifications`)
