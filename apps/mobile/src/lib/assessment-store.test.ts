import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import {
  allAssessments,
  assessmentsForPlant,
  latestAssessmentId,
  parseAssessmentStore,
  removePlantAssessments,
  serializeAssessmentStore,
  upsertAssessment,
  type AssessmentStore,
  type StoredAssessment,
} from "./assessment-store";

// D-17: assessments live only on the phone. A global id→assessment map (not
// nested under plants) keeps by-id lookup O(1) and cross-plant queries trivial;
// store-adapters reconstructs the row shapes the timeline mappers consume.

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

describe("upsertAssessment", () => {
  it("adds an assessment keyed by id without mutating the input", () => {
    const before: AssessmentStore = {};
    const after = upsertAssessment(before, assessment());
    expect(after["a1"]).toEqual(assessment());
    expect(before).toEqual({});
  });
});

describe("removePlantAssessments", () => {
  it("drops every assessment for the plant (cascade on plant delete), keeps others", () => {
    const store = upsertAssessment(
      upsertAssessment(upsertAssessment({}, assessment()), assessment({ id: "a2" })),
      assessment({ id: "b1", plantId: "p2" }),
    );
    const after = removePlantAssessments(store, "p1");
    expect(Object.keys(after)).toEqual(["b1"]);
    expect(Object.keys(store).sort()).toEqual(["a1", "a2", "b1"]);
  });
});

describe("assessmentsForPlant / latestAssessmentId", () => {
  const store = upsertAssessment(
    upsertAssessment(
      upsertAssessment({}, assessment({ id: "old", createdAt: "2026-01-01T00:00:00Z" })),
      assessment({ id: "new", createdAt: "2026-07-01T00:00:00Z" }),
    ),
    assessment({ id: "other", plantId: "p2" }),
  );

  it("lists a plant's assessments newest-first", () => {
    expect(assessmentsForPlant(store, "p1").map((a) => a.id)).toEqual(["new", "old"]);
    expect(assessmentsForPlant(store, "p3")).toEqual([]);
  });

  it("returns the newest assessment id for the comparison / cover anchor", () => {
    expect(latestAssessmentId(store, "p1")).toBe("new");
    expect(latestAssessmentId(store, "p3")).toBeNull();
  });
});

describe("allAssessments", () => {
  it("returns every assessment across plants", () => {
    const store = upsertAssessment(upsertAssessment({}, assessment()), assessment({ id: "b1", plantId: "p2" }));
    expect(allAssessments(store).map((a) => a.id).sort()).toEqual(["a1", "b1"]);
  });
});

describe("parseAssessmentStore / serializeAssessmentStore", () => {
  it("round-trips through JSON", () => {
    const store = upsertAssessment({}, assessment());
    expect(parseAssessmentStore(serializeAssessmentStore(store))).toEqual(store);
  });

  it("returns an empty store for null / malformed JSON (never throws)", () => {
    expect(parseAssessmentStore(null)).toEqual({});
    expect(parseAssessmentStore("not-json{")).toEqual({});
    expect(parseAssessmentStore("[1,2]")).toEqual({});
  });

  it("skips malformed assessments but keeps valid ones (stored data is untrusted)", () => {
    const stored = JSON.stringify({
      good: assessment(),
      "no-diagnosis": { id: "x", plantId: "p1", createdAt: "t", comparedToId: null, engine: "on-device" },
      "bad-score": { ...assessment(), diagnosis: { summary: "no score" } },
      "not-an-object": "nope",
    });
    expect(Object.keys(parseAssessmentStore(stored))).toEqual(["good"]);
  });
});
