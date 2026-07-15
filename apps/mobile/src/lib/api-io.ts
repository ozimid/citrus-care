// Thin wiring for api.ts (same pure/thin split as photo.ts vs photo-io.ts):
// resolves the API origin from expo-constants + EXPO_PUBLIC_API_ORIGIN and
// builds the Bearer-authenticated fetch from the live Supabase session.
// Untested by design — exercised via `expo export` bundling (README policy).

import Constants from "expo-constants";
import { createAuthorizedFetch, resolveApiOrigin, type AuthorizedFetch } from "./api";
import { supabase } from "./supabase";

export const apiOrigin = resolveApiOrigin(Constants.expoConfig?.extra ?? undefined, {
  // Metro inlines EXPO_PUBLIC_* only for static member access (see config.ts).
  EXPO_PUBLIC_API_ORIGIN: process.env.EXPO_PUBLIC_API_ORIGIN,
});

export const apiFetch: AuthorizedFetch = createAuthorizedFetch({
  origin: apiOrigin,
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  fetchFn: (url, init) => fetch(url, init as RequestInit),
});
