import { describe, expect, it } from "vitest";
import type { CareProfile } from "@citrus/shared";
import {
  allPlants,
  getPlant,
  parsePlantStore,
  removePlant,
  serializePlantStore,
  upsertPlant,
  type PlantStore,
  type StoredPlant,
} from "./plant-store";

// D-17: plants live only on the phone now (no Supabase). Same pure/-io split as
// photo-store: this module holds the keyed store + never-throwing parse; the
// AsyncStorage wiring is the thin plant-store-io.ts.

const CARE: CareProfile = {
  base_watering_interval_days: 7,
  water_amount_note: "Deep water",
  sun: "full",
  temp_min_c: 5,
  temp_max_c: 35,
  drought_tolerance: "medium",
  indoor_ok: false,
  notes: "Citrus.",
};

function plant(overrides: Partial<StoredPlant> = {}): StoredPlant {
  return {
    id: "p1",
    name: "Lemon",
    plant_type: "tree",
    species: "Citrus limon",
    cultivar: "Eureka",
    location: "Balcony",
    zip_code: "90210",
    cover_assessment_id: null,
    care_profile: CARE,
    created_at: "2026-07-15T10:00:00Z",
    ...overrides,
  };
}

describe("upsertPlant", () => {
  it("adds a plant keyed by id without mutating the input", () => {
    const before: PlantStore = {};
    const after = upsertPlant(before, plant());
    expect(after["p1"]).toEqual(plant());
    expect(before).toEqual({});
  });

  it("replaces an existing plant (edit)", () => {
    const first = upsertPlant({}, plant());
    const second = upsertPlant(first, plant({ name: "Lime" }));
    expect(second["p1"].name).toBe("Lime");
    expect(Object.keys(second)).toEqual(["p1"]);
  });
});

describe("removePlant", () => {
  it("drops the plant, keeps others, does not mutate", () => {
    const store = upsertPlant(upsertPlant({}, plant()), plant({ id: "p2", name: "Orange" }));
    const after = removePlant(store, "p1");
    expect(Object.keys(after)).toEqual(["p2"]);
    expect(Object.keys(store).sort()).toEqual(["p1", "p2"]);
  });

  it("is a no-op for an unknown plant", () => {
    const store = upsertPlant({}, plant());
    expect(removePlant(store, "nope")).toEqual(store);
  });
});

describe("getPlant / allPlants", () => {
  const store = upsertPlant(
    upsertPlant({}, plant({ id: "old", created_at: "2026-01-01T00:00:00Z" })),
    plant({ id: "new", created_at: "2026-07-01T00:00:00Z" }),
  );

  it("looks up a plant by id, null when unknown", () => {
    expect(getPlant(store, "old")?.id).toBe("old");
    expect(getPlant(store, "missing")).toBeNull();
  });

  it("lists plants newest-first (fetchPlants order)", () => {
    expect(allPlants(store).map((p) => p.id)).toEqual(["new", "old"]);
  });
});

describe("parsePlantStore / serializePlantStore", () => {
  it("round-trips through JSON", () => {
    const store = upsertPlant({}, plant());
    expect(parsePlantStore(serializePlantStore(store))).toEqual(store);
  });

  it("returns an empty store for null / malformed JSON (never throws)", () => {
    expect(parsePlantStore(null)).toEqual({});
    expect(parsePlantStore("not-json{")).toEqual({});
    expect(parsePlantStore('"a string"')).toEqual({});
    expect(parsePlantStore("[1,2]")).toEqual({});
  });

  it("skips malformed plants but keeps valid ones (stored data is untrusted)", () => {
    const stored = JSON.stringify({
      good: plant(),
      "missing-name": { id: "x", plant_type: "tree", created_at: "t" },
      "wrong-types": { ...plant(), name: 5 },
      "not-an-object": "nope",
    });
    expect(Object.keys(parsePlantStore(stored))).toEqual(["good"]);
  });

  it("keeps a plant whose care_profile is malformed (it degrades downstream, not here)", () => {
    const stored = JSON.stringify({ p1: { ...plant(), care_profile: { junk: true } } });
    const parsed = parsePlantStore(stored);
    // The plant survives; parseStoredCareProfile (in the mapper) turns the bad
    // profile into null. A bad profile is not a bad plant.
    expect(parsed["p1"]?.name).toBe("Lemon");
  });
});
