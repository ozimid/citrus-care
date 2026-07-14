import type { NextRequest } from "next/server";

/** Stable origin for OAuth redirects (uses Host header, not 0.0.0.0). */
export function getRequestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;

  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto =
    forwardedProto ??
    (process.env.NODE_ENV === "production" ? "https" : "http");

  return `${proto}://${host}`;
}
