import { describe, expect, it } from "vitest";
import {
  CAPTURE_MODES,
  DEFAULT_CAPTURE_MODE,
  captureMode,
  preselectedPlantId,
} from "./capture-modes";

describe("CAPTURE_MODES", () => {
  it("offers exactly the three design-doc modes, leaf first", () => {
    expect(CAPTURE_MODES.map((m) => m.key)).toEqual(["leaf", "plant", "cut"]);
  });

  it("defaults to the leaf close-up (design doc §6)", () => {
    expect(DEFAULT_CAPTURE_MODE).toBe("leaf");
  });

  it("carries the per-mode guidance hints", () => {
    expect(captureMode("leaf").hint).toBe(
      "Get close — fill the outline with the affected leaf",
    );
    expect(captureMode("plant").hint).toBe(
      "Step back — fit the whole plant in the frame",
    );
    expect(captureMode("cut").hint).toBe("Frame the fresh cut end inside the circle");
  });

  it("labels the segmented pill Leaf / Whole plant / Cut", () => {
    expect(CAPTURE_MODES.map((m) => m.label)).toEqual(["Leaf", "Whole plant", "Cut"]);
  });
});

describe("preselectedPlantId", () => {
  it("preselects the plant when the user has exactly one", () => {
    expect(preselectedPlantId([{ id: "p1" }])).toBe("p1");
  });

  it("forces an explicit choice when there are several", () => {
    expect(preselectedPlantId([{ id: "p1" }, { id: "p2" }])).toBeNull();
  });

  it("selects nothing when there are no plants", () => {
    expect(preselectedPlantId([])).toBeNull();
  });
});
