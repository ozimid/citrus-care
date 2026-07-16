import { describe, expect, it } from "vitest";
import {
  buildCareProfileUserText,
  parseCareProfileOutput,
  type CareProfilePlant,
} from "./care-profile-local";

// D-17: the care profile is generated ON-DEVICE now (text-only Gemma call),
// ported from the server prompt in apps/api/src/gemini.ts. The 2B model has no
// responseSchema, so the tolerant extractor + shared Zod schema is the gate —
// junk degrades to null (no watering guidance), never bad math.

const VALID = {
  base_watering_interval_days: 7,
  water_amount_note: "Water until it drains.",
  sun: "full",
  temp_min_c: 5,
  temp_max_c: 35,
  drought_tolerance: "medium",
  indoor_ok: false,
  notes: "Let the top inch dry between waterings.",
};

function plant(overrides: Partial<CareProfilePlant> = {}): CareProfilePlant {
  return {
    name: "Mr Lemon",
    plant_type: "tree",
    species: "Citrus limon",
    cultivar: "Eureka",
    location: "South patio",
    zip_code: "90210",
    ...overrides,
  };
}

describe("buildCareProfileUserText", () => {
  it("lists the plant identity, one field per line", () => {
    const text = buildCareProfileUserText(plant());
    expect(text).toContain("Plant Name: Mr Lemon");
    expect(text).toContain("Plant Type: tree");
    expect(text).toContain("Species: Citrus limon");
    expect(text).toContain("Cultivar: Eureka");
    expect(text).toContain("Location: South patio");
    expect(text).toContain("ZIP Code: 90210");
  });

  it("omits the optional lines that are absent", () => {
    const text = buildCareProfileUserText(plant({ species: null, cultivar: null, location: null, zip_code: null }));
    expect(text).toContain("Plant Name: Mr Lemon");
    expect(text).not.toContain("Species:");
    expect(text).not.toContain("Cultivar:");
    expect(text).not.toContain("Location:");
    expect(text).not.toContain("ZIP Code:");
  });
});

describe("parseCareProfileOutput", () => {
  it("parses a clean JSON object", () => {
    expect(parseCareProfileOutput(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("survives prose and markdown fences around the JSON (tolerant extractor)", () => {
    const wrapped = "Sure! Here is the profile:\n```json\n" + JSON.stringify(VALID) + "\n```\nHope it helps.";
    expect(parseCareProfileOutput(wrapped)).toEqual(VALID);
  });

  it("returns null for output with no JSON at all", () => {
    expect(parseCareProfileOutput("I couldn't determine a profile.")).toBeNull();
  });

  it("returns null when the JSON fails the shared schema", () => {
    expect(parseCareProfileOutput(JSON.stringify({ ...VALID, base_watering_interval_days: 999 }))).toBeNull();
    expect(parseCareProfileOutput('{"base_watering_interval_days": "seven"}')).toBeNull();
  });
});
