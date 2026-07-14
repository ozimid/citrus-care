import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getRequestOrigin } from "@/app/_lib/request-origin";
import { createRouteHandlerSupabaseClient } from "@/app/_lib/supabase/route-handler-client";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/plants";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const next = safeNext(
    searchParams.get("next") ?? request.cookies.get("auth_next")?.value ?? null,
  );
  const oauthError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (oauthError) {
    console.error("[auth/callback]", origin, "OAuth error:", oauthError);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const supabase = await createRouteHandlerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  const cookieStore = await cookies();
  cookieStore.delete("auth_next");

  if (error) {
    const cookieNames = request.cookies.getAll().map((c) => c.name);
    console.error(
      "[auth/callback]",
      origin,
      error.message,
      "cookies:",
      cookieNames.join(", ") || "(none)",
    );
    return NextResponse.redirect(`${origin}/login?error=auth&reason=exchange`);
  }

  console.info("[auth/callback]", origin, "ok →", next);
  return NextResponse.redirect(`${origin}${next}`);
}
