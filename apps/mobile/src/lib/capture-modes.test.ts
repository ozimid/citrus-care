import { describe, expect, it } from "vitest";
import {
  CAPTURE_HINT,
  SNAP_TIPS,
  SNAP_TIPS_SEEN_KEY,
  WALK_MODE_KEY,
  filterPlantsByQuery,
  preselectedPlantId,
} from "./capture-modes";
import type { PlantListItem } from "./plants";

// F21 deleted the three capture modes: classifying the photo was the user's
// job only because the prompt branched on it, and it manufactured false
// negatives (a tree shot in "Leaf" mode came back as "poor quality"). What
// survives is the photo-quality nudge the capture research earned — one hint,
// no classification.
describe("CAPTURE_HINT", () => {
  it("nudges for a close, filled frame without asking what the subject is", () => {
    // F35: the framing square was removed (it read as a crop preview and lied —
    // nothing is cropped). The hint now carries the guidance and the honesty.
    expect(CAPTURE_HINT).toMatch(/good light/i);
    expect(CAPTURE_HINT).toMatch(/whole photo|nothing gets cropped/i);
    expect(CAPTURE_HINT).not.toMatch(/leaf|whole plant|cut/i);
  });
});

describe("preselectedPlantId", () => {
  it("preselects the plant when the user has exactly one", () => {
    expect(preselectedPlantId([{ id: "p1" }])).toBe("p1");
  });

  it("forces an explicit choice when there are several", () => {
    expect(preselectedPlantId([{ id: "p1" }, { id: "p2" }])).toBeNull();
  });

  it("selects nothing when there are no plants", () => {
    expect(preselectedPlantId([])).toBeNull();
  });

  it("prefers an explicitly requested plant (detail screen's 'Assess this plant')", () => {
    expect(preselectedPlantId([{ id: "p1" }, { id: "p2" }], "p2")).toBe("p2");
  });

  it("ignores a preferred id that is not in the list", () => {
    expect(preselectedPlantId([{ id: "p1" }, { id: "p2" }], "p9")).toBeNull();
  });
});

// F36 (competitor-inspired): a one-time photo guide replaces the teaching the
// removed framing square never did. Content must stay honest (no cloud talk)
// and grounded in what actually helps the on-device model.
describe("SNAP_TIPS", () => {
  it("has three tips, each with glyph, title and body", () => {
    expect(SNAP_TIPS).toHaveLength(3);
    for (const tip of SNAP_TIPS) {
      expect(tip.glyph.length).toBeGreaterThan(0);
      expect(tip.title.length).toBeGreaterThan(0);
      expect(tip.body.length).toBeGreaterThan(10);
    }
  });

  it("covers the three things that matter: closeness, light, no cropping", () => {
    const all = SNAP_TIPS.map((t) => `${t.title} ${t.body}`).join(" ");
    expect(all).toMatch(/close/i);
    expect(all).toMatch(/light/i);
    expect(all).toMatch(/whole photo|not.*cropped|nothing.*cropped/i);
    expect(all).not.toMatch(/gemini|cloud|upload/i);
  });

  it("seen-flag key follows the store convention", () => {
    expect(SNAP_TIPS_SEEN_KEY).toBe("citrus.snap-tips-seen.v1");
  });
});

// F39 (Garden Walk): the plant picker gains a search field and a numeric-aware
// order, because a garden of thirty numbered trees is browsed as "L2, L3, L10",
// not "L10, L2, L3".
describe("filterPlantsByQuery", () => {
  function plant(id: string, name: string, extra: Partial<PlantListItem> = {}): PlantListItem {
    return {
      id,
      name,
      plantType: "tree",
      species: null,
      subLabel: "Tree · Unknown cultivar",
      latestScore: null,
      trend: null,
      createdAt: "2026-09-19T00:00:00.000Z",
      location: null,
      zipCode: null,
      careProfile: null,
      lastAssessedAt: null,
      coverAssessmentId: null,
      coverUri: null,
      tag: null,
      codes: [],
      codeCount: 0,
      tagMissing: false,
      zone: null,
      walkOrder: null,
      ...extra,
    };
  }
  const plants = [
    plant("a", "L10"),
    plant("b", "L2", { species: "Meyer lemon" }),
    plant("c", "Lime tree", { subLabel: "Tree · Lime · Patio" }),
    plant("d", "L3"),
    plant("e", "orange", { species: "Citrus sinensis" }),
  ];

  it("returns every plant in numeric-aware name order for an empty query", () => {
    expect(filterPlantsByQuery(plants, "").map((p) => p.name)).toEqual(["L2", "L3", "L10", "Lime tree", "orange"]);
    expect(filterPlantsByQuery(plants, "   ").map((p) => p.name)).toEqual(["L2", "L3", "L10", "Lime tree", "orange"]);
  });

  it("matches on name, species or sub-label, case-insensitively, keeping the order", () => {
    expect(filterPlantsByQuery(plants, "tree").map((p) => p.name)).toEqual(["L2", "L3", "L10", "Lime tree", "orange"]);
    expect(filterPlantsByQuery(plants, "l1").map((p) => p.name)).toEqual(["L10"]);
    expect(filterPlantsByQuery(plants, "MEYER").map((p) => p.name)).toEqual(["L2"]);
    expect(filterPlantsByQuery(plants, "patio").map((p) => p.name)).toEqual(["Lime tree"]);
    expect(filterPlantsByQuery(plants, "sinensis").map((p) => p.name)).toEqual(["orange"]);
    expect(filterPlantsByQuery(plants, "zzz")).toEqual([]);
  });

  it("does not mutate the list it is given", () => {
    const before = plants.map((p) => p.id);
    filterPlantsByQuery(plants, "");
    expect(plants.map((p) => p.id)).toEqual(before);
  });

  // F39 D-W4: the human tag is co-primary, so typing a stake number must land
  // on that plant first — exact tag, then tag prefix, then the old contains
  // match on name / species / sub-label.
  describe("tag ranking", () => {
    const tagged = [
      plant("a", "Meyer lemon", { tag: "3" }),
      plant("b", "Lime", { tag: "30" }),
      plant("c", "Orange", { tag: "13" }),
      plant("d", "Tree 3 by the gate"),
      plant("e", "Kumquat", { tag: "L3" }),
    ];

    it("puts the exact tag first, tag prefixes next, then contains matches in name order", () => {
      expect(filterPlantsByQuery(tagged, "3").map((p) => p.name)).toEqual([
        "Meyer lemon",
        "Lime",
        "Kumquat",
        "Orange",
        "Tree 3 by the gate",
      ]);
    });

    it("matches tags case-insensitively and ignores surrounding whitespace", () => {
      expect(filterPlantsByQuery(tagged, " l3 ").map((p) => p.name)).toEqual(["Kumquat"]);
      expect(filterPlantsByQuery(tagged, "1").map((p) => p.name)).toEqual(["Orange"]);
    });

    it("orders the prefix group numerically, the way the tags read on the stakes", () => {
      const rows = [
        plant("a", "D", { tag: "21" }),
        plant("b", "C", { tag: "2" }),
        plant("c", "B", { tag: "20" }),
        plant("d", "A", { tag: "200" }),
      ];
      expect(filterPlantsByQuery(rows, "2").map((p) => p.tag)).toEqual(["2", "20", "21", "200"]);
    });

    it("leaves the empty-query listing in numeric-aware name order, tags or not", () => {
      expect(filterPlantsByQuery(tagged, "").map((p) => p.name)).toEqual([
        "Kumquat",
        "Lime",
        "Meyer lemon",
        "Orange",
        "Tree 3 by the gate",
      ]);
    });
  });
});

// F39 D-W7: walk mode is a REMEMBERED viewfinder toggle (default off) — its
// key follows the store convention so the -io half and the backup exclusion
// list can name it.
describe("WALK_MODE_KEY", () => {
  it("follows the store key convention", () => {
    expect(WALK_MODE_KEY).toBe("citrus.capture-walk.v1");
  });
});
