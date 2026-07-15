// Supabase client for React Native: AsyncStorage session persistence, no URL
// session detection (no OAuth redirects land in the app itself — Google
// sign-in exchanges an id_token instead, see auth.ts). Same project, schema,
// and RLS as apps/web.

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { appConfig } from "./config";

// Placeholder fallbacks keep createClient from throwing at import time on an
// unconfigured checkout; WelcomeScreen surfaces appConfig.missing instead.
export const supabase = createClient(
  appConfig.supabaseUrl || "https://unconfigured.supabase.co",
  appConfig.supabaseAnonKey || "unconfigured-anon-key",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

// Refresh auth tokens only while the app is foregrounded (Supabase RN guidance).
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
