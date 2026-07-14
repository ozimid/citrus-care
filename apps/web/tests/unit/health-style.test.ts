import { describe, expect, it } from "vitest";
import { healthBand } from "@/app/_lib/health-style";

describe("healthBand", () => {
  it("maps 0..39 to poor (red)", () => {
    expect(healthBand(0).label).toBe("Poor");
    expect(healthBand(39).label).toBe("Poor");
  });
  it("maps 40..69 to fair (amber)", () => {
    expect(healthBand(40).label).toBe("Fair");
    expect(healthBand(69).label).toBe("Fair");
  });
  it("maps 70..100 to good (green)", () => {
    expect(healthBand(70).label).toBe("Good");
    expect(healthBand(100).label).toBe("Good");
  });
  it("clamps out-of-range scores", () => {
    expect(healthBand(-10).label).toBe("Poor");
    expect(healthBand(999).label).toBe("Good");
  });
  it("includes a tailwind color class", () => {
    expect(healthBand(80).color).toMatch(/text-/);
  });
});
