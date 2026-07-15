import { getDevLanOrigins } from "@/app/_lib/dev-lan-origins";

/** Dev-only strip: the LAN URL a phone on the same Wi‑Fi can reach (the
 * mobile app's API origin routes through this host's /api rewrite in dev). */
export function DevLanBanner() {
  if (process.env.NODE_ENV !== "development") return null;

  const lanOrigins = getDevLanOrigins();
  if (lanOrigins.length === 0) return null;

  return (
    <div
      className="border-b border-amber-300/80 bg-amber-50 px-4 py-2 text-center text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
      role="note"
    >
      <span className="font-medium">Phone testing:</span> this dev server is reachable at{" "}
      {lanOrigins.map((origin, i) => (
        <span key={origin}>
          {i > 0 ? " or " : ""}
          <a href={origin} className="font-mono underline">
            {origin}
          </a>
        </span>
      ))}{" "}
      on the same Wi‑Fi — the mobile app&apos;s API origin points here.
    </div>
  );
}
