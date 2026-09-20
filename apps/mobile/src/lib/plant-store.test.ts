import { describe, expect, it } from "vitest";
import type { CareProfile } from "@citrus/shared";
import {
  addPlantCode,
  allPlants,
  getPlant,
  parsePlantStore,
  removePlant,
  removePlantCode,
  serializePlantStore,
  upsertPlant,
  type PlantStore,
  type StoredPlant,
} from "./plant-store";
import { MAX_CODES_PER_PLANT } from "./plant-tags";

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

// Ids that pass the D-W16 gate (newLocalId shape) — the parse tests need them
// because parsePlantStore now refuses anything that could not name a directory.
const P1 = "p1-00000001";
const P2 = "p2-00000001";
const P3 = "p3-00000001";
const LEGACY_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

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
    const store = upsertPlant({}, plant({ id: P1 }));
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
      [P1]: plant({ id: P1 }),
      [P2]: { id: P2, plant_type: "tree", created_at: "t" },
      [P3]: { ...plant({ id: P3 }), name: 5 },
      "not-an-object": "nope",
    });
    expect(Object.keys(parsePlantStore(stored))).toEqual([P1]);
  });

  it("keeps a plant whose care_profile is malformed (it degrades downstream, not here)", () => {
    const stored = JSON.stringify({ [P1]: { ...plant({ id: P1 }), care_profile: { junk: true } } });
    const parsed = parsePlantStore(stored);
    // The plant survives; parseStoredCareProfile (in the mapper) turns the bad
    // profile into null. A bad profile is not a bad plant.
    expect(parsed[P1]?.name).toBe("Lemon");
  });
});

// D-W16: a plant id becomes photos/{id}/ on disk, so a crafted backup (or a
// corrupted blob) must not be able to smuggle a path through the parser.
describe("parsePlantStore refuses ids that could not name a directory", () => {
  it("drops traversal and reserved names, keeps valid neighbours", () => {
    const stored = JSON.stringify({
      "..": plant({ id: ".." }),
      _inbox: plant({ id: "_inbox" }),
      "a/b": plant({ id: "a/b" }),
      [P1]: plant({ id: P1 }),
    });
    expect(Object.keys(parsePlantStore(stored))).toEqual([P1]);
  });

  it("drops a record whose key disagrees with its id", () => {
    const stored = JSON.stringify({ [P2]: plant({ id: P1 }), [P1]: plant({ id: P1 }) });
    expect(Object.keys(parsePlantStore(stored))).toEqual([P1]);
  });

  it("keeps legacy UUID ids (pre-D-17 plants)", () => {
    const stored = JSON.stringify({ [LEGACY_UUID]: plant({ id: LEGACY_UUID }) });
    expect(parsePlantStore(stored)[LEGACY_UUID]?.name).toBe("Lemon");
  });
});

// F39 D-W4: two identifiers on the plant record — the human tag and the bound
// code digests — plus the tag photo slot and the "tag missing" flag. Stored
// data is untrusted, so the parser REPAIRS these fields (never drops the plant
// for them): the plant is still the plant when its sticker digest is garbage.
describe("F39 identifiers: tag / codes / tag_photo / tag_missing", () => {
  const D1 = "a".repeat(64);
  const D2 = "b".repeat(64);
  const stored = (extra: Record<string, unknown>) => JSON.stringify({ [P1]: { ...plant({ id: P1 }), ...extra } });

  it("round-trips valid identifiers", () => {
    const store = upsertPlant(
      {},
      plant({ id: P1, tag: "L3", codes: [D1, D2], tag_photo: "x1-00000001.jpg", tag_missing: true }),
    );
    expect(parsePlantStore(serializePlantStore(store))).toEqual(store);
  });

  it("leaves a legacy plant without identifier fields exactly as it was (no keys invented)", () => {
    const parsed = parsePlantStore(stored({}))[P1];
    expect("tag" in parsed).toBe(false);
    expect("codes" in parsed).toBe(false);
    expect("tag_photo" in parsed).toBe(false);
    expect("tag_missing" in parsed).toBe(false);
  });

  it("repairs a non-string or non-whitelisted tag to null and normalizes a sloppy one", () => {
    expect(parsePlantStore(stored({ tag: 7 }))[P1].tag).toBeNull();
    expect(parsePlantStore(stored({ tag: "L3!" }))[P1].tag).toBeNull();
    expect(parsePlantStore(stored({ tag: "A".repeat(25) }))[P1].tag).toBeNull();
    expect(parsePlantStore(stored({ tag: " l3 " }))[P1].tag).toBe("L3");
    expect(parsePlantStore(stored({ tag: null }))[P1].tag).toBeNull();
  });

  it("repairs codes: non-array → [], bad digests dropped, duplicates removed, capped", () => {
    expect(parsePlantStore(stored({ codes: "nope" }))[P1].codes).toEqual([]);
    expect(parsePlantStore(stored({ codes: { 0: D1 } }))[P1].codes).toEqual([]);
    expect(parsePlantStore(stored({ codes: null }))[P1].codes).toEqual([]);
    const messy = [D1, "CC1-TEST01", D1.toUpperCase(), 42, null, D1.slice(1), `${D1}0`, D2, D1];
    expect(parsePlantStore(stored({ codes: messy }))[P1].codes).toEqual([D1, D2]);
    const many = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(64, "0"));
    expect(parsePlantStore(stored({ codes: many }))[P1].codes).toEqual(many.slice(0, MAX_CODES_PER_PLANT));
  });

  it("repairs tag_photo to null unless it is a photo basename, and tag_missing to a boolean", () => {
    expect(parsePlantStore(stored({ tag_photo: "../x.jpg" }))[P1].tag_photo).toBeNull();
    expect(parsePlantStore(stored({ tag_photo: "file:///photos/p/x1-00000001.jpg" }))[P1].tag_photo).toBeNull();
    expect(parsePlantStore(stored({ tag_photo: 5 }))[P1].tag_photo).toBeNull();
    expect(parsePlantStore(stored({ tag_photo: "x1-00000001.jpg" }))[P1].tag_photo).toBe("x1-00000001.jpg");
    expect(parsePlantStore(stored({ tag_photo: null }))[P1].tag_photo).toBeNull();
    expect(parsePlantStore(stored({ tag_missing: "yes" }))[P1].tag_missing).toBe(false);
    expect(parsePlantStore(stored({ tag_missing: 1 }))[P1].tag_missing).toBe(false);
    expect(parsePlantStore(stored({ tag_missing: true }))[P1].tag_missing).toBe(true);
  });

  it("never drops an otherwise valid plant because of a bad identifier", () => {
    const parsed = parsePlantStore(stored({ tag: 7, codes: "x", tag_photo: "..", tag_missing: 1 }));
    expect(parsed[P1]?.name).toBe("Lemon");
    expect(parsed[P1]).toMatchObject({ tag: null, codes: [], tag_photo: null, tag_missing: false });
  });
});

describe("addPlantCode / removePlantCode", () => {
  const D1 = "a".repeat(64);
  const D2 = "b".repeat(64);

  it("appends a new digest once, in order, without mutating the plant", () => {
    const before = plant({ codes: [D1] });
    const after = addPlantCode(before, D2);
    expect(after.codes).toEqual([D1, D2]);
    expect(addPlantCode(after, D1).codes).toEqual([D1, D2]);
    expect(before.codes).toEqual([D1]);
  });

  it("treats a legacy plant without codes as empty", () => {
    expect(addPlantCode(plant(), D1).codes).toEqual([D1]);
    expect(removePlantCode(plant(), D1).codes).toEqual([]);
  });

  it("refuses a ninth code — the plant comes back unchanged", () => {
    const full = plant({ codes: Array.from({ length: MAX_CODES_PER_PLANT }, (_, i) => String(i).padStart(64, "0")) });
    expect(addPlantCode(full, D1)).toBe(full);
    expect(addPlantCode(full, full.codes![0]).codes).toEqual(full.codes);
  });

  it("removes a digest and leaves the others", () => {
    const after = removePlantCode(plant({ codes: [D1, D2] }), D1);
    expect(after.codes).toEqual([D2]);
    expect(removePlantCode(after, "c".repeat(64)).codes).toEqual([D2]);
  });
});

// F39 Phase 3b: zone + walk order. A zone is normalized like a tag (it is the
// same kind of thing — a short label written on a map); a walk order is a
// positive integer, unique within its zone. Both are REPAIRED, never a reason
// to drop the plant: the plant is still the plant when its position is off.
describe("F39 zones: zone / walk_order", () => {
  const stored = (extra: Record<string, unknown>, id = P1) =>
    JSON.stringify({ [id]: { ...plant({ id }), ...extra } });

  it("round-trips a zoned, ordered plant", () => {
    const store = upsertPlant({}, plant({ id: P1, zone: "NORTH", walk_order: 3 }));
    expect(parsePlantStore(serializePlantStore(store))).toEqual(store);
  });

  it("leaves a legacy plant without zone fields exactly as it was", () => {
    const parsed = parsePlantStore(stored({}))[P1];
    expect("zone" in parsed).toBe(false);
    expect("walk_order" in parsed).toBe(false);
  });

  it("normalizes a sloppy zone and repairs a bad one to null", () => {
    expect(parsePlantStore(stored({ zone: " north " }))[P1].zone).toBe("NORTH");
    expect(parsePlantStore(stored({ zone: "row 2" }))[P1].zone).toBe("ROW 2");
    expect(parsePlantStore(stored({ zone: 7 }))[P1].zone).toBeNull();
    expect(parsePlantStore(stored({ zone: "N!" }))[P1].zone).toBeNull();
    expect(parsePlantStore(stored({ zone: "A".repeat(25) }))[P1].zone).toBeNull();
    expect(parsePlantStore(stored({ zone: null }))[P1].zone).toBeNull();
    expect(parsePlantStore(stored({ zone: "" }))[P1].zone).toBeNull();
  });

  it("repairs a walk_order that is not a positive integer to null", () => {
    expect(parsePlantStore(stored({ walk_order: 2.5 }))[P1].walk_order).toBeNull();
    expect(parsePlantStore(stored({ walk_order: 0 }))[P1].walk_order).toBeNull();
    expect(parsePlantStore(stored({ walk_order: -1 }))[P1].walk_order).toBeNull();
    expect(parsePlantStore(stored({ walk_order: "3" }))[P1].walk_order).toBeNull();
    expect(parsePlantStore(stored({ walk_order: Number.NaN }))[P1].walk_order).toBeNull();
    expect(parsePlantStore(stored({ walk_order: 1e300 }))[P1].walk_order).toBeNull();
    expect(parsePlantStore(stored({ walk_order: null }))[P1].walk_order).toBeNull();
    expect(parsePlantStore(stored({ walk_order: 3 }))[P1].walk_order).toBe(3);
  });

  it("when two plants in one zone share a walk_order, the earlier created_at keeps it and the later is nulled", () => {
    const blob = JSON.stringify({
      [P2]: plant({ id: P2, zone: "NORTH", walk_order: 2, created_at: "2026-07-20T00:00:00Z" }),
      [P1]: plant({ id: P1, zone: "NORTH", walk_order: 2, created_at: "2026-07-15T10:00:00Z" }),
      [P3]: plant({ id: P3, zone: "NORTH", walk_order: 3, created_at: "2026-07-21T00:00:00Z" }),
    });
    const parsed = parsePlantStore(blob);
    expect(parsed[P1].walk_order).toBe(2);
    expect(parsed[P2].walk_order).toBeNull();
    expect(parsed[P3].walk_order).toBe(3);
  });

  it("allows the same walk_order in DIFFERENT zones, and treats unzoned plants as one zone", () => {
    const blob = JSON.stringify({
      [P1]: plant({ id: P1, zone: "NORTH", walk_order: 1, created_at: "2026-07-15T00:00:00Z" }),
      [P2]: plant({ id: P2, zone: "SOUTH", walk_order: 1, created_at: "2026-07-16T00:00:00Z" }),
      [P3]: plant({ id: P3, zone: null, walk_order: 1, created_at: "2026-07-17T00:00:00Z" }),
      [LEGACY_UUID]: plant({ id: LEGACY_UUID, walk_order: 1, created_at: "2026-07-18T00:00:00Z" }),
    });
    const parsed = parsePlantStore(blob);
    expect(parsed[P1].walk_order).toBe(1);
    expect(parsed[P2].walk_order).toBe(1);
    expect(parsed[P3].walk_order).toBe(1);
    // Absent zone === null zone: the legacy plant collides with P3 and is later.
    expect(parsed[LEGACY_UUID].walk_order).toBeNull();
  });

  it("never drops an otherwise valid plant because of a bad zone or order", () => {
    const parsed = parsePlantStore(stored({ zone: 7, walk_order: "x" }));
    expect(parsed[P1]?.name).toBe("Lemon");
    expect(parsed[P1]).toMatchObject({ zone: null, walk_order: null });
  });
});
