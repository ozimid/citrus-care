import { describe, expect, it } from "vitest";
import { bandColor, healthBand } from "./health";

// Thresholds mirror apps/web/app/_lib/health-style.ts exactly (<40 Poor,
// <70 Fair, >=70 Good) so a plant never shows a different band on mobile
// than on web.
describe("healthBand", () => {
  it("returns Poor below 40", () => {
    expect(healthBand(0).label).toBe("Poor");
    expect(healthBand(39).label).toBe("Poor");
  });

  it("returns Fair from 40 to 69", () => {
    expect(healthBand(40).label).toBe("Fair");
    expect(healthBand(69).label).toBe("Fair");
  });

  it("returns Good from 70 up", () => {
    expect(healthBand(70).label).toBe("Good");
    expect(healthBand(100).label).toBe("Good");
  });

  it("clamps out-of-range scores instead of throwing", () => {
    expect(healthBand(-5).label).toBe("Poor");
    expect(healthBand(140).label).toBe("Good");
  });

  it("exposes a stable band key for styling", () => {
    expect(healthBand(10).key).toBe("poor");
    expect(healthBand(50).key).toBe("fair");
    expect(healthBand(90).key).toBe("good");
  });
});

describe("bandColor", () => {
  it("maps every band to a color in both schemes", () => {
    for (const key of ["poor", "fair", "good"] as const) {
      expect(bandColor(key, "light")).toMatch(/^#[0-9a-f]{6}$/i);
      expect(bandColor(key, "dark")).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("uses the brand emerald for good in light mode", () => {
    expect(bandColor("good", "light")).toBe("#059669");
  });
});
