// D-17 architecture guard — structurally enforces CLAUDE.md's hard rules by
// scanning the real source tree. If any of these fail, the zero-backend
// architecture has been breached; do not "fix" the test.
//
// Rules covered:
//  1. No backend/auth/cloud-AI modules anywhere (supabase, google-signin,
//     cloud model SDKs, auth-session).
//  2. Pure lib modules (src/lib/*.ts minus -io.ts) never import
//     react-native/expo — the pure/-io split that keeps them vitest-testable.
//  3. package.json carries none of the banned dependencies.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Module specifiers that must not appear in any import/require. */
const BANNED_MODULES = [
  "@supabase/supabase-js",
  "@react-native-google-signin/google-signin",
  "@google/genai",
  "@anthropic-ai/sdk",
  "openai",
  "expo-auth-session",
];

/** Import prefixes forbidden in PURE lib modules (allowed in -io/components). */
const NATIVE_PREFIXES = ["react-native", "@react-native-", "expo-", "expo"];

const IMPORT_RE = /(?:from\s+|require\()\s*["']([^"']+)["']/g;

function importsOf(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) specs.push(m[1]);
  return specs;
}

function bannedImports(source: string): string[] {
  return importsOf(source).filter((spec) =>
    BANNED_MODULES.some((banned) => spec === banned || spec.startsWith(`${banned}/`)),
  );
}

function nativeImports(source: string): string[] {
  return importsOf(source).filter((spec) =>
    NATIVE_PREFIXES.some((p) => spec === p || (p.endsWith("-") ? spec.startsWith(p) : spec.startsWith(`${p}/`))),
  );
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const MOBILE_ROOT = join(__dirname, "..", "..");
// This file's own fixtures name banned modules on purpose — exclude it.
const SOURCE_FILES = [...walk(join(MOBILE_ROOT, "src")), join(MOBILE_ROOT, "App.tsx")].filter(
  (f) => !f.endsWith("arch-guard.test.ts"),
);

// The matchers must actually catch violations, or the tree scan proves nothing.
describe("guard self-check (fixtures)", () => {
  it("detects a banned module in import and require forms", () => {
    expect(bannedImports(`import { createClient } from "@supabase/supabase-js";`)).toHaveLength(1);
    expect(bannedImports(`const g = require("@react-native-google-signin/google-signin")`)).toHaveLength(1);
    expect(bannedImports(`import { GoogleGenAI } from "@google/genai";`)).toHaveLength(1);
    expect(bannedImports(`import subpath from "openai/helpers";`)).toHaveLength(1);
  });

  it("detects native imports without flagging innocent lookalikes", () => {
    expect(nativeImports(`import { View } from "react-native";`)).toHaveLength(1);
    expect(nativeImports(`import S from "@react-native-async-storage/async-storage";`)).toHaveLength(1);
    expect(nativeImports(`import { File } from "expo-file-system";`)).toHaveLength(1);
    expect(nativeImports(`import { z } from "zod";`)).toHaveLength(0);
    expect(nativeImports(`import x from "./expo-helpers-local";`)).toHaveLength(0);
  });
});

describe("D-17: no backend, no accounts, no cloud AI", () => {
  it("no source file imports a banned module", () => {
    const violations = SOURCE_FILES.flatMap((file) =>
      bannedImports(readFileSync(file, "utf8")).map((spec) => `${file} → ${spec}`),
    );
    expect(violations).toEqual([]);
  });

  it("package.json declares no banned dependency", () => {
    const pkg = JSON.parse(readFileSync(join(MOBILE_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    expect(declared.filter((d) => BANNED_MODULES.includes(d))).toEqual([]);
  });
});

// D-P9: every caller of the single model session must run under the SAME
// inference budget. A request's clock starts when it is ENQUEUED, so with equal
// ceilings the earliest one always expires first — and the earliest is always
// the one currently running, which is what makes interrupt() safe. ONE
// unbudgeted caller breaks that: it can hold the session past another request's
// ceiling and take the interrupt meant for itself. care-profile-io was that
// caller until 2026-08-31, so this guard exists to keep it fixed.
describe("D-P9: every on-device flow runs under the shared inference budget", () => {
  /** Modules that await the model. Adding a new one means adding it here — that
   * is the point: the list is the invariant, made hard to forget. */
  const ENGINE_FLOWS = [
    "assess.ts",
    "care-profile-io.ts",
    "plant-chat.ts",
    "prune-flow.ts",
  ];

  it.each(ENGINE_FLOWS)("%s imports withInferenceBudget", (file) => {
    const source = readFileSync(join(MOBILE_ROOT, "src", "lib", file), "utf8");
    expect(source).toContain("withInferenceBudget");
    expect(source).toContain("LOCAL_HARD_CEILING_MS");
  });

  it("catches a new engine caller that skipped the budget", () => {
    // Any lib module that hands the model a system+user prompt is a flow.
    const callers = walk(join(MOBILE_ROOT, "src", "lib"))
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => {
        const source = readFileSync(f, "utf8");
        return /generate\(\s*\{/.test(source) || /\.generate\(/.test(source);
      })
      .map((f) => f.split("/").pop() as string);

    const unbudgeted = callers.filter((file) => !ENGINE_FLOWS.includes(file));
    expect(unbudgeted, `these call the model without a budget: ${unbudgeted.join(", ")}`).toEqual([]);
  });
});

describe("pure/-io split: pure lib modules never import react-native/expo", () => {
  const pureLibFiles = walk(join(MOBILE_ROOT, "src", "lib")).filter(
    (f) => f.endsWith(".ts") && !f.endsWith("-io.ts") && !f.endsWith(".test.ts"),
  );

  it("scans a non-empty set of pure modules", () => {
    expect(pureLibFiles.length).toBeGreaterThan(10);
  });

  it("finds no native import in any pure module", () => {
    const violations = pureLibFiles.flatMap((file) =>
      nativeImports(readFileSync(file, "utf8")).map((spec) => `${file} → ${spec}`),
    );
    expect(violations).toEqual([]);
  });
});
