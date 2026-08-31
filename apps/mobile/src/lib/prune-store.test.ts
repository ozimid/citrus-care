import { describe, expect, it } from "vitest";
import {
  PRUNE_STORAGE_KEY,
  cutProgress,
  latestPlanForPlant,
  parsePruneStore,
  plansForPlant,
  removePlantPlans,
  serializePruneStore,
  toggleCutDone,
  upsertPrunePlan,
  type StoredPrunePlan,
} from "./prune-store";

function stored(overrides: Partial<StoredPrunePlan> = {}): StoredPrunePlan {
  return {
    id: "plan-1",
    plantId: "plant-1",
    createdAt: "2026-08-31T10:00:00.000Z",
    photoUri: "file:///docs/photos/plant-1/a.jpg",
    photoAspect: 0.75,
    ruleClass: "rose",
    doneCuts: [],
    plan: {
      summary: "Two crossing canes.",
      cuts: [
        { label: "Crossing cane", action: "Cut here", reason: "Rubs", priority: 1, x: 30, y: 40 },
        { label: "Dead tip", action: "Cut back", reason: "Dieback", priority: 2, x: 70, y: 20 },
      ],
      general_steps: [],
    },
    ...overrides,
  };
}

describe("prune store", () => {
  it("returns a plant's plans newest-first and isolates other plants", () => {
    let store = upsertPrunePlan({}, stored({ id: "old", createdAt: "2026-08-01T10:00:00.000Z" }));
    store = upsertPrunePlan(store, stored({ id: "new", createdAt: "2026-08-30T10:00:00.000Z" }));
    store = upsertPrunePlan(store, stored({ id: "other", plantId: "plant-2" }));

    expect(plansForPlant(store, "plant-1").map((p) => p.id)).toEqual(["new", "old"]);
    expect(latestPlanForPlant(store, "plant-1")?.id).toBe("new");
    expect(latestPlanForPlant(store, "plant-3")).toBeNull();
  });

  it("does not mutate the store it is given", () => {
    const before = upsertPrunePlan({}, stored());
    const snapshot = JSON.parse(JSON.stringify(before));
    upsertPrunePlan(before, stored({ id: "plan-2" }));
    toggleCutDone(before, "plan-1", 0);
    expect(before).toEqual(snapshot);
  });

  it("drops a plant's plans on cascade delete", () => {
    let store = upsertPrunePlan({}, stored());
    store = upsertPrunePlan(store, stored({ id: "other", plantId: "plant-2" }));
    const next = removePlantPlans(store, "plant-1");
    expect(plansForPlant(next, "plant-1")).toEqual([]);
    expect(plansForPlant(next, "plant-2")).toHaveLength(1);
  });
});

describe("ticking cuts off in the garden", () => {
  it("marks a cut done and unmarks it again", () => {
    const store = upsertPrunePlan({}, stored());
    const done = toggleCutDone(store, "plan-1", 1);
    expect(done["plan-1"].doneCuts).toEqual([1]);
    expect(toggleCutDone(done, "plan-1", 1)["plan-1"].doneCuts).toEqual([]);
  });

  it("keeps done cuts sorted and free of duplicates", () => {
    let store = upsertPrunePlan({}, stored());
    store = toggleCutDone(store, "plan-1", 1);
    store = toggleCutDone(store, "plan-1", 0);
    expect(store["plan-1"].doneCuts).toEqual([0, 1]);
  });

  it("ignores an index that isn't a cut in this plan", () => {
    const store = upsertPrunePlan({}, stored());
    expect(toggleCutDone(store, "plan-1", 7)["plan-1"].doneCuts).toEqual([]);
    expect(toggleCutDone(store, "plan-1", -1)["plan-1"].doneCuts).toEqual([]);
  });

  it("ignores an unknown plan id", () => {
    const store = upsertPrunePlan({}, stored());
    expect(toggleCutDone(store, "nope", 0)).toEqual(store);
  });

  it("reports progress for the header", () => {
    const store = toggleCutDone(upsertPrunePlan({}, stored()), "plan-1", 0);
    expect(cutProgress(store["plan-1"])).toEqual({ done: 1, total: 2 });
  });
});

describe("prune store persistence (untrusted on read)", () => {
  it("round-trips", () => {
    const store = upsertPrunePlan({}, stored());
    expect(parsePruneStore(serializePruneStore(store))).toEqual(store);
  });

  it("degrades to an empty store for null, junk and arrays", () => {
    expect(parsePruneStore(null)).toEqual({});
    expect(parsePruneStore("nope{")).toEqual({});
    expect(parsePruneStore("[1,2]")).toEqual({});
  });

  it("drops malformed records and keeps the valid ones", () => {
    const raw = JSON.stringify({
      good: stored({ id: "good" }),
      "no-photo": { ...stored({ id: "no-photo" }), photoUri: 42 },
      "no-plan": { ...stored({ id: "no-plan" }), plan: null },
      "no-cuts-array": { ...stored({ id: "no-cuts-array" }), plan: { summary: "x", cuts: "many" } },
      "good-2": stored({ id: "good-2" }),
    });
    expect(Object.keys(parsePruneStore(raw)).sort()).toEqual(["good", "good-2"]);
  });

  it("repairs a missing or malformed doneCuts list rather than dropping the plan", () => {
    const raw = JSON.stringify({
      a: { ...stored({ id: "a" }), doneCuts: undefined },
      b: { ...stored({ id: "b" }), doneCuts: "0,1" },
      c: { ...stored({ id: "c" }), doneCuts: [0, "x", 99, 1] },
    });
    const store = parsePruneStore(raw);
    expect(store.a.doneCuts).toEqual([]);
    expect(store.b.doneCuts).toEqual([]);
    expect(store.c.doneCuts).toEqual([0, 1]);
  });

  it("repairs a missing or nonsense photo aspect to a square rather than dropping the plan", () => {
    // Markers are percentages of the PHOTO, so the aspect ratio is what keeps
    // them over the right branch — a bad one must degrade, not misplace.
    const raw = JSON.stringify({
      a: { ...stored({ id: "a" }), photoAspect: undefined },
      b: { ...stored({ id: "b" }), photoAspect: 0 },
      c: { ...stored({ id: "c" }), photoAspect: "wide" },
      d: { ...stored({ id: "d" }), photoAspect: 1.7778 },
    });
    const store = parsePruneStore(raw);
    expect(store.a.photoAspect).toBe(1);
    expect(store.b.photoAspect).toBe(1);
    expect(store.c.photoAspect).toBe(1);
    expect(store.d.photoAspect).toBeCloseTo(1.7778);
  });

  it("names its storage key so a rename is a deliberate migration", () => {
    expect(PRUNE_STORAGE_KEY).toBe("citrus.prune-plans.v1");
  });
});
