import { defineConfig } from "vitest/config";

// Logic-only tests (see README "Testing"): pure TS modules under src/lib are
// tested with vitest; files that import react-native/expo are kept thin and
// exercised via `expo export` bundling instead.
const sharedEntry = new URL("../../packages/shared/src/index.ts", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@citrus/shared": sharedEntry,
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
