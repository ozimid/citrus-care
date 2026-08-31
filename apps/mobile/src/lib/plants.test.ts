import { describe, expect, it } from "vitest";
import type { CareProfile } from "@citrus/shared";
import {
  attachCoverPhotos,
  latestAssessedAt,
  latestScore,
  latestTrend,
  mapPlantRows,
  plantSubLabel,
  type PlantRow,
} from "./plants";
import type { PhotoIndex } from "./photo-store";

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
      coverAssessmentId: null,
      coverUri: null,
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

// The dashboard card carries the plant's photo — the difference between a row
// that says "Multiple Trees" and one that shows you which trees those are.
describe("attachCoverPhotos", () => {
  const INDEX: PhotoIndex = {
    "assess-old": {
      localUri: "file:///photos/plant-1/old.jpg",
      plantId: "plant-1",
      engine: "on-device",
      createdAt: "2026-07-01T00:00:00Z",
    },
    "assess-new": {
      localUri: "file:///photos/plant-1/new.jpg",
      plantId: "plant-1",
      engine: "on-device",
      createdAt: "2026-08-01T00:00:00Z",
    },
    "assess-other": {
      localUri: "file:///photos/plant-2/other.jpg",
      plantId: "plant-2",
      engine: "on-device",
      createdAt: "2026-08-15T00:00:00Z",
    },
  };

  function item(overrides: Partial<PlantRow> = {}) {
    return mapPlantRows([row(overrides)])[0];
  }

  it("uses the plant's cover assessment's photo when it has one on this phone", () => {
    const [withCover] = attachCoverPhotos([item({ cover_assessment_id: "assess-old" })], INDEX);
    expect(withCover.coverUri).toBe("file:///photos/plant-1/old.jpg");
  });

  it("falls back to the plant's NEWEST photo when the cover has no local file", () => {
    // Pre-cover rows and restores land here: cover id points nowhere, but the
    // phone still has photos of this plant — show the latest, not nothing.
    const [fallback] = attachCoverPhotos([item({ cover_assessment_id: "assess-gone" })], INDEX);
    expect(fallback.coverUri).toBe("file:///photos/plant-1/new.jpg");
    const [noCover] = attachCoverPhotos([item({ cover_assessment_id: null })], INDEX);
    expect(noCover.coverUri).toBe("file:///photos/plant-1/new.jpg");
  });

  it("never borrows another plant's photo", () => {
    const [lonely] = attachCoverPhotos([item({ id: "plant-3", cover_assessment_id: null })], INDEX);
    expect(lonely.coverUri).toBeNull();
  });

  it("is null (placeholder) with an empty index and leaves items otherwise untouched", () => {
    const source = item();
    const [attached] = attachCoverPhotos([source], {});
    expect(attached.coverUri).toBeNull();
    expect(attached.name).toBe(source.name);
    // Pure: the input item was not mutated.
    expect("coverUri" in source ? source.coverUri : null).toBeNull();
  });
});
