import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";

export type AuthContext = { supabase: SupabaseClient; user: User };

function supabaseEnv(): { url: string; anonKey: string } {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase URL / anon key environment variables");
  }
  return { url, anonKey };
}

/**
 * Build a per-request, RLS-honoring Supabase client and resolve the user.
 *
 * Two auth transports:
 * - `Authorization: Bearer <jwt>` header (mobile / direct API callers)
 * - Supabase SSR cookies (web app requests proxied through Next rewrites)
 *
 * Returns null when no valid user is present.
 */
export async function getAuth(req: Request): Promise<AuthContext | null> {
  const { url, anonKey } = supabaseEnv();

  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return null;
    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) return null;
    return { supabase, user };
  }

  const cookieHeader = req.headers.get("Cookie") ?? "";
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(cookieHeader).map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll() {
        // No-op: the API never sets auth cookies. Session refresh is owned by
        // the web app's proxy (apps/web/proxy.ts) before requests reach us.
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, user };
}
