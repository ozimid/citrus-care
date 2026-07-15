import { describe, expect, it } from "vitest";
import { checkQuarantine, isCitrus } from "@citrus/shared";

// The quarantine module moved from apps/web/app/_lib/quarantine.ts to
// packages/shared/src/quarantine.ts so the mobile plant-detail screen can
// reuse it. These tests pin the shared-package export and the web behavior.

const citrusTree = {
  plant_type: "tree",
  name: "Front yard lemon",
  species: "Citrus limon",
  cultivar: "Meyer Lemon",
};

describe("isCitrus", () => {
  it("detects citrus keywords on trees (name/species/cultivar)", () => {
    expect(isCitrus(citrusTree)).toBe(true);
    expect(isCitrus({ plant_type: "tree", name: "Yuzu", species: null, cultivar: null })).toBe(true);
  });

  it("is false for non-tree plant types even with citrus words", () => {
    expect(isCitrus({ plant_type: "herb", name: "Lemon balm" })).toBe(false);
  });

  it("is false for trees without citrus keywords", () => {
    expect(isCitrus({ plant_type: "tree", name: "Oak", species: "Quercus", cultivar: null })).toBe(false);
  });
});

describe("checkQuarantine", () => {
  it("flags CA HLB quarantine ZIPs for citrus", () => {
    const result = checkQuarantine("92866", citrusTree);
    expect(result.inQuarantine).toBe(true);
    expect(result.state).toBe("CA");
    expect(result.details).toContain("CDFA");
  });

  it("flags Texas quarantine ZIP prefixes (770xx/785xx) for citrus", () => {
    const houston = checkQuarantine("77002", citrusTree);
    expect(houston).toMatchObject({ inQuarantine: true, state: "TX" });
    const rgv = checkQuarantine("78501", citrusTree);
    expect(rgv).toMatchObject({ inQuarantine: true, state: "TX" });
  });

  it("is negative outside quarantine zones, without a ZIP, and for non-citrus", () => {
    expect(checkQuarantine("10001", citrusTree).inQuarantine).toBe(false);
    expect(checkQuarantine(null, citrusTree).inQuarantine).toBe(false);
    expect(checkQuarantine("92866", { plant_type: "tree", name: "Oak" }).inQuarantine).toBe(false);
  });

  it("trims whitespace around the ZIP", () => {
    expect(checkQuarantine(" 92866 ", citrusTree).inQuarantine).toBe(true);
  });
});
