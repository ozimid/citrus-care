import { describe, expect, it } from "vitest";
import {
  bulkPlantDrafts,
  groupByZone,
  nextInWalk,
  prevInWalk,
  reorderWalk,
  sortByStaleness,
} from "./walk-order";

// F39 Phase 3b (docs/design/garden-walk.md §4, research §4): a stored walk
// order RANKS plants and never COMMITS a photo — one plant in focus, N shots,
// an explicit tap to advance. These helpers only answer "which plant is next
// / previous / first" and how the list is grouped; nothing here assigns a
// photo, so nothing here can misattribute one.

interface Item {
  id: string;
  name: string;
  zone?: string | null;
  walkOrder?: number | null;
}

function item(id: string, name: string, zone: string | null = null, walkOrder: number | null = null): Item {
  return { id, name, zone, walkOrder };
}

describe("groupByZone", () => {
  it("orders zones numeric-aware and puts unzoned plants LAST as zone null", () => {
    const groups = groupByZone([
      item("a", "Lime", "ROW 10", 1),
      item("b", "Lemon", null),
      item("c", "Orange", "ROW 2", 1),
      item("d", "Kumquat", "NORTH", 1),
    ]);
    expect(groups.map((g) => g.zone)).toEqual(["NORTH", "ROW 2", "ROW 10", null]);
    expect(groups[3].items.map((i) => i.id)).toEqual(["b"]);
  });

  it("orders plants within a zone by walkOrder ascending, nulls last, then name", () => {
    const groups = groupByZone([
      item("z", "Zed", "N", null),
      item("b", "Bee", "N", 2),
      item("y", "Aye", "N", null),
      item("a", "Ay", "N", 1),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b", "y", "z"]);
  });

  it("treats an empty-string zone as unzoned and omits the null group when everyone is zoned", () => {
    expect(groupByZone([item("a", "A", ""), item("b", "B", "N", 1)]).map((g) => g.zone)).toEqual(["N", null]);
    expect(groupByZone([item("b", "B", "N", 1)]).map((g) => g.zone)).toEqual(["N"]);
    expect(groupByZone([])).toEqual([]);
  });

  it("does not mutate the input", () => {
    const items = [item("b", "B", "N", 2), item("a", "A", "N", 1)];
    groupByZone(items);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("nextInWalk / prevInWalk", () => {
  const garden = [
    item("n2", "North 2", "NORTH", 2),
    item("n1", "North 1", "NORTH", 1),
    item("n3", "North 3", "NORTH", 3),
    item("s1", "South 1", "SOUTH", 1),
    item("u", "Unzoned", null),
  ];

  it("advances within the current plant's zone and wraps at the end", () => {
    expect(nextInWalk(garden, "n1")).toBe("n2");
    expect(nextInWalk(garden, "n2")).toBe("n3");
    expect(nextInWalk(garden, "n3")).toBe("n1");
    expect(nextInWalk(garden, "s1")).toBe("s1");
  });

  it("goes back within the zone and wraps at the start", () => {
    expect(prevInWalk(garden, "n3")).toBe("n2");
    expect(prevInWalk(garden, "n2")).toBe("n1");
    expect(prevInWalk(garden, "n1")).toBe("n3");
  });

  it("returns the first plant of the first zone when nothing is selected", () => {
    expect(nextInWalk(garden, null)).toBe("n1");
    expect(prevInWalk(garden, null)).toBe("n1");
  });

  it("returns the first plant of the first zone when the selected plant is not in the list", () => {
    expect(nextInWalk(garden, "deleted")).toBe("n1");
    expect(prevInWalk(garden, "deleted")).toBe("n1");
  });

  it("is null with no plants", () => {
    expect(nextInWalk([], null)).toBeNull();
    expect(nextInWalk([], "n1")).toBeNull();
    expect(prevInWalk([], null)).toBeNull();
  });

  it("walks unzoned plants as their own group, by name", () => {
    const unzoned = [item("b", "Bee"), item("a", "Ay"), item("c", "Cee")];
    expect(nextInWalk(unzoned, null)).toBe("a");
    expect(nextInWalk(unzoned, "a")).toBe("b");
    expect(nextInWalk(unzoned, "c")).toBe("a");
    expect(prevInWalk(unzoned, "a")).toBe("c");
  });
});

describe("sortByStaleness", () => {
  const items = [
    { id: "fresh", name: "Fresh", lastAssessedAt: "2026-09-18T00:00:00Z" },
    { id: "never-b", name: "Bee", lastAssessedAt: null },
    { id: "old", name: "Old", lastAssessedAt: "2026-06-01T00:00:00Z" },
    { id: "never-a", name: "Ay", lastAssessedAt: null },
    { id: "mid", name: "Mid", lastAssessedAt: "2026-08-01T00:00:00Z" },
  ];

  it("puts never-assessed plants first (by name), then the oldest assessment first", () => {
    expect(sortByStaleness(items).map((i) => i.id)).toEqual(["never-a", "never-b", "old", "mid", "fresh"]);
  });

  it("breaks an equal lastAssessedAt by name and does not mutate the input", () => {
    const tied = [
      { id: "b", name: "Bee", lastAssessedAt: "2026-08-01T00:00:00Z" },
      { id: "a", name: "Ay", lastAssessedAt: "2026-08-01T00:00:00Z" },
    ];
    expect(sortByStaleness(tied).map((i) => i.id)).toEqual(["a", "b"]);
    expect(tied.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("bulkPlantDrafts", () => {
  it("expands a {n} pattern, zero-padded to the width of the count", () => {
    expect(bulkPlantDrafts("A-{n}", 3, new Set())).toEqual(["A-1", "A-2", "A-3"]);
    const thirty = bulkPlantDrafts("A-{n}", 30, new Set());
    expect(thirty).toHaveLength(30);
    expect(thirty[0]).toBe("A-01");
    expect(thirty[9]).toBe("A-10");
    expect(thirty[29]).toBe("A-30");
    expect(new Set(thirty).size).toBe(30);
  });

  it("treats a plain prefix as '<prefix>-{n}' and an empty pattern as 'Plant {n}'", () => {
    expect(bulkPlantDrafts("A", 2, new Set())).toEqual(["A-1", "A-2"]);
    expect(bulkPlantDrafts("  Row B  ", 2, new Set())).toEqual(["Row B-1", "Row B-2"]);
    expect(bulkPlantDrafts("", 2, new Set())).toEqual(["Plant 1", "Plant 2"]);
  });

  it("puts {n} anywhere in the pattern, more than once", () => {
    expect(bulkPlantDrafts("{n} north", 2, new Set())).toEqual(["1 north", "2 north"]);
    expect(bulkPlantDrafts("T{n}-{n}", 1, new Set())).toEqual(["T1-1"]);
  });

  it("skips names already taken (case-insensitive) and still returns the requested count", () => {
    expect(bulkPlantDrafts("A-{n}", 3, new Set(["a-2"]))).toEqual(["A-1", "A-3", "A-4"]);
    expect(bulkPlantDrafts("A-{n}", 2, new Set(["A-01", "A-1", "A-2"]))).toEqual(["A-3", "A-4"]);
  });

  it("caps the count at 50 and returns nothing for a non-positive or non-finite count", () => {
    expect(bulkPlantDrafts("A-{n}", 500, new Set())).toHaveLength(50);
    expect(bulkPlantDrafts("A-{n}", 50, new Set())[49]).toBe("A-50");
    expect(bulkPlantDrafts("A-{n}", 0, new Set())).toEqual([]);
    expect(bulkPlantDrafts("A-{n}", -3, new Set())).toEqual([]);
    expect(bulkPlantDrafts("A-{n}", Number.NaN, new Set())).toEqual([]);
    expect(bulkPlantDrafts("A-{n}", 2.7, new Set())).toEqual(["A-1", "A-2"]);
  });
});

describe("reorderWalk", () => {
  const zone = [
    { id: "b", walkOrder: 2 },
    { id: "a", walkOrder: 1 },
    { id: "c", walkOrder: 3 },
  ];

  it("moves an item down and renumbers the whole zone 1..n", () => {
    expect(reorderWalk(zone, "a", "down")).toEqual([
      { id: "b", walkOrder: 1 },
      { id: "a", walkOrder: 2 },
      { id: "c", walkOrder: 3 },
    ]);
  });

  it("moves an item up", () => {
    expect(reorderWalk(zone, "c", "up")).toEqual([
      { id: "a", walkOrder: 1 },
      { id: "c", walkOrder: 2 },
      { id: "b", walkOrder: 3 },
    ]);
  });

  it("moving the first item up (or the last down) is a no-op apart from renumbering", () => {
    const renumbered = [
      { id: "a", walkOrder: 1 },
      { id: "b", walkOrder: 2 },
      { id: "c", walkOrder: 3 },
    ];
    expect(reorderWalk(zone, "a", "up")).toEqual(renumbered);
    expect(reorderWalk(zone, "c", "down")).toEqual(renumbered);
  });

  it("closes gaps and places unordered items last (input order kept among them)", () => {
    const sparse = [
      { id: "x", walkOrder: null },
      { id: "b", walkOrder: 7 },
      { id: "y" },
      { id: "a", walkOrder: 3 },
    ];
    expect(reorderWalk(sparse, "y", "up")).toEqual([
      { id: "a", walkOrder: 1 },
      { id: "b", walkOrder: 2 },
      { id: "y", walkOrder: 3 },
      { id: "x", walkOrder: 4 },
    ]);
  });

  it("renumbers without moving when the id is not in the zone, and is empty for an empty zone", () => {
    expect(reorderWalk(zone, "nope", "up").map((u) => u.id)).toEqual(["a", "b", "c"]);
    expect(reorderWalk([], "a", "up")).toEqual([]);
  });

  it("does not mutate the input", () => {
    reorderWalk(zone, "a", "down");
    expect(zone.map((z) => z.id)).toEqual(["b", "a", "c"]);
  });
});
