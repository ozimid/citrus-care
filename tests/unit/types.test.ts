import { describe, expect, it } from "vitest";
import type { Tree, Assessment } from "@/app/_lib/types";

describe("type shapes (sanity)", () => {
  it("Tree has required fields", () => {
    const t: Tree = {
      id: "1",
      user_id: "u",
      name: "Meyer Lemon",
      cultivar: "Meyer",
      location: "patio",
      cover_assessment_id: null,
      created_at: new Date().toISOString(),
    };
    expect(t.name).toBe("Meyer Lemon");
  });

  it("Assessment has required fields", () => {
    const a: Assessment = {
      id: "1",
      tree_id: "t",
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
    };
    expect(a.health_score).toBeGreaterThan(0);
  });
});
