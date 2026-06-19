import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getRequestOrigin } from "@/app/_lib/request-origin";
import { supabaseCookieOptions } from "@/app/_lib/supabase/cookie-options";
import { createRouteHandlerSupabaseClient } from "@/app/_lib/supabase/route-handler-client";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/plants";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestOrigin(request);
  const next = safeNext(searchParams.get("next"));

  const supabase = await createRouteHandlerSupabaseClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data?.url) {
    console.error("[auth/google]", origin, error?.message);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const cookieStore = await cookies();
  cookieStore.set("auth_next", next, {
    ...supabaseCookieOptions,
    httpOnly: true,
    maxAge: 60 * 10,
  });

  console.info("[auth/google] redirectTo", `${origin}/auth/callback`);
  return NextResponse.redirect(data.url);
}
