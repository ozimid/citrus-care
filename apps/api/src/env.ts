import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");

/**
 * Dev convenience: load `apps/api/.env.local` if present, otherwise fall back
 * to `apps/web/.env.local` (same Supabase/Gemini secrets). Tiny dotenv-style
 * parser — never logs values, never overrides variables already set in the
 * process environment.
 */
export function loadLocalEnv(): void {
  const candidates = [
    path.join(apiRoot, ".env.local"),
    path.resolve(apiRoot, "..", "web", ".env.local"),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (!file) return;

  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
