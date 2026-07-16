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
  // The AI pipeline lives in the standalone API service (apps/api). The
  // mobile app reaches it through these rewrites in dev (the port the phone
  // already trusts); direct Bearer-auth access to apps/api remains valid.
  // API_ORIGIN is read at build time (set it when deploying).
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3003";
    return [
      { source: "/api/assess", destination: `${apiOrigin}/assess` },
      // F20: the phone's one care-profile call per plant.
      { source: "/api/care-profile", destination: `${apiOrigin}/care-profile` },
    ];
  },
};

export default nextConfig;
