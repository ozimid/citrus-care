import { networkInterfaces } from "node:os";

/** LAN origins for Supabase redirect URL hints (dev only). */
export function getDevLanOrigins(): string[] {
  const origins: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        origins.push(`http://${addr.address}:3002`);
      }
    }
  }
  return origins;
}

export function getDevRedirectUrlHints(): string[] {
  const hints = new Set<string>([
    "http://localhost:3002/**",
    "http://localhost:3002/auth/callback",
  ]);
  for (const origin of getDevLanOrigins()) {
    hints.add(`${origin}/**`);
    hints.add(`${origin}/auth/callback`);
  }
  return [...hints];
}
