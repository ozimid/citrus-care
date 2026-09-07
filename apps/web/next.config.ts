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
  async headers() {
    // These filenames are release versions: publish v2 when the media changes.
    // Unversioned public files retain Next's default revalidation policy.
    return ["mp4", "webp", "vtt"].map((extension) => ({
      source: `/media/citrus-care-tutorial-v1.${extension}`,
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }));
  },
  // D-17: the web app is a fully static marketing landing. There is no API to
  // proxy — the AI runs on-device in the app, and there is no backend at all.
};

export default nextConfig;
