import { describe, expect, it } from "vitest";
import {
  clampSliderPosition,
  INITIAL_SLIDER_POSITION,
  SLIDER_MAX,
  SLIDER_MIN,
  sliderPositionFromX,
} from "./slider";

describe("clampSliderPosition", () => {
  it("keeps the handle between 8% and 92% so both photos stay visible", () => {
    expect(SLIDER_MIN).toBe(8);
    expect(SLIDER_MAX).toBe(92);
    expect(clampSliderPosition(0)).toBe(8);
    expect(clampSliderPosition(100)).toBe(92);
    expect(clampSliderPosition(-25)).toBe(8);
  });

  it("passes in-range values through unchanged", () => {
    expect(clampSliderPosition(8)).toBe(8);
    expect(clampSliderPosition(50)).toBe(50);
    expect(clampSliderPosition(92)).toBe(92);
  });
});

describe("sliderPositionFromX", () => {
  it("maps a touch x within the container width to a clamped percentage (web BeforeAfterSlider math)", () => {
    expect(sliderPositionFromX(150, 300)).toBe(50);
    expect(sliderPositionFromX(30, 300)).toBe(10);
    expect(sliderPositionFromX(-20, 300)).toBe(8);
    expect(sliderPositionFromX(400, 300)).toBe(92);
  });

  it("falls back to center when the container is not measured yet", () => {
    expect(INITIAL_SLIDER_POSITION).toBe(50);
    expect(sliderPositionFromX(120, 0)).toBe(INITIAL_SLIDER_POSITION);
  });
});
