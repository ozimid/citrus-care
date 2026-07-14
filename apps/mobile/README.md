# Citrus Care — Mobile (Expo)

Native mobile app per locked decision **D-11** (Obsidian: Architecture § Locked decisions) and the design doc **Design - Citrus Care Native App**. Currently a scaffold: Welcome screen only. Backend is the same Supabase project + `/api/assess` pipeline as `apps/web`.

## Deliberately NOT an npm workspace

This package is excluded from the root `workspaces` so React Native's pinned `react` version can never collide with the web app's React in hoisted `node_modules`. Install and run it standalone:

```bash
cd apps/mobile
npm install
npx expo install --fix   # aligns native deps with the installed Expo SDK
npx expo start           # QR code -> Expo Go on your phone
```

Shared types/schemas come from `packages/shared` via the `@citrus/shared` tsconfig path alias (source-level import, no build step).

## Next implementation steps (from the design doc)

1. Google sign-in: `expo-auth-session` → Supabase `signInWithIdToken` (add native client ID in Google Cloud Console)
2. Plants tab (list from Supabase, RLS does the filtering)
3. Camera capture (`expo-camera`) with the three-mode guide: Leaf close-up (default) / Whole plant / Pruning cut
4. `/api/assess` call + diagnosis result screen
5. Push re-assessment reminders (`expo-notifications`)
