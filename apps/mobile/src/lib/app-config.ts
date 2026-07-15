// Pure resolver for runtime app configuration. Values come from (in order of
// precedence) EXPO_PUBLIC_* env vars (apps/mobile/.env, gitignored) and
// app.json `expo.extra` (committed placeholders only — never real keys).
// The thin expo-constants wiring lives in src/lib/config.ts.

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  googleWebClientId?: string;
  googleIosClientId?: string;
  googleAndroidClientId?: string;
  /** Required keys that are unset or still placeholders. */
  missing: string[];
}

type Extra = Record<string, unknown> | undefined | null;
type Env = Record<string, string | undefined>;

function pick(extra: Extra, env: Env, extraKey: string, envKey: string): string | undefined {
  const fromEnv = env[envKey];
  if (typeof fromEnv === "string" && fromEnv.length > 0 && !isPlaceholder(fromEnv)) return fromEnv;
  const fromExtra = extra?.[extraKey];
  if (typeof fromExtra === "string" && fromExtra.length > 0 && !isPlaceholder(fromExtra)) {
    return fromExtra;
  }
  return undefined;
}

function isPlaceholder(value: string): boolean {
  return value.startsWith("YOUR_");
}

export function resolveAppConfig(extra: Extra, env: Env): AppConfig {
  const supabaseUrl = pick(extra, env, "supabaseUrl", "EXPO_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = pick(extra, env, "supabaseAnonKey", "EXPO_PUBLIC_SUPABASE_ANON_KEY");

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("supabaseUrl");
  if (!supabaseAnonKey) missing.push("supabaseAnonKey");

  return {
    supabaseUrl: supabaseUrl ?? "",
    supabaseAnonKey: supabaseAnonKey ?? "",
    googleWebClientId: pick(extra, env, "googleWebClientId", "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"),
    googleIosClientId: pick(extra, env, "googleIosClientId", "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"),
    googleAndroidClientId: pick(
      extra,
      env,
      "googleAndroidClientId",
      "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID",
    ),
    missing,
  };
}
