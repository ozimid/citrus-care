import { describe, expect, it } from "vitest";
import type { Plant, Assessment } from "@citrus/shared";

describe("type shapes (sanity)", () => {
  it("Plant has required fields", () => {
    const t: Plant = {
      id: "1",
      user_id: "u",
      name: "Meyer Lemon",
      plant_type: "tree",
      species: "Citrus limon",
      cultivar: "Meyer",
      location: "patio",
      zip_code: "94043",
      cover_assessment_id: null,
      created_at: new Date().toISOString(),
    };
    expect(t.name).toBe("Meyer Lemon");
  });

  it("Assessment has required fields", () => {
    const a: Assessment = {
      id: "1",
      plant_id: "t",
      user_id: "u",
      photo_path: "photos/x.jpg",
      created_at: new Date().toISOString(),
      health_score: 72,
      symptoms: [],
      diagnosis: {
        health_score: 72,
        summary: "OK",
        symptoms: [],
        causes: [],
        recommendations: [],
      },
      recommendations: [],
      compared_to_assessment_id: null,
      raw_output: "{}",
      is_cut_care: false,
      cut_health_score: null,
    };
    expect(a.health_score).toBeGreaterThan(0);
  });
});
