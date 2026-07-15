import { describe, expect, it } from "vitest";
import {
  JPEG_QUALITY,
  MAX_DIMENSION,
  needsDownscale,
  resizeActionsFor,
  targetSize,
} from "./photo";

describe("constants", () => {
  it("mirror apps/web/app/_lib/image-utils.ts exactly", () => {
    expect(MAX_DIMENSION).toBe(1600);
    expect(JPEG_QUALITY).toBe(0.85);
  });
});

describe("targetSize", () => {
  it("scales the long side down to 1600 preserving aspect ratio (landscape)", () => {
    expect(targetSize({ width: 3200, height: 2400 })).toEqual({ width: 1600, height: 1200 });
  });

  it("scales the long side down to 1600 preserving aspect ratio (portrait)", () => {
    expect(targetSize({ width: 2400, height: 3200 })).toEqual({ width: 1200, height: 1600 });
  });

  it("never upscales an image already within bounds", () => {
    expect(targetSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(targetSize({ width: 1600, height: 1600 })).toEqual({ width: 1600, height: 1600 });
  });

  it("rounds like the web downscaler (Math.round)", () => {
    // scale = 1600/3000; 2000 * 1600/3000 = 1066.67 -> 1067
    expect(targetSize({ width: 3000, height: 2000 })).toEqual({ width: 1600, height: 1067 });
  });
});

describe("needsDownscale", () => {
  it("is true only when the long side exceeds MAX_DIMENSION", () => {
    expect(needsDownscale({ width: 1601, height: 900 })).toBe(true);
    expect(needsDownscale({ width: 900, height: 1601 })).toBe(true);
    expect(needsDownscale({ width: 1600, height: 1600 })).toBe(false);
    expect(needsDownscale({ width: 320, height: 240 })).toBe(false);
  });
});

describe("resizeActionsFor", () => {
  it("resizes by width when landscape (manipulator keeps aspect ratio)", () => {
    expect(resizeActionsFor({ width: 4000, height: 3000 })).toEqual([
      { resize: { width: 1600 } },
    ]);
  });

  it("resizes by height when portrait", () => {
    expect(resizeActionsFor({ width: 3000, height: 4000 })).toEqual([
      { resize: { height: 1600 } },
    ]);
  });

  it("returns no actions when the photo is already small enough", () => {
    expect(resizeActionsFor({ width: 1200, height: 1600 })).toEqual([]);
  });
});
