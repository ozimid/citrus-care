import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const USE_AUTH_SRC = readFileSync(
  resolve(process.cwd(), "app/_lib/useAuth.ts"),
  "utf8",
);

describe("Google OAuth account-picker — source-grep contract", () => {
  it("useAuth signIn() passes prompt=select_account through queryParams", () => {
    const signInBlock = USE_AUTH_SRC.match(
      /const\s+signIn\s*=\s*useCallback\([\s\S]+?\n\s{2}\},/,
    );
    expect(signInBlock, "signIn useCallback not found").not.toBeNull();
    const block = signInBlock![0];

    expect(block).toMatch(/signInWithOAuth\(/);
    expect(block).toMatch(/provider:\s*["']google["']/);
    expect(block).toMatch(
      /queryParams\s*:\s*\{\s*prompt\s*:\s*["']select_account["']\s*,?\s*\}/,
    );
  });
});
