import { describe, expect, it } from "vitest";
import {
  prefillFromDiagnosis,
  buildStoredPlant,
  bulkPlantInputs,
  emptyNewPlantForm,
  formFromPlant,
  GENERIC_CREATE_PLANT_ERROR,
  showsCitrusCultivarPicker,
  validateNewPlant,
  ZONE_FORMAT_ERROR,
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
      tag: "",
      zone: "",
    });
  });

  // F39 Phase 3b: the zone is edited on the same sheet, so (like the tag) the
  // prefill must carry it or every edit of a zoned plant would silently move
  // it out of its row.
  it("prefills the zone when the plant has one, '' for none", () => {
    const base = { name: "Mr Lemon", plant_type: "tree", species: null, cultivar: null, location: null, zip_code: null };
    expect(formFromPlant({ ...base, zone: "NORTH" }).zone).toBe("NORTH");
    expect(formFromPlant({ ...base, zone: null }).zone).toBe("");
    expect(formFromPlant(base).zone).toBe("");
  });

  // F39: the tag is edited on the same sheet, so the prefill must carry it or
  // every edit of a tagged plant would silently clear the tag on save.
  it("prefills the tag when the plant has one", () => {
    expect(
      formFromPlant({
        name: "Mr Lemon",
        plant_type: "tree",
        species: null,
        cultivar: null,
        location: null,
        zip_code: null,
        tag: "L3",
      }).tag,
    ).toBe("L3");
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
      tag: null,
      zone: null,
    });
  });

  // F39 Phase 3b: the zone follows the tag's rules (same whitelist, ≤ 24,
  // normalized) but is NOT unique — many plants share a zone by design.
  describe("zone", () => {
    it("normalizes a zone (trim, collapse spaces, uppercase) and turns an empty one into null", () => {
      const zoned = validateNewPlant(filled({ zone: "  row   2 " }));
      expect(zoned.ok).toBe(true);
      if (zoned.ok) expect(zoned.data.zone).toBe("ROW 2");
      const unzoned = validateNewPlant(filled({ zone: "   " }));
      expect(unzoned.ok).toBe(true);
      if (unzoned.ok) expect(unzoned.data.zone).toBeNull();
    });

    it("rejects characters outside the whitelist and zones over 24 characters", () => {
      for (const bad of ["North!", "A".repeat(25), "zone/1"]) {
        const result = validateNewPlant(filled({ zone: bad }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.zone).toMatch(/24|letters|numbers/);
      }
    });

    it("is not checked for uniqueness — two plants may share a zone", () => {
      expect(validateNewPlant(filled({ zone: "NORTH" }), { takenTags: ["NORTH"] }).ok).toBe(true);
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

  // F39 D-W4: the human tag — whitelisted, ≤ 24, unique across the garden.
  describe("tag", () => {
    it("normalizes a tag (trim, uppercase) and turns an empty one into null", () => {
      const tagged = validateNewPlant(filled({ tag: " l3 " }));
      expect(tagged.ok).toBe(true);
      if (tagged.ok) expect(tagged.data.tag).toBe("L3");
      const untagged = validateNewPlant(filled({ tag: "   " }));
      expect(untagged.ok).toBe(true);
      if (untagged.ok) expect(untagged.data.tag).toBeNull();
    });

    it("rejects characters outside the whitelist and tags over 24 characters", () => {
      for (const bad of ["L3!", "L/3", "A".repeat(25)]) {
        const result = validateNewPlant(filled({ tag: bad }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.tag).toMatch(/24|letters|numbers/);
      }
    });

    it("rejects a tag another plant already has, comparing normalized forms", () => {
      for (const taken of [["L3"], [" l3 "], new Set(["L3"])]) {
        const result = validateNewPlant(filled({ tag: "l3" }), { takenTags: taken });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.tag).toBe("Another plant already has this tag");
      }
      expect(validateNewPlant(filled({ tag: "L3" }), { takenTags: ["L4"] }).ok).toBe(true);
      expect(validateNewPlant(filled({ tag: "" }), { takenTags: ["L3"] }).ok).toBe(true);
    });

    it("also takes the other plants' tags directly (the sheets pass a plain array)", () => {
      const result = validateNewPlant(filled({ tag: "L3" }), ["l3"]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.tag).toBe("Another plant already has this tag");
      expect(validateNewPlant(filled({ tag: "L3" }), new Set(["L4"])).ok).toBe(true);
      expect(validateNewPlant(filled({ tag: "L3" }), []).ok).toBe(true);
    });
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
      tag: null,
      codes: [],
      zone: null,
    });
  });

  it("stores the normalized tag and starts with no bound codes (F39)", () => {
    const result = validateNewPlant(filled({ tag: " l3 " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = buildStoredPlant(result.data, "plant-1", "2026-07-15T00:00:00Z");
    expect(stored.tag).toBe("L3");
    expect(stored.codes).toEqual([]);
  });

  // F39 Phase 3b: the zone is stored normalized; the walk order is NOT set
  // here — a new plant is placed in its zone's order by the io (placeInZone),
  // which knows the other plants. The record carries no walk_order key.
  it("stores the normalized zone and leaves walk_order unset (F39 Phase 3b)", () => {
    const result = validateNewPlant(filled({ zone: " north " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = buildStoredPlant(result.data, "plant-1", "2026-07-15T00:00:00Z");
    expect(stored.zone).toBe("NORTH");
    expect("walk_order" in stored).toBe(false);
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

describe("bulkPlantInputs", () => {
  // "Add several plants" drafts go through the SAME gate as the sheet, so a
  // future required field on newPlantSchema fails here, in a test, not in the
  // io loop on a phone.
  it("validates every draft: trimmed name, normalized zone, null for the optionals it never asks for", () => {
    const inputs = bulkPlantInputs([
      { name: " A-01 ", plant_type: "tree", zone: " north " },
      { name: "A-02", plant_type: "shrub", zone: null },
    ]);
    const nulls = { species: null, cultivar: null, location: null, zip_code: null, tag: null };
    expect(inputs).toEqual([
      { ...nulls, name: "A-01", plant_type: "tree", zone: "NORTH" },
      { ...nulls, name: "A-02", plant_type: "shrub", zone: null },
    ]);
  });

  it("throws the zone error verbatim for a malformed zone — the user's typo, shown as such", () => {
    expect(() => bulkPlantInputs([{ name: "A-01", plant_type: "tree", zone: "north!" }])).toThrow(ZONE_FORMAT_ERROR);
  });

  it("throws the generic create error for any other invalid draft", () => {
    expect(() => bulkPlantInputs([{ name: "   ", plant_type: "tree", zone: null }])).toThrow(GENERIC_CREATE_PLANT_ERROR);
  });

  it("is empty for no drafts", () => {
    expect(bulkPlantInputs([])).toEqual([]);
  });
});
