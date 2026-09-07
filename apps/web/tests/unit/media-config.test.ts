// @vitest-environment node
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("tutorial browser caching", () => {
  it.each([
    "/media/citrus-care-tutorial-v1.mp4",
    "/media/citrus-care-tutorial-v1.webp",
    "/media/citrus-care-tutorial-v1.vtt",
  ])("allows long-lived immutable caching for %s", async (path) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://citruscare.net${path}`,
      nextConfig,
    });

    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it.each([
    "/",
    "/sw.js",
    "/manifest.json",
    "/media/citrus-care-tutorial.mp4",
    "/media/unrelated-v1.mp4",
    "/media/citrus-care-tutorial-v1.mp4/extra",
  ])("does not apply immutable tutorial caching to %s", async (path) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://citruscare.net${path}`,
      nextConfig,
    });

    expect(response.headers.get("cache-control") ?? "").not.toContain("immutable");
  });
});
