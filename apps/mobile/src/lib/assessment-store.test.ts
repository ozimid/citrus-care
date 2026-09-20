import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import {
  COMPARISON_SAME_BAND,
  allAssessments,
  assessmentsForPlant,
  assessmentsForWalk,
  byEffectiveTimeDesc,
  comparisonAnchor,
  deltaFromScores,
  effectiveTime,
  latestAssessmentId,
  parseAssessmentStore,
  removeAssessment,
  removePlantAssessments,
  serializeAssessmentStore,
  upsertAssessment,
  withComputedComparison,
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

// D-W16 shapes for the parse tests (the parser refuses anything else).
const P1 = "p1-00000001";
const A1 = "a1-00000001";
const A2 = "a2-00000001";
const A3 = "a3-00000001";

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
    const store = upsertAssessment({}, assessment({ id: A1, plantId: P1 }));
    expect(parseAssessmentStore(serializeAssessmentStore(store))).toEqual(store);
  });

  it("returns an empty store for null / malformed JSON (never throws)", () => {
    expect(parseAssessmentStore(null)).toEqual({});
    expect(parseAssessmentStore("not-json{")).toEqual({});
    expect(parseAssessmentStore("[1,2]")).toEqual({});
  });

  it("skips malformed assessments but keeps valid ones (stored data is untrusted)", () => {
    const stored = JSON.stringify({
      [A1]: assessment({ id: A1, plantId: P1 }),
      [A2]: { id: A2, plantId: P1, createdAt: "t", comparedToId: null, engine: "on-device" },
      [A3]: { ...assessment({ id: A3, plantId: P1 }), diagnosis: { summary: "no score" } },
      "not-an-object": "nope",
    });
    expect(Object.keys(parseAssessmentStore(stored))).toEqual([A1]);
  });

  // D-W16: plantId names a directory downstream; the id keys the photo index.
  it("drops records with an unsafe id or plantId, or whose key is not their id", () => {
    const stored = JSON.stringify({
      [A1]: assessment({ id: A1, plantId: P1 }),
      [A2]: assessment({ id: A2, plantId: "../.." }),
      "..": assessment({ id: "..", plantId: P1 }),
      [A3]: assessment({ id: A1, plantId: P1 }),
    });
    expect(Object.keys(parseAssessmentStore(stored))).toEqual([A1]);
  });
});

// Two walk photos of one plant can land in the same second; the timeline,
// the anchor and the cover must all agree on which is "newest" regardless of
// the order the JSON map came back in.
describe("byEffectiveTimeDesc", () => {
  it("orders newest first, then higher id first on a tie", () => {
    const t = "2026-08-20T00:00:00Z";
    const older = assessment({ id: "a0", createdAt: "2026-08-19T00:00:00Z" });
    const x = assessment({ id: "ax", createdAt: t });
    const y = assessment({ id: "ay", createdAt: t });
    expect([older, x, y].sort(byEffectiveTimeDesc).map((a) => a.id)).toEqual(["ay", "ax", "a0"]);
    expect([y, older, x].sort(byEffectiveTimeDesc).map((a) => a.id)).toEqual(["ay", "ax", "a0"]);
    expect(byEffectiveTimeDesc(x, x)).toBe(0);
  });

  it("is what assessmentsForPlant uses (stable across Object.values order)", () => {
    const t = "2026-08-20T00:00:00Z";
    const forward: AssessmentStore = {
      ax: assessment({ id: "ax", createdAt: t }),
      ay: assessment({ id: "ay", createdAt: t }),
    };
    const backward: AssessmentStore = { ay: forward.ay, ax: forward.ax };
    expect(assessmentsForPlant(forward, "p1").map((a) => a.id)).toEqual(["ay", "ax"]);
    expect(assessmentsForPlant(backward, "p1").map((a) => a.id)).toEqual(["ay", "ax"]);
    expect(latestAssessmentId(backward, "p1")).toBe("ay");
    expect(allAssessments(backward).map((a) => a.id)).toEqual(["ay", "ax"]);
  });
});

// D-W6: a walk's second angle of the same tree, 40 s after the first, must
// compare against the plant's PRE-walk state — never against its sibling.
describe("comparisonAnchor", () => {
  const store: AssessmentStore = {
    old: assessment({ id: "old", createdAt: "2026-07-01T00:00:00Z" }),
    walk1: assessment({ id: "walk1", createdAt: "2026-08-20T10:00:00Z" }),
    walk2: assessment({ id: "walk2", createdAt: "2026-08-20T10:00:40Z" }),
    other: assessment({ id: "other", plantId: "p2", createdAt: "2026-08-21T00:00:00Z" }),
  };

  it("without beforeIso is the plant's newest assessment (single-shot semantics)", () => {
    expect(comparisonAnchor(store, "p1")?.id).toBe("walk2");
    expect(comparisonAnchor(store, "p1")).toEqual(assessmentsForPlant(store, "p1")[0]);
    expect(comparisonAnchor(store, "p3")).toBeNull();
  });

  it("with beforeIso skips rows at or after it and returns the pre-walk one", () => {
    expect(comparisonAnchor(store, "p1", "2026-08-20T10:00:00Z")?.id).toBe("old");
    expect(comparisonAnchor(store, "p1", "2026-08-20T10:00:40Z")?.id).toBe("walk1");
  });

  it("is null when nothing precedes beforeIso, and never crosses plants", () => {
    expect(comparisonAnchor(store, "p1", "2026-07-01T00:00:00Z")).toBeNull();
    expect(comparisonAnchor(store, "p2", "2026-08-21T00:00:00Z")).toBeNull();
    expect(comparisonAnchor(store, "p2")?.id).toBe("other");
  });
});

// D-17: the on-device model gets no prior context (stateless per photo), so it
// never emits `comparison`. We restore the better/same/worse trend
// DETERMINISTICALLY from the two health scores — more reliable than asking a 2B
// model to compare, and it feeds the unchanged comparisonDelta / latestTrend
// mappers exactly like Gemini's comparison used to.
describe("deltaFromScores", () => {
  it("is 'better' when the score rises past the same-band", () => {
    expect(deltaFromScores(60, 60 + COMPARISON_SAME_BAND)).toBe("better");
    expect(deltaFromScores(50, 90)).toBe("better");
  });

  it("is 'worse' when the score falls past the same-band", () => {
    expect(deltaFromScores(80, 80 - COMPARISON_SAME_BAND)).toBe("worse");
    expect(deltaFromScores(90, 40)).toBe("worse");
  });

  it("is 'same' inside the band (noise, not a real trend)", () => {
    expect(deltaFromScores(80, 80)).toBe("same");
    expect(deltaFromScores(80, 80 + COMPARISON_SAME_BAND - 1)).toBe("same");
    expect(deltaFromScores(80, 80 - COMPARISON_SAME_BAND + 1)).toBe("same");
  });
});

describe("withComputedComparison", () => {
  it("injects a comparison the timeline mapper can read", () => {
    const result = withComputedComparison(diagnosis({ health_score: 85 }), 60);
    expect(result.comparison?.delta).toBe("better");
    expect(result.comparison?.notes).toContain("60");
    expect(result.comparison?.notes).toContain("85");
  });

  it("leaves the first assessment WITHOUT a comparison (so it reads 'First')", () => {
    const result = withComputedComparison(diagnosis({ health_score: 85 }), null);
    expect(result.comparison).toBeUndefined();
  });

  it("strips a stray comparison on a first assessment", () => {
    const withStray = diagnosis({ comparison: { delta: "better", notes: "hallucinated" } });
    expect(withComputedComparison(withStray, null).comparison).toBeUndefined();
  });

  it("does not mutate the input diagnosis", () => {
    const input = diagnosis({ health_score: 85 });
    withComputedComparison(input, 60);
    expect(input.comparison).toBeUndefined();
  });
});

// F39 Phase 5 (D-W14): a photo imported from last month's roll is dated by
// when it was TAKEN, not when the phone got round to analyzing it. The
// timeline, "latest", the cover and the comparison anchor all read the
// effective time — takenAt when the photo carried one, createdAt otherwise —
// so an old import never becomes the plant's newest row.
describe("effectiveTime", () => {
  it("prefers takenAt and falls back to createdAt", () => {
    expect(effectiveTime(assessment({ createdAt: "2026-09-19T10:00:00Z", takenAt: "2026-08-01T09:00:00Z" }))).toBe(
      "2026-08-01T09:00:00Z",
    );
    expect(effectiveTime(assessment({ createdAt: "2026-09-19T10:00:00Z" }))).toBe("2026-09-19T10:00:00Z");
  });
});

describe("takenAt / walkId on parse (Phase 5 / 6b)", () => {
  const W1 = "w1-00000001";

  it("accepts an absent takenAt and a string takenAt, and round-trips both fields", () => {
    const plain = assessment({ id: A1, plantId: P1 });
    const dated = assessment({ id: A2, plantId: P1, takenAt: "2026-08-01T09:00:00Z", walkId: W1 });
    const store = upsertAssessment(upsertAssessment({}, plain), dated);
    const parsed = parseAssessmentStore(serializeAssessmentStore(store));
    expect(parsed).toEqual(store);
    expect("takenAt" in parsed[A1]).toBe(false);
    expect("walkId" in parsed[A1]).toBe(false);
    expect(parsed[A2].takenAt).toBe("2026-08-01T09:00:00Z");
    expect(parsed[A2].walkId).toBe(W1);
  });

  it("repairs a non-string takenAt to absent instead of dropping the record", () => {
    const stored = JSON.stringify({ [A1]: { ...assessment({ id: A1, plantId: P1 }), takenAt: 1755000000000 } });
    const parsed = parseAssessmentStore(stored);
    expect(Object.keys(parsed)).toEqual([A1]);
    expect("takenAt" in parsed[A1]).toBe(false);
    expect(effectiveTime(parsed[A1])).toBe(parsed[A1].createdAt);
  });

  // D-W16: a walkId is a record id like any other — a crafted one is dropped,
  // the assessment itself is kept.
  it("drops a walkId that is not a safe record id, keeps the assessment", () => {
    const stored = JSON.stringify({
      [A1]: { ...assessment({ id: A1, plantId: P1 }), walkId: "../.." },
      [A2]: { ...assessment({ id: A2, plantId: P1 }), walkId: 7 },
      [A3]: { ...assessment({ id: A3, plantId: P1 }), walkId: W1 },
    });
    const parsed = parseAssessmentStore(stored);
    expect(Object.keys(parsed).sort()).toEqual([A1, A2, A3]);
    expect("walkId" in parsed[A1]).toBe(false);
    expect("walkId" in parsed[A2]).toBe(false);
    expect(parsed[A3].walkId).toBe(W1);
  });
});

describe("ordering by effective time (Phase 5)", () => {
  // Analyzed today (createdAt newest of all) but shot in July: an old import.
  const imported = assessment({ id: "import", createdAt: "2026-09-19T12:00:00Z", takenAt: "2026-07-01T08:00:00Z" });
  const august = assessment({ id: "aug", createdAt: "2026-08-10T10:00:00Z" });
  const september = assessment({ id: "sep", createdAt: "2026-09-01T10:00:00Z" });
  const store: AssessmentStore = { import: imported, aug: august, sep: september };

  it("an old import does not become the plant's latest", () => {
    expect(assessmentsForPlant(store, "p1").map((a) => a.id)).toEqual(["sep", "aug", "import"]);
    expect(latestAssessmentId(store, "p1")).toBe("sep");
    expect(allAssessments(store).map((a) => a.id)).toEqual(["sep", "aug", "import"]);
  });

  it("breaks an effective-time tie by id, whatever the createdAt says", () => {
    const t = "2026-08-20T00:00:00Z";
    const x = assessment({ id: "ax", createdAt: "2026-09-19T00:00:00Z", takenAt: t });
    const y = assessment({ id: "ay", createdAt: t });
    expect([x, y].sort(byEffectiveTimeDesc).map((a) => a.id)).toEqual(["ay", "ax"]);
    expect([y, x].sort(byEffectiveTimeDesc).map((a) => a.id)).toEqual(["ay", "ax"]);
  });

  // D-W6 on effective time: a walk over last month's roll compares each photo
  // against what the plant looked like BEFORE it was shot, and a row analyzed
  // earlier but shot later is not "before" anything.
  it("comparisonAnchor reads the effective time", () => {
    // Shot in June, analyzed in September — precedes an August anchor.
    const shotEarly = assessment({ id: "early", createdAt: "2026-09-19T12:00:00Z", takenAt: "2026-06-01T00:00:00Z" });
    // Analyzed in July, but the photo was taken in September — does not precede it.
    const shotLate = assessment({ id: "late", createdAt: "2026-07-01T00:00:00Z", takenAt: "2026-09-10T00:00:00Z" });
    const s: AssessmentStore = { early: shotEarly, late: shotLate };
    expect(comparisonAnchor(s, "p1", "2026-08-01T00:00:00Z")?.id).toBe("early");
    expect(comparisonAnchor(s, "p1", "2026-06-01T00:00:00Z")).toBeNull();
    expect(comparisonAnchor(s, "p1")?.id).toBe("late");
  });
});

// F39 Phase 6b — "Undo this walk": misattribution is the failure mode, so a
// whole walk's assessments can be taken back. Removing a row must leave no
// dangling comparison behind it — a dependant is RE-ANCHORED against the next
// older row it still has (a plant with history never reads "First assessment"
// on the card), and only a row with nothing older loses its comparison.
describe("removeAssessment", () => {
  const base = assessment({ id: "a0", createdAt: "2026-07-01T00:00:00Z" });
  const walk = assessment({
    id: "a1",
    createdAt: "2026-08-01T00:00:00Z",
    comparedToId: "a0",
    diagnosis: diagnosis({ comparison: { delta: "better", notes: "up" } }),
  });
  const after = assessment({
    id: "a2",
    createdAt: "2026-09-01T00:00:00Z",
    comparedToId: "a1",
    diagnosis: diagnosis({ comparison: { delta: "worse", notes: "down" } }),
  });
  const other = assessment({ id: "b1", plantId: "p2", comparedToId: "a1" });
  const store: AssessmentStore = { a0: base, a1: walk, a2: after, b1: other };

  it("returns the removed row and a store without it", () => {
    const { store: next, removed } = removeAssessment(store, "a1");
    expect(removed).toEqual(walk);
    expect(Object.keys(next).sort()).toEqual(["a0", "a2", "b1"]);
    expect(Object.keys(store).sort()).toEqual(["a0", "a1", "a2", "b1"]);
  });

  it("re-anchors a dependant against the next older row it still has", () => {
    const { store: next } = removeAssessment(store, "a1");
    // a2 still has a0 beneath it: the trend must survive, recomputed against
    // a0 (80 → 80 = "same"), never left as the stale "worse" and never null —
    // a null here makes the Plants card read "First assessment" over history.
    expect(next.a2.comparedToId).toBe("a0");
    expect(next.a2.diagnosis.comparison).toEqual({
      delta: "same",
      notes: "Health held around 80.",
    });
    expect(next.a2.diagnosis.health_score).toBe(80);
    // Untouched rows keep their identity (no needless copies).
    expect(next.a0).toBe(base);
  });

  it("nulls comparedToId and the comparison when the dependant has nothing older", () => {
    const { store: next } = removeAssessment(store, "a1");
    // b1 is p2's only row — it really is a first assessment now.
    expect(next.b1.comparedToId).toBeNull();
    expect(next.b1.diagnosis.comparison).toBeUndefined();
  });

  it("re-anchors a walk row PRE-walk, never against its own sibling angle (D-W6)", () => {
    const pre = assessment({ id: "a0", createdAt: "2026-07-01T00:00:00Z" });
    const first = assessment({
      id: "a1",
      createdAt: "2026-08-01T10:00:00Z",
      walkId: "w1-00000001",
      comparedToId: "a0",
    });
    const second = assessment({
      id: "a2",
      createdAt: "2026-08-01T10:00:40Z",
      walkId: "w1-00000001",
      comparedToId: "a0",
      diagnosis: diagnosis({ health_score: 40 }),
    });
    const { store: next } = removeAssessment({ a0: pre, a1: first, a2: second }, "a0");
    // Two angles of one tree, 40 s apart: with the pre-walk row gone both are
    // first, and the later angle must not suddenly read "Worse" against its
    // sibling — that is noise, not a trend.
    expect(next.a1.comparedToId).toBeNull();
    expect(next.a2.comparedToId).toBeNull();
    expect(next.a2.diagnosis.comparison).toBeUndefined();
  });

  it("is a no-op with removed null for an unknown id", () => {
    const { store: next, removed } = removeAssessment(store, "nope");
    expect(removed).toBeNull();
    expect(next).toBe(store);
  });
});

describe("assessmentsForWalk", () => {
  const W1 = "w1-00000001";
  const W2 = "w2-00000001";
  const store: AssessmentStore = {
    a1: assessment({ id: "a1", createdAt: "2026-08-01T00:00:00Z", walkId: W1 }),
    a2: assessment({ id: "a2", plantId: "p2", createdAt: "2026-08-01T00:00:10Z", walkId: W1 }),
    a3: assessment({ id: "a3", createdAt: "2026-08-02T00:00:00Z", walkId: W2 }),
    single: assessment({ id: "single", createdAt: "2026-08-03T00:00:00Z" }),
  };

  it("lists the walk's assessments across plants, newest first", () => {
    expect(assessmentsForWalk(store, W1).map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(assessmentsForWalk(store, W2).map((a) => a.id)).toEqual(["a3"]);
  });

  it("never matches a single-shot row (no walkId) or an unknown walk", () => {
    expect(assessmentsForWalk(store, "w9-00000001")).toEqual([]);
    expect(assessmentsForWalk(store, "")).toEqual([]);
  });
});
