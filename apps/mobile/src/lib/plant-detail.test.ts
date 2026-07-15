import { describe, expect, it } from "vitest";
import {
  attachLocalPhotos,
  comparisonDelta,
  formatTimelineDate,
  mapTimelineRows,
  parseTimelineDiagnosis,
  PLANT_DETAIL_SELECT,
  sliderPair,
  TIMELINE_SELECT,
  trendChipLabel,
  type TimelineRow,
} from "./plant-detail";
import { upsertPhoto, type PhotoIndex } from "./photo-store";

// Reverse-chron fixture, the order the timeline query returns rows in:
// newest first, the plant's very first assessment last.
function rows(): TimelineRow[] {
  return [
    {
      id: "a3",
      created_at: "2026-07-10T09:00:00Z",
      health_score: 82,
      is_cut_care: false,
      diagnosis: { summary: "Recovering well", comparison: { delta: "better", notes: "n" } },
    },
    {
      id: "a2",
      created_at: "2026-06-26T09:00:00Z",
      health_score: 61,
      is_cut_care: false,
      diagnosis: { summary: "About the same", comparison: { delta: "same", notes: "n" } },
    },
    {
      id: "a1",
      created_at: "2026-06-12T09:00:00Z",
      health_score: 58,
      is_cut_care: true,
      diagnosis: { summary: "Early chlorosis" },
    },
  ];
}

function indexFor(ids: Record<string, string>): PhotoIndex {
  let index: PhotoIndex = {};
  for (const [assessmentId, localUri] of Object.entries(ids)) {
    index = upsertPhoto(index, assessmentId, {
      localUri,
      plantId: "p1",
      engine: "gemini",
      createdAt: "2026-07-15T10:00:00Z",
    });
  }
  return index;
}

describe("select constants", () => {
  it("pulls zip_code for the quarantine check", () => {
    expect(PLANT_DETAIL_SELECT).toContain("zip_code");
  });

  it("pulls the timeline columns, WITHOUT photo_path (photos are local-only, D-16)", () => {
    for (const col of ["id", "created_at", "health_score", "diagnosis", "is_cut_care"]) {
      expect(TIMELINE_SELECT).toContain(col);
    }
    expect(TIMELINE_SELECT).not.toContain("photo_path");
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

  it("maps score, cut flag, summary and date label; localUri starts null", () => {
    const [latest, , first] = mapTimelineRows(rows());
    expect(latest.score).toBe(82);
    expect(latest.summary).toBe("Recovering well");
    expect(latest.dateLabel).toBe("Jul 10, 2026");
    expect(latest.isCutCare).toBe(false);
    expect(latest.localUri).toBeNull();
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

describe("attachLocalPhotos", () => {
  it("joins entries to local uris by assessment id via the photo index", () => {
    const entries = mapTimelineRows(rows());
    const joined = attachLocalPhotos(
      entries,
      indexFor({ a3: "file:///photos/p1/3.jpg", a1: "file:///photos/p1/1.jpg" }),
    );
    expect(joined.map((e) => e.localUri)).toEqual([
      "file:///photos/p1/3.jpg",
      null, // no local photo (old row / other device) → placeholder, no error
      "file:///photos/p1/1.jpg",
    ]);
  });

  it("leaves every entry photo-less with an empty index", () => {
    const joined = attachLocalPhotos(mapTimelineRows(rows()), {});
    expect(joined.every((e) => e.localUri === null)).toBe(true);
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

describe("sliderPair (local photos only)", () => {
  it("pairs the oldest and newest entries THAT HAVE local photos", () => {
    const entries = attachLocalPhotos(
      mapTimelineRows(rows()),
      indexFor({ a3: "file:///3.jpg", a2: "file:///2.jpg", a1: "file:///1.jpg" }),
    );
    const pair = sliderPair(entries);
    expect(pair?.before.id).toBe("a1");
    expect(pair?.after.id).toBe("a3");
  });

  it("skips photo-less entries when pairing (old rows from before local-first)", () => {
    const entries = attachLocalPhotos(
      mapTimelineRows(rows()),
      indexFor({ a3: "file:///3.jpg", a2: "file:///2.jpg" }),
    );
    const pair = sliderPair(entries);
    expect(pair?.before.id).toBe("a2");
    expect(pair?.after.id).toBe("a3");
  });

  it("is null with fewer than two locally-available photos", () => {
    const entries = attachLocalPhotos(mapTimelineRows(rows()), indexFor({ a3: "file:///3.jpg" }));
    expect(sliderPair(entries)).toBeNull();
    expect(sliderPair(attachLocalPhotos(mapTimelineRows(rows()), {}))).toBeNull();
    expect(sliderPair([])).toBeNull();
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
