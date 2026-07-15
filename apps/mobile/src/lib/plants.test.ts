import { describe, expect, it } from "vitest";
import { latestScore, mapPlantRows, plantSubLabel, type PlantRow } from "./plants";

function row(overrides: Partial<PlantRow> = {}): PlantRow {
  return {
    id: "plant-1",
    name: "Backyard Meyer",
    plant_type: "tree",
    species: "Citrus × meyeri",
    cultivar: "Meyer Lemon",
    location: "Patio",
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

describe("mapPlantRows", () => {
  it("maps rows into list items with sub label and latest score", () => {
    const items = mapPlantRows([
      row({ assessments: [{ health_score: 91, created_at: "2026-07-11T00:00:00Z" }] }),
      row({ id: "plant-2", name: "Kitchen Basil", plant_type: "herb", species: null, cultivar: null, location: null, assessments: [] }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: "plant-1",
      name: "Backyard Meyer",
      subLabel: "Tree · Citrus × meyeri · Meyer Lemon · Patio",
      latestScore: 91,
      createdAt: "2026-07-01T00:00:00Z",
    });
    expect(items[1].latestScore).toBeNull();
    expect(items[1].subLabel).toBe("Herb · Unknown cultivar");
  });

  it("returns an empty list for null/undefined data", () => {
    expect(mapPlantRows(null)).toEqual([]);
    expect(mapPlantRows(undefined)).toEqual([]);
  });
});
