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
});

describe("plantDetailRowFromStore", () => {
  it("maps a stored plant to the detail row shape the header consumes", () => {
    const row = plantDetailRowFromStore(plant({ zip_code: "10001" }));
    expect(row.id).toBe("p1");
    expect(row.zip_code).toBe("10001");
    expect(row.name).toBe("Lemon");
  });
});
