import { networkInterfaces } from "node:os";

/** LAN origins this dev server is reachable at (dev-only phone testing). */
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
