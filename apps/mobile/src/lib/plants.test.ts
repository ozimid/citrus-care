import { describe, expect, it } from "vitest";
import type { CareProfile } from "@citrus/shared";
import {
  latestAssessedAt,
  latestScore,
  latestTrend,
  mapPlantRows,
  plantSubLabel,
  PLANTS_SELECT,
  type PlantRow,
} from "./plants";

const PROFILE: CareProfile = {
  base_watering_interval_days: 10,
  water_amount_note: "2L until it drains.",
  sun: "full",
  temp_min_c: 2,
  temp_max_c: 30,
  drought_tolerance: "medium",
  indoor_ok: false,
  notes: "Deep soak then dry back.",
};

function row(overrides: Partial<PlantRow> = {}): PlantRow {
  return {
    id: "plant-1",
    name: "Backyard Meyer",
    plant_type: "tree",
    species: "Citrus × meyeri",
    cultivar: "Meyer Lemon",
    location: "Patio",
    zip_code: "90210",
    care_profile: PROFILE,
    created_at: "2026-07-01T00:00:00Z",
    assessments: [],
    ...overrides,
  };
}

describe("plantSubLabel", () => {
  it("joins type, species, cultivar and location with a middle dot, capitalizing the type", () => {
    expect(plantSubLabel(row())).toBe("Tree · Citrus × meyeri · Meyer Lemon · Patio");
  });

  it("falls back to 'Unknown cultivar' when cultivar is null (matches web PlantCard)", () => {
    expect(plantSubLabel(row({ cultivar: null }))).toBe(
      "Tree · Citrus × meyeri · Unknown cultivar · Patio",
    );
  });

  it("skips null or empty parts entirely", () => {
    expect(plantSubLabel(row({ species: null, location: null }))).toBe("Tree · Meyer Lemon");
  });
});

describe("latestScore", () => {
  it("returns null when there are no assessments", () => {
    expect(latestScore([])).toBeNull();
    expect(latestScore(null)).toBeNull();
    expect(latestScore(undefined)).toBeNull();
  });

  it("returns the single assessment's score", () => {
    expect(latestScore([{ health_score: 82, created_at: "2026-07-10T00:00:00Z" }])).toBe(82);
  });

  it("picks the newest assessment even if rows arrive unordered", () => {
    expect(
      latestScore([
        { health_score: 30, created_at: "2026-06-01T00:00:00Z" },
        { health_score: 77, created_at: "2026-07-10T00:00:00Z" },
        { health_score: 55, created_at: "2026-06-20T00:00:00Z" },
      ]),
    ).toBe(77);
  });
});

describe("latestTrend", () => {
  it("is null when the plant has no assessments", () => {
    expect(latestTrend([])).toBeNull();
    expect(latestTrend(null)).toBeNull();
    expect(latestTrend(undefined)).toBeNull();
  });

  it("labels the latest assessment's comparison delta with the web badge wording", () => {
    expect(
      latestTrend([
        {
          health_score: 82,
          created_at: "2026-07-10T00:00:00Z",
          diagnosis: { comparison: { delta: "better", notes: "n" } },
        },
      ]),
    ).toBe("Better");
  });

  it("uses the newest assessment even when rows arrive unordered", () => {
    expect(
      latestTrend([
        {
          health_score: 40,
          created_at: "2026-06-01T00:00:00Z",
          diagnosis: { comparison: { delta: "worse", notes: "n" } },
        },
        {
          health_score: 82,
          created_at: "2026-07-10T00:00:00Z",
          diagnosis: { comparison: { delta: "same", notes: "n" } },
        },
      ]),
    ).toBe("Same");
  });

  it("says 'First assessment' when the latest has no comparison (nothing prior to compare)", () => {
    expect(latestTrend([{ health_score: 70, created_at: "2026-07-10T00:00:00Z" }])).toBe(
      "First assessment",
    );
    expect(
      latestTrend([{ health_score: 70, created_at: "2026-07-10T00:00:00Z", diagnosis: {} }]),
    ).toBe("First assessment");
  });
});

describe("latestAssessedAt", () => {
  it("is null when the plant was never assessed", () => {
    expect(latestAssessedAt([])).toBeNull();
    expect(latestAssessedAt(null)).toBeNull();
  });

  it("returns the newest assessment's timestamp — the watering anchor of last resort", () => {
    expect(
      latestAssessedAt([
        { health_score: 30, created_at: "2026-06-01T00:00:00Z" },
        { health_score: 77, created_at: "2026-07-10T00:00:00Z" },
      ]),
    ).toBe("2026-07-10T00:00:00Z");
  });
});

describe("mapPlantRows", () => {
  it("maps rows into list items with sub label, latest score, trend and the watering inputs", () => {
    const items = mapPlantRows([
      row({
        assessments: [
          {
            health_score: 91,
            created_at: "2026-07-11T00:00:00Z",
            diagnosis: { comparison: { delta: "better", notes: "n" } },
          },
        ],
      }),
      row({ id: "plant-2", name: "Kitchen Basil", plant_type: "herb", species: null, cultivar: null, location: null, zip_code: null, care_profile: null, assessments: [] }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: "plant-1",
      name: "Backyard Meyer",
      subLabel: "Tree · Citrus × meyeri · Meyer Lemon · Patio",
      latestScore: 91,
      trend: "Better",
      createdAt: "2026-07-01T00:00:00Z",
      location: "Patio",
      zipCode: "90210",
      careProfile: PROFILE,
      lastAssessedAt: "2026-07-11T00:00:00Z",
    });
    expect(items[1].latestScore).toBeNull();
    expect(items[1].trend).toBeNull();
    expect(items[1].subLabel).toBe("Herb · Unknown cultivar");
    expect(items[1].zipCode).toBeNull();
    expect(items[1].careProfile).toBeNull();
    expect(items[1].lastAssessedAt).toBeNull();
  });

  // The jsonb column is untrusted on read (same rule as the stored diagnosis):
  // a profile that no longer parses must mean "no watering guidance", not bad math.
  it("drops a stored care_profile that fails the shared schema", () => {
    const items = mapPlantRows([row({ care_profile: { base_watering_interval_days: 999 } as never })]);
    expect(items[0].careProfile).toBeNull();
  });

  it("returns an empty list for null/undefined data", () => {
    expect(mapPlantRows(null)).toEqual([]);
    expect(mapPlantRows(undefined)).toEqual([]);
  });
});

// Regression: PGRST201 on device — plants↔assessments have TWO relationships
// (assessments.plant_id and plants.cover_assessment_id), so the embed must
// name the FK explicitly or PostgREST rejects the whole query.
describe("PLANTS_SELECT", () => {
  it("disambiguates the assessments embed with the plant_id FK hint", () => {
    expect(PLANTS_SELECT).toContain("assessments!plant_id(");
  });

  it("pulls the embedded diagnosis so cards can show the trend chip", () => {
    const embed = PLANTS_SELECT.slice(PLANTS_SELECT.indexOf("assessments!plant_id("));
    expect(embed).toContain("diagnosis");
  });

  // F20: the list computes each card's watering plan locally, so the query has
  // to carry the ZIP (weather) and the care profile (baseline) with it.
  it("pulls zip_code and care_profile so cards can show the needs-water chip", () => {
    const columns = PLANTS_SELECT.slice(0, PLANTS_SELECT.indexOf("assessments!plant_id("));
    expect(columns).toContain("zip_code");
    expect(columns).toContain("care_profile");
  });
});
