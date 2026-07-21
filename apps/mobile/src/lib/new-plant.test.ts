import { describe, expect, it } from "vitest";
import {
  prefillFromDiagnosis,
  buildStoredPlant,
  emptyNewPlantForm,
  formFromPlant,
  showsCitrusCultivarPicker,
  validateNewPlant,
} from "./new-plant";

function filled(overrides: Partial<typeof emptyNewPlantForm> = {}) {
  return {
    ...emptyNewPlantForm,
    name: "  Mr Lemon by the door  ",
    plant_type: "tree",
    species: "Citrus limon",
    cultivar: "Meyer Lemon",
    location: "South patio",
    zip_code: "90210",
    ...overrides,
  };
}

describe("formFromPlant", () => {
  it("prefills the edit sheet from an existing row, mapping nulls to empty strings", () => {
    expect(
      formFromPlant({
        name: "Mr Lemon",
        plant_type: "tree",
        species: null,
        cultivar: "Meyer Lemon",
        location: null,
        zip_code: "92866",
      }),
    ).toEqual({
      name: "Mr Lemon",
      plant_type: "tree",
      species: "",
      cultivar: "Meyer Lemon",
      location: "",
      zip_code: "92866",
    });
  });
});

describe("showsCitrusCultivarPicker", () => {
  it("shows the citrus cultivar list only for trees (mirrors web new-plant-form gating)", () => {
    expect(showsCitrusCultivarPicker("tree")).toBe(true);
    expect(showsCitrusCultivarPicker("herb")).toBe(false);
    expect(showsCitrusCultivarPicker("shrub")).toBe(false);
    expect(showsCitrusCultivarPicker("other")).toBe(false);
  });
});

describe("validateNewPlant", () => {
  it("accepts a complete form and trims values", () => {
    const result = validateNewPlant(filled());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      name: "Mr Lemon by the door",
      plant_type: "tree",
      species: "Citrus limon",
      cultivar: "Meyer Lemon",
      location: "South patio",
      zip_code: "90210",
    });
  });

  it("turns empty optional fields into null (newPlantSchema parity)", () => {
    const result = validateNewPlant(
      filled({ species: "", cultivar: "   ", location: "", zip_code: "" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.species).toBeNull();
    expect(result.data.cultivar).toBeNull();
    expect(result.data.location).toBeNull();
    expect(result.data.zip_code).toBeNull();
  });

  it("requires a name", () => {
    const result = validateNewPlant(filled({ name: "   " }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe("Required");
  });

  it("caps name at 80 characters with the schema's message", () => {
    const result = validateNewPlant(filled({ name: "x".repeat(81) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe("Max 80 characters");
  });

  it("rejects a plant_type outside the shared PLANT_TYPES list", () => {
    const result = validateNewPlant(filled({ plant_type: "cactus" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.plant_type).toBeTruthy();
  });

  it("requires zip_code, when given, to be exactly 5 digits", () => {
    for (const bad of ["1234", "123456", "9021O", "90210-1234"]) {
      const result = validateNewPlant(filled({ zip_code: bad }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.zip_code).toBe("Enter a 5-digit ZIP code");
    }
    expect(validateNewPlant(filled({ zip_code: " 90210 " })).ok).toBe(true);
  });
});

describe("buildStoredPlant", () => {
  it("builds a local plant record (no user_id; null cover + care_profile until generated)", () => {
    const result = validateNewPlant(
      filled({ species: "", cultivar: "", location: "", zip_code: "" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildStoredPlant(result.data, "plant-1", "2026-07-15T00:00:00Z")).toEqual({
      id: "plant-1",
      name: "Mr Lemon by the door",
      plant_type: "tree",
      species: null,
      cultivar: null,
      location: null,
      zip_code: null,
      cover_assessment_id: null,
      care_profile: null,
      created_at: "2026-07-15T00:00:00Z",
    });
  });
});

// F35: the AI's plant_guess drafts the new-plant form; the user confirms.
describe("prefillFromDiagnosis", () => {
  const diag = (plant_guess?: object) => ({
    health_score: 70,
    summary: "s",
    symptoms: [],
    causes: [],
    recommendations: [],
    ...(plant_guess ? { plant_guess } : {}),
  });

  it("maps a known plant type (case-insensitive) and carries the species", () => {
    const p = prefillFromDiagnosis(diag({ plant_type: "Tree", species: "Washington Navel Orange" }) as never);
    expect(p.plant_type).toBe("tree");
    expect(p.species).toBe("Washington Navel Orange");
  });

  it("falls back to 'other' for a type outside the chip list", () => {
    expect(prefillFromDiagnosis(diag({ plant_type: "bonsai-ish" }) as never).plant_type).toBe("other");
  });

  it("returns an empty prefill when the model made no guess", () => {
    expect(prefillFromDiagnosis(diag() as never)).toEqual({});
  });

  it("uses the species as the suggested name", () => {
    expect(prefillFromDiagnosis(diag({ species: "Meyer Lemon" }) as never).name).toBe("Meyer Lemon");
  });
});
