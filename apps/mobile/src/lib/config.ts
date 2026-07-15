// Thin expo-constants wiring around the pure resolver in app-config.ts.
// Precedence: EXPO_PUBLIC_* env vars (apps/mobile/.env, gitignored) beat the
// committed app.json `expo.extra` placeholders. Metro inlines EXPO_PUBLIC_*
// only for static member access, hence the explicit object below.

import Constants from "expo-constants";
import { resolveAppConfig, type AppConfig } from "./app-config";

const env = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
};

export const appConfig: AppConfig = resolveAppConfig(
  Constants.expoConfig?.extra ?? undefined,
  env,
);
