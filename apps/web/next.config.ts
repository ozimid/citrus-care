import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/** LAN IPs for Next.js dev HMR when testing on phone (same Wi‑Fi). */
function lanDevOrigins(): string[] {
  const origins: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        origins.push(addr.address);
      }
    }
  }
  return origins;
}

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@citrus/shared"],
  allowedDevOrigins: [
    "localhost",
    "localhost:3002",
    ...lanDevOrigins(),
    ...lanDevOrigins().map((ip) => `${ip}:3002`),
  ],
  // The AI/photo pipeline lives in the standalone API service (apps/api).
  // Same-origin fetches from the web client proxy through these rewrites so
  // Supabase auth cookies flow along; the mobile app calls the API directly
  // with Bearer auth. API_ORIGIN is read at build time (set it when deploying).
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3003";
    return [
      { source: "/api/assess", destination: `${apiOrigin}/assess` },
      { source: "/api/cleanup-orphans", destination: `${apiOrigin}/cleanup-orphans` },
      { source: "/api/photos/sign-upload", destination: `${apiOrigin}/photos/sign-upload` },
      // Read proxy (GET ?path=) and storage cleanup (DELETE ?prefix=) share this
      // one rewrite — Next preserves the method and query string on the way to
      // apps/api, which auth + ownership-checks before touching storage.
      { source: "/api/photos", destination: `${apiOrigin}/photos` },
    ];
  },
};

export default nextConfig;
