import type { CookieOptions } from "@supabase/ssr";

/** HTTP dev (localhost + LAN IP) must not use Secure cookies. */
export const supabaseCookieOptions: CookieOptions = {
  secure: process.env.NODE_ENV === "production",
  path: "/",
  sameSite: "lax",
};
