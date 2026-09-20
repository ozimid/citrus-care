import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { mapPlantRows } from "./plants";
import { mapTimelineRows, trendChipLabel } from "./plant-detail";
import type { StoredAssessment } from "./assessment-store";
import type { StoredPlant } from "./plant-store";
import {
  plantDetailRowFromStore,
  plantRowsFromStore,
  timelineRowsFromStore,
} from "./store-adapters";

// D-17 keeps the well-tested PostgREST-shaped mappers (mapPlantRows /
// mapTimelineRows) verbatim and feeds them from the local flat store through
// these adapters. So the real assertion here is end-to-end: adapter output →
// UNCHANGED mapper → the same render-ready result the Supabase path produced.

function diagnosis(overrides: Partial<AssessmentDiagnosis> = {}): AssessmentDiagnosis {
  return {
    health_score: 80,
    summary: "Healthy",
    subject: "leaf",
    symptoms: [],
    causes: [],
    recommendations: [],
    ...overrides,
  };
}

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
    care_profile: null,
    created_at: "2026-07-15T10:00:00Z",
    ...overrides,
  };
}

function assessment(overrides: Partial<StoredAssessment> = {}): StoredAssessment {
  return {
    id: "a1",
    plantId: "p1",
    createdAt: "2026-07-15T10:00:00Z",
    diagnosis: diagnosis(),
    comparedToId: null,
    engine: "on-device",
    ...overrides,
  };
}

describe("plantRowsFromStore → mapPlantRows", () => {
  it("produces the latest score and trend chip from the newest assessment", () => {
    const plants = [plant()];
    const assessments = [
      assessment({ id: "a1", createdAt: "2026-07-10T00:00:00Z", diagnosis: diagnosis({ health_score: 60 }) }),
      assessment({
        id: "a2",
        createdAt: "2026-07-14T00:00:00Z",
        diagnosis: diagnosis({
          health_score: 85,
          comparison: { delta: "better", notes: "greener" },
        }),
      }),
    ];
    const [item] = mapPlantRows(plantRowsFromStore(plants, assessments));
    expect(item.latestScore).toBe(85);
    expect(item.trend).toBe("Better");
    expect(item.lastAssessedAt).toBe("2026-07-14T00:00:00Z");
  });

  it("shows 'First assessment' for a single assessment with no comparison", () => {
    const [item] = mapPlantRows(plantRowsFromStore([plant()], [assessment()]));
    expect(item.trend).toBe("First assessment");
    expect(item.latestScore).toBe(80);
  });

  it("leaves score/trend null for a plant with no assessments", () => {
    const [item] = mapPlantRows(plantRowsFromStore([plant()], []));
    expect(item.latestScore).toBeNull();
    expect(item.trend).toBeNull();
  });

  it("carries the sub-label fields through unchanged", () => {
    const [item] = mapPlantRows(plantRowsFromStore([plant()], []));
    expect(item.subLabel).toBe("Tree · Citrus limon · Eureka · Balcony");
  });
});

describe("timelineRowsFromStore → mapTimelineRows", () => {
  it("orders newest-first and marks the earliest row 'First'", () => {
    const assessments = [
      assessment({ id: "a1", createdAt: "2026-07-10T00:00:00Z" }),
      assessment({
        id: "a2",
        createdAt: "2026-07-14T00:00:00Z",
        diagnosis: diagnosis({ comparison: { delta: "worse", notes: "spots" } }),
      }),
    ];
    const entries = mapTimelineRows(timelineRowsFromStore(assessments, "p1"));
    expect(entries.map((e) => e.id)).toEqual(["a2", "a1"]);
    expect(entries[0].deltaLabel).toBe("Worse");
    expect(entries[1].deltaLabel).toBe("First");
    expect(trendChipLabel(entries)).toBe("Worse");
  });

  it("derives is_cut_care from the model's own subject (F21)", () => {
    const entries = mapTimelineRows(
      timelineRowsFromStore([assessment({ diagnosis: diagnosis({ subject: "cut" }) })], "p1"),
    );
    expect(entries[0].isCutCare).toBe(true);
  });

  it("only includes the requested plant's assessments", () => {
    const store = [assessment({ id: "a1" }), assessment({ id: "b1", plantId: "p2" })];
    expect(timelineRowsFromStore(store, "p1").map((r) => r.id)).toEqual(["a1"]);
  });

  // Two walk photos of one plant in the same second: the timeline must order
  // them the same way the store's anchor/cover logic does (higher id first),
  // whatever order the assessments arrived in.
  it("orders rows with equal createdAt by id, in either input order", () => {
    const t = "2026-08-20T00:00:00Z";
    const ax = assessment({ id: "ax", createdAt: t });
    const ay = assessment({ id: "ay", createdAt: t });
    expect(timelineRowsFromStore([ax, ay], "p1").map((r) => r.id)).toEqual(["ay", "ax"]);
    expect(timelineRowsFromStore([ay, ax], "p1").map((r) => r.id)).toEqual(["ay", "ax"]);
  });
});

describe("plantDetailRowFromStore", () => {
  it("maps a stored plant to the detail row shape the header consumes", () => {
    const row = plantDetailRowFromStore(plant({ zip_code: "10001" }));
    expect(row.id).toBe("p1");
    expect(row.zip_code).toBe("10001");
    expect(row.name).toBe("Lemon");
  });
});

describe("cover assessment id rides through to the list", () => {
  it("plantRowsFromStore carries cover_assessment_id so the card can find its photo", () => {
    const plant: StoredPlant = {
      id: "p1",
      name: "Multiple Trees",
      plant_type: "tree",
      species: null,
      cultivar: null,
      location: null,
      zip_code: null,
      cover_assessment_id: "assess-7",
      care_profile: null,
      created_at: "2026-08-01T00:00:00Z",
    };
    const [row] = plantRowsFromStore([plant], []);
    expect(row.cover_assessment_id).toBe("assess-7");
  });
});

// F39 D-W4: tag / codes / tag_photo / tag_missing ride the same adapters, so
// the picker's tag grid, the card badges and PlantTagsCard read one shape.
describe("F39 identifiers ride through the adapters", () => {
  const D1 = "a".repeat(64);
  const D2 = "b".repeat(64);

  it("plantRowsFromStore carries tag, codes and tag_missing, with defaults for a legacy plant", () => {
    const [tagged, legacy] = plantRowsFromStore(
      [plant({ tag: "L3", codes: [D1], tag_missing: true }), plant({ id: "p2" })],
      [],
    );
    expect(tagged).toMatchObject({ tag: "L3", codes: [D1], tag_missing: true });
    expect(legacy).toMatchObject({ tag: null, codes: [], tag_missing: false });
  });

  it("→ mapPlantRows exposes tag, codes, codeCount and tagMissing on the list item", () => {
    const [item] = mapPlantRows(plantRowsFromStore([plant({ tag: "L3", codes: [D1, D2], tag_missing: true })], []));
    expect(item).toMatchObject({ tag: "L3", codes: [D1, D2], codeCount: 2, tagMissing: true });
    const [plain] = mapPlantRows(plantRowsFromStore([plant()], []));
    expect(plain).toMatchObject({ tag: null, codes: [], codeCount: 0, tagMissing: false });
  });

  it("plantDetailRowFromStore carries tag, codes, tag_photo and tag_missing", () => {
    const row = plantDetailRowFromStore(
      plant({ tag: "L3", codes: [D1], tag_photo: "x1-00000001.jpg", tag_missing: false }),
    );
    expect(row).toMatchObject({ tag: "L3", codes: [D1], tag_photo: "x1-00000001.jpg", tag_missing: false });
    expect(plantDetailRowFromStore(plant())).toMatchObject({ tag: null, codes: [], tag_photo: null, tag_missing: false });
  });
});

// F39 Phase 3b: zone + walk order ride the list adapter so PlantsScreen can
// group by zone and the walk chip can step through the zone's order.
describe("F39 zone + walk order ride through the adapters", () => {
  it("plantRowsFromStore carries zone and walk_order, null for a legacy plant", () => {
    const [zoned, legacy] = plantRowsFromStore(
      [plant({ zone: "NORTH", walk_order: 3 }), plant({ id: "p2" })],
      [],
    );
    expect(zoned).toMatchObject({ zone: "NORTH", walk_order: 3 });
    expect(legacy).toMatchObject({ zone: null, walk_order: null });
  });

  it("→ mapPlantRows exposes zone and walkOrder on the list item", () => {
    const [item] = mapPlantRows(plantRowsFromStore([plant({ zone: "NORTH", walk_order: 3 })], []));
    expect(item).toMatchObject({ zone: "NORTH", walkOrder: 3 });
    const [plain] = mapPlantRows(plantRowsFromStore([plant()], []));
    expect(plain).toMatchObject({ zone: null, walkOrder: null });
  });

  it("plantDetailRowFromStore carries zone and walk_order so the edit sheet can prefill the zone", () => {
    expect(plantDetailRowFromStore(plant({ zone: "NORTH", walk_order: 3 }))).toMatchObject({ zone: "NORTH", walk_order: 3 });
    expect(plantDetailRowFromStore(plant())).toMatchObject({ zone: null, walk_order: null });
  });
});
