import { getDevLanOrigins } from "@/app/_lib/dev-lan-origins";
import { SUPABASE_URL_CONFIG_URL } from "@/app/_lib/google-auth-config";

/** Dev-only strip: use LAN URL on phone (not localhost). */
export function DevLanBanner() {
  if (process.env.NODE_ENV !== "development") return null;

  const lanOrigins = getDevLanOrigins();
  if (lanOrigins.length === 0) return null;

  return (
    <div
      className="border-b border-amber-300/80 bg-amber-50 px-4 py-2 text-center text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
      role="note"
    >
      <span className="font-medium">Phone testing:</span> open{" "}
      {lanOrigins.map((origin, i) => (
        <span key={origin}>
          {i > 0 ? " or " : ""}
          <a href={origin} className="font-mono underline">
            {origin}
          </a>
        </span>
      ))}{" "}
      on your phone (same Wi‑Fi). Log in there — not localhost. Supabase{" "}
      <a href={SUPABASE_URL_CONFIG_URL} className="underline">
        Site URL
      </a>{" "}
      must match that address.
    </div>
  );
}
