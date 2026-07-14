import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIDDLEWARE_SRC = readFileSync(
  resolve(process.cwd(), "app/_lib/supabase/middleware.ts"),
  "utf8",
);
const GOOGLE_ROUTE_SRC = readFileSync(
  resolve(process.cwd(), "app/auth/google/route.ts"),
  "utf8",
);

describe("OAuth callback redirect — source-grep contract", () => {
  it("middleware forwards stray ?code= to /auth/callback", () => {
    expect(MIDDLEWARE_SRC).toMatch(/path !== "\/auth\/callback"/);
    expect(MIDDLEWARE_SRC).toMatch(/url\.pathname = "\/auth\/callback"/);
  });

  it("google route uses path-only redirectTo and auth_next cookie", () => {
    expect(GOOGLE_ROUTE_SRC).toMatch(/redirectTo:\s*`\$\{origin\}\/auth\/callback`/);
    expect(GOOGLE_ROUTE_SRC).toMatch(/auth_next/);
    expect(GOOGLE_ROUTE_SRC).toMatch(/createRouteHandlerSupabaseClient/);
  });
});
