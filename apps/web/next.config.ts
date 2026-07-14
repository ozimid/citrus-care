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
};

export default nextConfig;
