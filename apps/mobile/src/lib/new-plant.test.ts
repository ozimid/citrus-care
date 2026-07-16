import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewPlantInput } from "@citrus/shared";
import {
  buildPlantInsertRow,
  emptyNewPlantForm,
  formFromPlant,
  GENERIC_CREATE_PLANT_ERROR,
  insertPlant,
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

describe("buildPlantInsertRow", () => {
  it("builds the insert row with an explicit user_id and nulls for missing optionals (web createPlant parity)", () => {
    const result = validateNewPlant(
      filled({ species: "", cultivar: "", location: "", zip_code: "" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildPlantInsertRow(result.data, "user-123")).toEqual({
      user_id: "user-123",
      name: "Mr Lemon by the door",
      plant_type: "tree",
      species: null,
      cultivar: null,
      location: null,
      zip_code: null,
    });
  });
});

// F20: the sheet fires requestCareProfile(plantId) right after a successful
// insert, so the insert has to hand the new row's id back.

const INPUT: NewPlantInput = {
  name: "Mr Lemon",
  plant_type: "tree",
  species: null,
  cultivar: null,
  location: null,
  zip_code: "90210",
};

interface Call {
  op: string;
  args: unknown[];
}

function fakeInsertClient(
  calls: Call[],
  result: { data: unknown; error: { message: string } | null },
): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-123" } } }),
    },
    from(table: string) {
      calls.push({ op: "from", args: [table] });
      return {
        insert(row: unknown) {
          calls.push({ op: "insert", args: [row] });
          return {
            select(cols: string) {
              calls.push({ op: "select", args: [cols] });
              return {
                single: async () => {
                  calls.push({ op: "single", args: [] });
                  return result;
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("insertPlant", () => {
  it("returns the new plant's id so the caller can request its care profile", async () => {
    const calls: Call[] = [];
    const id = await insertPlant(
      fakeInsertClient(calls, { data: { id: "plant-9" }, error: null }),
      INPUT,
    );
    expect(id).toBe("plant-9");
    expect(calls[0]).toEqual({ op: "from", args: ["plants"] });
    expect(calls[1]).toEqual({ op: "insert", args: [buildPlantInsertRow(INPUT, "user-123")] });
    expect(calls[2].op).toBe("select");
  });

  it("maps an insert failure to the generic user-facing string", async () => {
    await expect(
      insertPlant(fakeInsertClient([], { data: null, error: { message: "boom" } }), INPUT),
    ).rejects.toThrow(GENERIC_CREATE_PLANT_ERROR);
  });

  // A row that came back without an id would silently skip the care-profile
  // request; treat it as a failed insert rather than a half-created plant.
  it("treats a missing id in the returned row as a failure", async () => {
    await expect(
      insertPlant(fakeInsertClient([], { data: {}, error: null }), INPUT),
    ).rejects.toThrow(GENERIC_CREATE_PLANT_ERROR);
  });
});
