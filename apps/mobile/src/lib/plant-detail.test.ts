import { describe, expect, it } from "vitest";
import {
  comparisonDelta,
  formatTimelineDate,
  mapTimelineRows,
  parseTimelineDiagnosis,
  photoUri,
  PLANT_DETAIL_SELECT,
  sliderPair,
  TIMELINE_SELECT,
  trendChipLabel,
  type TimelineRow,
} from "./plant-detail";

// Reverse-chron fixture, the order the timeline query returns rows in:
// newest first, the plant's very first assessment last.
function rows(): TimelineRow[] {
  return [
    {
      id: "a3",
      created_at: "2026-07-10T09:00:00Z",
      health_score: 82,
      photo_path: "u1/p1/3.jpg",
      is_cut_care: false,
      diagnosis: { summary: "Recovering well", comparison: { delta: "better", notes: "n" } },
    },
    {
      id: "a2",
      created_at: "2026-06-26T09:00:00Z",
      health_score: 61,
      photo_path: "u1/p1/2.jpg",
      is_cut_care: false,
      diagnosis: { summary: "About the same", comparison: { delta: "same", notes: "n" } },
    },
    {
      id: "a1",
      created_at: "2026-06-12T09:00:00Z",
      health_score: 58,
      photo_path: "u1/p1/1.jpg",
      is_cut_care: true,
      diagnosis: { summary: "Early chlorosis" },
    },
  ];
}

describe("select constants", () => {
  it("pulls zip_code for the quarantine check", () => {
    expect(PLANT_DETAIL_SELECT).toContain("zip_code");
  });

  it("pulls the timeline columns the web detail page uses, plus is_cut_care for row taps", () => {
    for (const col of ["id", "created_at", "health_score", "photo_path", "diagnosis", "is_cut_care"]) {
      expect(TIMELINE_SELECT).toContain(col);
    }
  });
});

describe("formatTimelineDate", () => {
  it("formats as 'Mon D, YYYY' (UTC, deterministic)", () => {
    expect(formatTimelineDate("2026-06-12T09:00:00Z")).toBe("Jun 12, 2026");
    expect(formatTimelineDate("2026-01-01T00:00:00Z")).toBe("Jan 1, 2026");
  });
});

describe("comparisonDelta", () => {
  it("extracts a valid delta from the diagnosis jsonb", () => {
    expect(comparisonDelta({ comparison: { delta: "worse" } })).toBe("worse");
  });

  it("returns null for missing, malformed, or unexpected values (jsonb is untrusted)", () => {
    expect(comparisonDelta(null)).toBeNull();
    expect(comparisonDelta({})).toBeNull();
    expect(comparisonDelta({ comparison: "yes" })).toBeNull();
    expect(comparisonDelta({ comparison: { delta: "bogus" } })).toBeNull();
  });
});

describe("mapTimelineRows", () => {
  it("labels deltas with the web badge wording, and the earliest row as First", () => {
    const entries = mapTimelineRows(rows());
    expect(entries.map((e) => e.deltaLabel)).toEqual(["Better", "Same", "First"]);
    expect(entries.map((e) => e.delta)).toEqual(["better", "same", null]);
  });

  it("maps score, photo path, cut flag, summary and date label", () => {
    const [latest, , first] = mapTimelineRows(rows());
    expect(latest.score).toBe(82);
    expect(latest.photoPath).toBe("u1/p1/3.jpg");
    expect(latest.summary).toBe("Recovering well");
    expect(latest.dateLabel).toBe("Jul 10, 2026");
    expect(latest.isCutCare).toBe(false);
    expect(first.isCutCare).toBe(true);
  });

  it("shows no chip for a middle row without a comparison (older data)", () => {
    const [newest, middle] = rows();
    delete (middle.diagnosis as { comparison?: unknown }).comparison;
    const entries = mapTimelineRows([newest, middle, rows()[2]]);
    expect(entries[1].deltaLabel).toBeNull();
  });

  it("tolerates null diagnosis and null is_cut_care", () => {
    const entries = mapTimelineRows([{ ...rows()[0], diagnosis: null, is_cut_care: null }]);
    expect(entries[0].summary).toBe("");
    expect(entries[0].isCutCare).toBe(false);
  });

  it("returns [] for null/undefined data", () => {
    expect(mapTimelineRows(null)).toEqual([]);
    expect(mapTimelineRows(undefined)).toEqual([]);
  });
});

describe("trendChipLabel", () => {
  it("is the latest assessment's delta label", () => {
    expect(trendChipLabel(mapTimelineRows(rows()))).toBe("Better");
  });

  it("is 'First assessment' when the plant has exactly one", () => {
    expect(trendChipLabel(mapTimelineRows([rows()[2]]))).toBe("First assessment");
  });

  it("is null with no assessments, or when the latest of several has no delta", () => {
    expect(trendChipLabel([])).toBeNull();
    const [newest, , first] = rows();
    delete (newest.diagnosis as { comparison?: unknown }).comparison;
    expect(trendChipLabel(mapTimelineRows([newest, first]))).toBeNull();
  });
});

describe("sliderPair", () => {
  it("pairs the oldest photo (before) with the newest (after) when 2+ assessments exist", () => {
    const pair = sliderPair(mapTimelineRows(rows()));
    expect(pair?.before.id).toBe("a1");
    expect(pair?.after.id).toBe("a3");
  });

  it("is null with fewer than two assessments", () => {
    expect(sliderPair(mapTimelineRows([rows()[0]]))).toBeNull();
    expect(sliderPair([])).toBeNull();
  });
});

describe("photoUri", () => {
  it("builds the authorized read-proxy URL with an encoded path", () => {
    expect(photoUri("http://192.168.1.205:3002/api", "u1/p1/a b.jpg")).toBe(
      "http://192.168.1.205:3002/api/photos?path=u1%2Fp1%2Fa%20b.jpg",
    );
  });
});

describe("parseTimelineDiagnosis", () => {
  const valid = {
    health_score: 82,
    summary: "Recovering well",
    symptoms: [],
    causes: [],
    recommendations: [],
  };

  it("parses a valid stored diagnosis with the shared schema", () => {
    expect(parseTimelineDiagnosis(valid)?.health_score).toBe(82);
  });

  it("returns null (never throws) for malformed jsonb", () => {
    expect(parseTimelineDiagnosis({ health_score: "high" })).toBeNull();
    expect(parseTimelineDiagnosis(null)).toBeNull();
  });
});
