import { describe, expect, it } from "vitest";
import {
  CARE_PROFILE_SYSTEM_PROMPT,
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

// F37 (competitor-inspired Plant Info card): the profile also carries
// reference fields — difficulty, mature size, flowering/fruiting months.
// All optional: old stored profiles must keep parsing.
describe("care profile v2 reference fields (F37)", () => {
  const base = {
    base_watering_interval_days: 7,
    water_amount_note: "Until it drains.",
    sun: "full",
    temp_min_c: 5,
    temp_max_c: 35,
    drought_tolerance: "medium",
    indoor_ok: false,
    notes: "Water deeply.",
  };

  it("parses the new fields when present", () => {
    const out = parseCareProfileOutput(
      JSON.stringify({
        ...base,
        difficulty: "moderate",
        mature_size_note: "3-10 ft tall, up to 20 ft spread",
        flowering_months: [5, 6],
        fruiting_months: [11, 12, 1],
      }),
    );
    expect(out?.difficulty).toBe("moderate");
    expect(out?.flowering_months).toEqual([5, 6]);
  });

  it("still parses a v1 profile with none of them", () => {
    const out = parseCareProfileOutput(JSON.stringify(base));
    expect(out).not.toBeNull();
    expect(out?.difficulty).toBeUndefined();
  });

  it("rejects out-of-range months (whole profile fails closed)", () => {
    expect(parseCareProfileOutput(JSON.stringify({ ...base, flowering_months: [0, 13] }))).toBeNull();
  });

  it("the prompt requests the reference fields", () => {
    expect(CARE_PROFILE_SYSTEM_PROMPT).toMatch(/difficulty/);
    expect(CARE_PROFILE_SYSTEM_PROMPT).toMatch(/flowering_months/);
    expect(CARE_PROFILE_SYSTEM_PROMPT).toMatch(/mature_size_note/);
  });
});
