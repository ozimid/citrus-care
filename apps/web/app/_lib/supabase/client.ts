"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseCookieOptions } from "@/app/_lib/supabase/cookie-options";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: supabaseCookieOptions },
  );
}
