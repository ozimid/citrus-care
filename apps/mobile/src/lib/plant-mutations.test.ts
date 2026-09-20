import { describe, expect, it } from "vitest";
import type { NewPlantInput } from "@citrus/shared";
import {
  applyPlantUpdate,
  applyWalkOrders,
  buildPlantUpdateRow,
  placeInZone,
  placeNewPlant,
  reconcileImportedWalkOrders,
} from "./plant-mutations";
import type { PlantStore, StoredPlant } from "./plant-store";

// D-17: the update write and delete cascade are thin AsyncStorage orchestration
// (plants-io.ts, untested by policy). The one pure piece is the field mapping.

const input: NewPlantInput = {
  name: "Mr Lemon",
  plant_type: "tree",
  species: "Citrus limon",
  cultivar: null,
  location: null,
  zip_code: "92866",
};

describe("buildPlantUpdateRow", () => {
  it("maps the editable fields, null for absent optionals, never id/created_at/care_profile", () => {
    expect(buildPlantUpdateRow(input)).toEqual({
      name: "Mr Lemon",
      plant_type: "tree",
      species: "Citrus limon",
      cultivar: null,
      location: null,
      zip_code: "92866",
    });
    expect(buildPlantUpdateRow({ name: "X", plant_type: "herb" })).toEqual({
      name: "X",
      plant_type: "herb",
      species: null,
      cultivar: null,
      location: null,
      zip_code: null,
    });
  });

  // F39: the tag is edited on the same sheet. It is written normalized, null
  // clears it, and an input with NO tag field leaves the stored tag alone —
  // so a caller that only edits the name can never wipe a stake number.
  it("threads the tag: normalized when given, null to clear, absent to keep", () => {
    expect(buildPlantUpdateRow({ ...input, tag: " l3 " }).tag).toBe("L3");
    expect(buildPlantUpdateRow({ ...input, tag: null }).tag).toBeNull();
    expect(buildPlantUpdateRow({ ...input, tag: "" }).tag).toBeNull();
    expect("tag" in buildPlantUpdateRow(input)).toBe(false);
    expect("tag" in buildPlantUpdateRow({ name: "X", plant_type: "herb" })).toBe(false);
  });

  it("never touches codes, tag_photo or tag_missing — those change only from the Tags card", () => {
    const row = buildPlantUpdateRow({ ...input, tag: "L3" }) as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["cultivar", "location", "name", "plant_type", "species", "tag", "zip_code"]);
    const zoned = buildPlantUpdateRow({ ...input, tag: "L3", zone: "N" }) as Record<string, unknown>;
    expect(Object.keys(zoned).sort()).toEqual(["cultivar", "location", "name", "plant_type", "species", "tag", "zip_code", "zone"]);
  });
});

// F39 Phase 3b: zones + walk order. The zone is edited on the same sheet as
// the tag (same rules: present → normalized or null, absent → untouched); the
// walk order is scoped to a zone, so a plant that changes zone is placed LAST
// in its new zone — it cannot carry a position from a list it is no longer on.
describe("buildPlantUpdateRow zone threading", () => {
  it("threads the zone: normalized when given, null to clear, absent to keep", () => {
    expect(buildPlantUpdateRow({ ...input, zone: " north " }).zone).toBe("NORTH");
    expect(buildPlantUpdateRow({ ...input, zone: null }).zone).toBeNull();
    expect(buildPlantUpdateRow({ ...input, zone: "" }).zone).toBeNull();
    expect("zone" in buildPlantUpdateRow(input)).toBe(false);
  });

  it("never emits walk_order — positions change only through placeInZone / applyWalkOrders", () => {
    expect("walk_order" in buildPlantUpdateRow({ ...input, zone: "N" })).toBe(false);
  });
});

function stored(overrides: Partial<StoredPlant> = {}): StoredPlant {
  return {
    id: "p1",
    name: "Lemon",
    plant_type: "tree",
    species: null,
    cultivar: null,
    location: null,
    zip_code: null,
    cover_assessment_id: null,
    care_profile: null,
    created_at: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

describe("placeInZone", () => {
  const north = [stored({ id: "n1", zone: "NORTH", walk_order: 1 }), stored({ id: "n2", zone: "NORTH", walk_order: 4 })];

  it("moves a plant into a zone at the END of that zone's walk order", () => {
    const moved = placeInZone(north, stored({ id: "s1", zone: "SOUTH", walk_order: 1 }), "NORTH");
    expect(moved).toMatchObject({ zone: "NORTH", walk_order: 5 });
  });

  it("starts at 1 in an empty or unordered zone", () => {
    expect(placeInZone([], stored({ id: "x" }), "EAST").walk_order).toBe(1);
    const unordered = [stored({ id: "e1", zone: "EAST", walk_order: null }), stored({ id: "e2", zone: "EAST" })];
    expect(placeInZone(unordered, stored({ id: "x" }), "EAST").walk_order).toBe(1);
  });

  it("ignores a stale copy of the plant itself in the list", () => {
    // The list still shows s1 in NORTH at 10 (an older read); the plant being
    // placed is the current record. Its own stale row must not count.
    const plants = [...north, stored({ id: "s1", zone: "NORTH", walk_order: 10 })];
    const self = stored({ id: "s1", zone: "SOUTH", walk_order: 1 });
    expect(placeInZone(plants, self, "NORTH")).toMatchObject({ zone: "NORTH", walk_order: 5 });
  });

  it("clears the walk order when the plant leaves every zone", () => {
    expect(placeInZone(north, north[0], null)).toMatchObject({ zone: null, walk_order: null });
  });

  it("returns the same plant (same reference) when the zone is unchanged", () => {
    expect(placeInZone(north, north[0], "NORTH")).toBe(north[0]);
    const unzoned = stored({ id: "u" });
    expect(placeInZone(north, unzoned, null)).toBe(unzoned);
  });

  it("does not mutate its inputs", () => {
    const self = stored({ id: "s1", zone: "SOUTH", walk_order: 1 });
    placeInZone(north, self, "NORTH");
    expect(self).toMatchObject({ zone: "SOUTH", walk_order: 1 });
    expect(north[1].walk_order).toBe(4);
  });
});

describe("placeNewPlant", () => {
  const north = [stored({ id: "n1", zone: "NORTH", walk_order: 1 }), stored({ id: "n2", zone: "NORTH", walk_order: 4 })];

  it("gives a new zoned plant (built without walk_order) the last position in its zone", () => {
    const built = stored({ id: "x", zone: "NORTH" });
    expect(placeNewPlant(north, built)).toMatchObject({ zone: "NORTH", walk_order: 5 });
    expect(placeNewPlant([], stored({ id: "y", zone: "EAST" })).walk_order).toBe(1);
  });

  it("leaves an unzoned plant exactly as built (same reference, no walk_order key)", () => {
    const built = stored({ id: "x", zone: null });
    expect(placeNewPlant(north, built)).toBe(built);
    expect("walk_order" in placeNewPlant(north, stored({ id: "z" }))).toBe(false);
  });

  it("numbers a batch in order when each new plant is added to the list before the next", () => {
    let plants = [...north];
    const orders = ["a", "b", "c"].map((id) => {
      const placed = placeNewPlant(plants, stored({ id, zone: "NORTH" }));
      plants = [...plants, placed];
      return placed.walk_order;
    });
    expect(orders).toEqual([5, 6, 7]);
  });
});

describe("applyPlantUpdate", () => {
  const store: PlantStore = {
    n1: stored({ id: "n1", zone: "NORTH", walk_order: 1 }),
    n2: stored({ id: "n2", zone: "NORTH", walk_order: 2 }),
    s1: stored({ id: "s1", name: "South one", zone: "SOUTH", walk_order: 1, tag: "S1" }),
  };

  it("applies the editable fields and keeps zone + walk_order when the input has no zone", () => {
    const next = applyPlantUpdate(store, "s1", { name: "Renamed", plant_type: "tree" });
    expect(next).toMatchObject({ id: "s1", name: "Renamed", zone: "SOUTH", walk_order: 1, tag: "S1" });
  });

  it("keeps the position when the zone is re-saved unchanged", () => {
    const next = applyPlantUpdate(store, "s1", { name: "South one", plant_type: "tree", zone: "south" });
    expect(next).toMatchObject({ zone: "SOUTH", walk_order: 1 });
  });

  it("places the plant last in its new zone when the zone changes", () => {
    const next = applyPlantUpdate(store, "s1", { name: "South one", plant_type: "tree", zone: "NORTH" });
    expect(next).toMatchObject({ zone: "NORTH", walk_order: 3 });
  });

  it("clears zone and walk order when the zone is cleared", () => {
    const next = applyPlantUpdate(store, "s1", { name: "South one", plant_type: "tree", zone: "" });
    expect(next).toMatchObject({ zone: null, walk_order: null });
  });

  it("is null for an unknown plant and never mutates the store", () => {
    expect(applyPlantUpdate(store, "nope", { name: "X", plant_type: "tree" })).toBeNull();
    applyPlantUpdate(store, "s1", { name: "X", plant_type: "tree", zone: "NORTH" });
    expect(store.s1).toMatchObject({ zone: "SOUTH", walk_order: 1, name: "South one" });
  });
});

describe("applyWalkOrders", () => {
  const store: PlantStore = {
    a: stored({ id: "a", zone: "N", walk_order: 1 }),
    b: stored({ id: "b", zone: "N", walk_order: 2 }),
    c: stored({ id: "c", zone: "N", walk_order: null }),
  };

  it("writes each plant's new walk order and leaves the rest untouched", () => {
    const next = applyWalkOrders(store, [
      { id: "b", walkOrder: 1 },
      { id: "a", walkOrder: 2 },
      { id: "c", walkOrder: 3 },
    ]);
    expect(next.a.walk_order).toBe(2);
    expect(next.b.walk_order).toBe(1);
    expect(next.c.walk_order).toBe(3);
    expect(next.a).toMatchObject({ zone: "N", name: "Lemon" });
  });

  it("skips unknown ids and invalid orders (non-positive, non-integer) without touching anything else", () => {
    const next = applyWalkOrders(store, [
      { id: "zzz", walkOrder: 1 },
      { id: "a", walkOrder: 0 },
      { id: "b", walkOrder: 1.5 },
      { id: "c", walkOrder: Number.NaN },
    ]);
    expect(next).toEqual(store);
    expect(Object.keys(next)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input store", () => {
    applyWalkOrders(store, [{ id: "a", walkOrder: 9 }]);
    expect(store.a.walk_order).toBe(1);
  });
});

describe("reconcileImportedWalkOrders", () => {
  // The parser's duplicate-order repair keeps the EARLIER created_at, which can
  // be the imported plant — so the merge must clear the collision itself or an
  // import would silently unplace a local tree ("import never overwrites").
  const local = stored({ id: "L1", zone: "NORTH", walk_order: 1, created_at: "2026-08-01T00:00:00Z" });
  const older = stored({ id: "I1", zone: "NORTH", walk_order: 1, created_at: "2026-07-01T00:00:00Z" });

  it("unplaces an imported plant (new id) whose zone + order a local plant holds, keeping its zone", () => {
    const out = reconcileImportedWalkOrders({ L1: local }, { I1: older });
    expect(out.I1).toMatchObject({ zone: "NORTH", walk_order: null });
  });

  it("keeps imported orders that collide with nothing local, in other zones or on free steps", () => {
    const south = stored({ id: "I2", zone: "SOUTH", walk_order: 1 });
    const free = stored({ id: "I3", zone: "NORTH", walk_order: 2 });
    const out = reconcileImportedWalkOrders({ L1: local }, { I2: south, I3: free });
    expect(out.I2.walk_order).toBe(1);
    expect(out.I3.walk_order).toBe(2);
  });

  it("leaves an imported plant with a LOCAL id alone — the merge lets the local copy win", () => {
    const incoming = stored({ id: "L1", zone: "NORTH", walk_order: 1 });
    const out = reconcileImportedWalkOrders({ L1: local }, { L1: incoming });
    expect(out.L1).toBe(incoming);
  });

  it("treats an absent zone and a null zone as one zone", () => {
    const unzonedLocal = stored({ id: "L2", walk_order: 3 });
    const nullZoned = stored({ id: "I4", zone: null, walk_order: 3 });
    expect(reconcileImportedWalkOrders({ L2: unzonedLocal }, { I4: nullZoned }).I4.walk_order).toBeNull();
  });

  it("never mutates its inputs and returns the same store when nothing collides", () => {
    const incoming = { I2: stored({ id: "I2", zone: "SOUTH", walk_order: 1 }) };
    const snapshot = JSON.stringify(incoming);
    expect(reconcileImportedWalkOrders({ L1: local }, incoming)).toBe(incoming);
    reconcileImportedWalkOrders({ L1: local }, { I1: older });
    expect(older.walk_order).toBe(1);
    expect(JSON.stringify(incoming)).toBe(snapshot);
  });
});
