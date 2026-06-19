import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOOGLE_ROUTE_SRC = readFileSync(
  resolve(process.cwd(), "app/auth/google/route.ts"),
  "utf8",
);

describe("Google OAuth account-picker — source-grep contract", () => {
  it("server /auth/google passes prompt=select_account through queryParams", () => {
    expect(GOOGLE_ROUTE_SRC).toMatch(/signInWithOAuth\(/);
    expect(GOOGLE_ROUTE_SRC).toMatch(/provider:\s*["']google["']/);
    expect(GOOGLE_ROUTE_SRC).toMatch(
      /queryParams\s*:\s*\{\s*prompt\s*:\s*["']select_account["']\s*,?\s*\}/,
    );
  });
});
