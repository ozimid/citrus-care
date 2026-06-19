import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseCookieOptions } from "@/app/_lib/supabase/cookie-options";

/** Supabase client for route handlers — always writes auth cookies (unlike Server Components). */
export async function createRouteHandlerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: supabaseCookieOptions,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );
}
