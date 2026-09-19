import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import type { AssessmentStore, StoredAssessment } from "./assessment-store";
import type { PhotoIndex } from "./photo-store";
import { PHOTO_INBOX_DIR } from "./photo-store";
import {
  CARRY_IDLE_MS,
  GROUP_GAP_MS,
  IMPORT_BYTES_PER_PHOTO,
  INBOX_SWEEP_MIN_AGE_MS,
  MAX_AUTO_ATTEMPTS,
  MAX_GROUP_PROPAGATION,
  MAX_IMPORT,
  PHOTO_QUEUE_STORAGE_KEY,
  WALK_DURATIONS_KEY,
  assignGroups,
  assignQueued,
  durationStats,
  markAnalyzing,
  markFailed,
  markPending,
  markRejected,
  parseDurations,
  parsePhotoQueue,
  pendingByPlant,
  pendingCount,
  pickWalkCover,
  propagateWithinGroup,
  pushDuration,
  queuedDirName,
  queuedForPlant,
  reconcileInterrupted,
  removePlantQueued,
  removeQueued,
  runnableItems,
  serializeDurations,
  serializePhotoQueue,
  stalledItems,
  upsertQueued,
  type PhotoQueue,
  type QueuedPhoto,
} from "./photo-queue";

// D-W1: a photo without an assessment lives here, never as a placeholder
// assessment. D-W16: every id and basename is gated on parse because they name
// files and directories. Fixtures use the shapes the app actually mints.
const P1 = "p1-00000001";
const P2 = "p2-00000001";
const P3 = "p3-00000001";
const W1 = "w1-00000001";
const W2 = "w2-00000001";
const FILE = "x1-00000001.jpg";

function qid(n: number): string {
  return `q${n}-00000001`;
}

function queued(overrides: Partial<QueuedPhoto> = {}): QueuedPhoto {
  return {
    id: qid(1),
    walkId: W1,
    groupId: qid(1),
    plantId: P1,
    evidence: "user",
    suggestedPlantId: null,
    basename: FILE,
    width: 1600,
    height: 1200,
    takenAt: "2026-09-19T08:00:00.000Z",
    addedAt: "2026-09-19T08:00:05.000Z",
    source: "gallery",
    codeDigest: null,
    fileName: "IMG_20260919_100000.jpg",
    status: "pending",
    startedAt: null,
    runAnchorIso: null,
    attempts: 0,
    error: null,
    timedOut: false,
    rejectedDiagnosis: null,
    ...overrides,
  };
}

function build(...items: QueuedPhoto[]): PhotoQueue {
  let q: PhotoQueue = {};
  for (const item of items) q = upsertQueued(q, item);
  return q;
}

function at(seconds: number): string {
  return new Date(Date.UTC(2026, 8, 19, 8, 0, seconds)).toISOString();
}

function diagnosis(subject: AssessmentDiagnosis["subject"] = "not_a_plant"): AssessmentDiagnosis {
  return { health_score: 0, summary: "Not a plant.", subject, symptoms: [], causes: [], recommendations: [] };
}

function assessment(id: string, plantId: string, createdAt: string): StoredAssessment {
  return { id, plantId, createdAt, diagnosis: diagnosis("leaf"), comparedToId: null, engine: "on-device" };
}

describe("photo queue constants", () => {
  it("names its storage keys so a rename is a deliberate migration", () => {
    expect(PHOTO_QUEUE_STORAGE_KEY).toBe("citrus.photo-queue.v1");
    expect(WALK_DURATIONS_KEY).toBe("citrus.walk-durations.v1");
  });

  it("pins the contract numbers", () => {
    expect(MAX_IMPORT).toBe(30);
    expect(MAX_AUTO_ATTEMPTS).toBe(3);
    expect(GROUP_GAP_MS).toBe(45_000);
    expect(CARRY_IDLE_MS).toBe(120_000);
    expect(MAX_GROUP_PROPAGATION).toBe(4);
    expect(INBOX_SWEEP_MIN_AGE_MS).toBe(600_000);
    expect(IMPORT_BYTES_PER_PHOTO).toBe(1_500_000);
  });
});

describe("photo queue records", () => {
  it("names the directory from the plant, or the inbox when unassigned (D-W2)", () => {
    expect(queuedDirName(queued())).toBe(P1);
    expect(queuedDirName(queued({ plantId: null, evidence: "none" }))).toBe(PHOTO_INBOX_DIR);
  });

  it("upserts and removes by id", () => {
    const q = build(queued(), queued({ id: qid(2) }));
    expect(Object.keys(q).sort()).toEqual([qid(1), qid(2)]);
    expect(Object.keys(removeQueued(q, qid(1)))).toEqual([qid(2)]);
    expect(removeQueued(q, "nope")).toEqual(q);
  });

  it("does not mutate the queue it is given", () => {
    const before = build(queued(), queued({ id: qid(2), plantId: null, evidence: "none", suggestedPlantId: P1 }));
    const snapshot = JSON.parse(JSON.stringify(before));
    upsertQueued(before, queued({ id: qid(3) }));
    removeQueued(before, qid(1));
    removePlantQueued(before, P1);
    markAnalyzing(before, qid(1), at(10), at(10));
    markFailed(before, qid(1), "x", true);
    markRejected(before, qid(1), diagnosis());
    markPending(before, qid(1));
    assignQueued(before, qid(2), P2, "user");
    assignGroups(before, W1);
    propagateWithinGroup(before, W1);
    reconcileInterrupted(before, {}, {});
    expect(before).toEqual(snapshot);
  });

  it("cascades on plant delete and nulls suggestions pointing at that plant", () => {
    const q = build(
      queued({ id: qid(1), plantId: P1 }),
      queued({ id: qid(2), plantId: P2 }),
      queued({ id: qid(3), plantId: null, evidence: "file-tag", suggestedPlantId: P1 }),
      queued({ id: qid(4), plantId: null, evidence: "file-tag", suggestedPlantId: P2 }),
    );
    const next = removePlantQueued(q, P1);
    expect(Object.keys(next).sort()).toEqual([qid(2), qid(3), qid(4)]);
    expect(next[qid(3)]).toMatchObject({ suggestedPlantId: null, evidence: "none" });
    expect(next[qid(4)]).toMatchObject({ suggestedPlantId: P2, evidence: "file-tag" });
  });

  it("lists a plant's photos in shooting order, unknown times last, id as tiebreak", () => {
    const q = build(
      queued({ id: qid(3), takenAt: null }),
      queued({ id: qid(2), takenAt: at(20) }),
      queued({ id: qid(1), takenAt: at(10) }),
      queued({ id: qid(5), takenAt: at(10) }),
      queued({ id: qid(4), takenAt: at(10), plantId: P2 }),
    );
    expect(queuedForPlant(q, P1).map((i) => i.id)).toEqual([qid(1), qid(5), qid(2), qid(3)]);
    expect(queuedForPlant(q, P3)).toEqual([]);
  });

  it("counts what still awaits analysis: pending and failed, not analyzing or rejected", () => {
    const q = build(
      queued({ id: qid(1), status: "pending" }),
      queued({ id: qid(2), status: "failed", plantId: P2 }),
      queued({ id: qid(3), status: "analyzing" }),
      queued({ id: qid(4), status: "rejected", rejectedDiagnosis: diagnosis() }),
      queued({ id: qid(5), status: "pending", plantId: null, evidence: "none" }),
    );
    expect(pendingCount(q)).toBe(3);
    expect(pendingByPlant(q)).toEqual({ [P1]: 1, [P2]: 1 });
    expect(pendingCount({})).toBe(0);
  });
});

describe("runnableItems", () => {
  it("runs only assigned pending/failed items under the attempt cap", () => {
    const q = build(
      queued({ id: qid(1), status: "pending" }),
      queued({ id: qid(2), status: "failed" }),
      queued({ id: qid(3), status: "analyzing" }),
      queued({ id: qid(4), status: "rejected", rejectedDiagnosis: diagnosis() }),
      queued({ id: qid(5), status: "pending", plantId: null, evidence: "none" }),
      queued({ id: qid(6), status: "failed", attempts: MAX_AUTO_ATTEMPTS }),
      queued({ id: qid(7), status: "pending", attempts: MAX_AUTO_ATTEMPTS - 1 }),
    );
    expect(runnableItems(q).map((i) => i.id).sort()).toEqual([qid(1), qid(2), qid(7)]);
  });

  it("orders by walk, then plant, then shooting time (unknown last), then id (D-W6)", () => {
    const q = build(
      queued({ id: qid(1), walkId: W2, plantId: P1, takenAt: at(0) }),
      queued({ id: qid(2), walkId: W1, plantId: P2, takenAt: at(0) }),
      queued({ id: qid(3), walkId: W1, plantId: P1, takenAt: at(30) }),
      queued({ id: qid(4), walkId: W1, plantId: P1, takenAt: at(10) }),
      queued({ id: qid(5), walkId: W1, plantId: P1, takenAt: null }),
      queued({ id: qid(7), walkId: W1, plantId: P1, takenAt: at(10) }),
      queued({ id: qid(6), walkId: W1, plantId: P1, takenAt: at(10) }),
    );
    expect(runnableItems(q).map((i) => i.id)).toEqual([qid(4), qid(6), qid(7), qid(3), qid(5), qid(2), qid(1)]);
  });

  it("filters by walk and by plant", () => {
    const q = build(
      queued({ id: qid(1), walkId: W1, plantId: P1 }),
      queued({ id: qid(2), walkId: W1, plantId: P2 }),
      queued({ id: qid(3), walkId: W2, plantId: P1 }),
    );
    expect(runnableItems(q, { walkId: W1 }).map((i) => i.id)).toEqual([qid(1), qid(2)]);
    expect(runnableItems(q, { plantId: P1 }).map((i) => i.id)).toEqual([qid(1), qid(3)]);
    expect(runnableItems(q, { walkId: W2, plantId: P2 })).toEqual([]);
  });

  it("stalled items are the ones automation has given up on, or the model rejected", () => {
    const q = build(
      queued({ id: qid(1), status: "failed", attempts: MAX_AUTO_ATTEMPTS }),
      queued({ id: qid(2), status: "rejected", rejectedDiagnosis: diagnosis() }),
      queued({ id: qid(3), status: "failed", attempts: 1 }),
      queued({ id: qid(4), status: "pending" }),
    );
    expect(stalledItems(q).map((i) => i.id).sort()).toEqual([qid(1), qid(2)]);
  });
});

describe("mark transitions", () => {
  it("markAnalyzing persists the run state before the model is called (D-W2)", () => {
    const q = build(queued({ status: "failed", error: "Took too long", timedOut: true }));
    const next = markAnalyzing(q, qid(1), at(10), at(5));
    expect(next[qid(1)]).toMatchObject({
      status: "analyzing",
      startedAt: at(10),
      attempts: 1,
      runAnchorIso: at(5),
      error: null,
      timedOut: false,
    });
  });

  it("sets the comparison anchor only once per record (D-W6) and counts every attempt", () => {
    let q = build(queued());
    q = markAnalyzing(q, qid(1), at(10), at(5));
    q = markFailed(q, qid(1), "Took too long", true);
    q = markAnalyzing(q, qid(1), at(200), at(199));
    expect(q[qid(1)]).toMatchObject({ runAnchorIso: at(5), attempts: 2, startedAt: at(200) });
  });

  it("markFailed keeps a generic error string and the timeout flag", () => {
    const q = markFailed(markAnalyzing(build(queued()), qid(1), at(10), at(5)), qid(1), "Took too long", true);
    expect(q[qid(1)]).toMatchObject({ status: "failed", error: "Took too long", timedOut: true, attempts: 1 });
  });

  it("markRejected keeps the diagnosis for 'Score it anyway' and stays out of the runnable set", () => {
    const q = markRejected(markAnalyzing(build(queued()), qid(1), at(10), at(5)), qid(1), diagnosis());
    expect(q[qid(1)]).toMatchObject({ status: "rejected", rejectedDiagnosis: diagnosis(), error: null, timedOut: false });
    expect(runnableItems(q)).toEqual([]);
  });

  it("markPending clears the error and timeout but keeps the attempt count", () => {
    let q = markAnalyzing(build(queued()), qid(1), at(10), at(5));
    q = markFailed(q, qid(1), "Took too long", true);
    q = markPending(q, qid(1));
    expect(q[qid(1)]).toMatchObject({ status: "pending", error: null, timedOut: false, attempts: 1, startedAt: null });
  });

  it("markPending with an explicit count stores it — 0 for the user's Retry, the pre-mark count when the engine was never reached", () => {
    const marked = markAnalyzing(build(queued({ attempts: 1 })), qid(1), at(10), at(5));
    expect(marked[qid(1)].attempts).toBe(2);
    expect(markPending(marked, qid(1), 0)[qid(1)]).toMatchObject({ status: "pending", attempts: 0 });
    expect(markPending(marked, qid(1), 1)[qid(1)]).toMatchObject({ status: "pending", attempts: 1 });
    expect(markPending(marked, qid(1))[qid(1)].attempts).toBe(2);
  });

  it("every mark is a no-op on an unknown id", () => {
    const q = build(queued());
    expect(markAnalyzing(q, "nope", at(1), at(1))).toEqual(q);
    expect(markFailed(q, "nope", "x", false)).toEqual(q);
    expect(markRejected(q, "nope", diagnosis())).toEqual(q);
    expect(markPending(q, "nope")).toEqual(q);
    expect(assignQueued(q, "nope", P2, "user")).toEqual(q);
  });
});

describe("assignQueued", () => {
  it("assigns with evidence, clears the suggestion and anchor, and resets the attempt count", () => {
    const q = build(
      queued({ status: "failed", attempts: 3, error: "Took too long", timedOut: true, runAnchorIso: at(1), suggestedPlantId: P2, evidence: "none", plantId: null }),
    );
    const next = assignQueued(q, qid(1), P2, "user");
    expect(next[qid(1)]).toMatchObject({
      plantId: P2,
      evidence: "user",
      suggestedPlantId: null,
      runAnchorIso: null,
      status: "pending",
      attempts: 0,
      error: null,
      timedOut: false,
    });
    expect(runnableItems(next)).toHaveLength(1);
  });

  it("unassigns back to the inbox", () => {
    const next = assignQueued(build(queued()), qid(1), null, "none");
    expect(next[qid(1)]).toMatchObject({ plantId: null, evidence: "none" });
    expect(queuedDirName(next[qid(1)])).toBe(PHOTO_INBOX_DIR);
  });

  it("leaves a rejected item rejected — moving it does not make it a plant", () => {
    const next = assignQueued(build(queued({ status: "rejected", rejectedDiagnosis: diagnosis() })), qid(1), P2, "user");
    expect(next[qid(1)].status).toBe("rejected");
  });
});

describe("assignGroups (rung 4, D-W3)", () => {
  it("groups shots within the gap and starts a new group after a longer pause", () => {
    const q = build(
      queued({ id: qid(1), takenAt: at(0) }),
      queued({ id: qid(2), takenAt: at(30) }),
      queued({ id: qid(3), takenAt: at(75) }), // exactly 45 s after #2 — not a split (gap must exceed)
      queued({ id: qid(4), takenAt: at(121) }), // 46 s — split
      queued({ id: qid(5), takenAt: at(130) }),
    );
    const next = assignGroups(q, W1);
    const groups = [1, 2, 3, 4, 5].map((n) => next[qid(n)].groupId);
    expect(groups[0]).toBe(groups[1]);
    expect(groups[1]).toBe(groups[2]);
    expect(groups[2]).not.toBe(groups[3]);
    expect(groups[3]).toBe(groups[4]);
  });

  it("is deterministic: the group id is the first member's id in shooting order", () => {
    const q = build(queued({ id: qid(2), takenAt: at(10) }), queued({ id: qid(1), takenAt: at(20) }));
    const next = assignGroups(q, W1);
    expect(next[qid(1)].groupId).toBe(qid(2));
    expect(next[qid(2)].groupId).toBe(qid(2));
  });

  it("makes unknown shooting times singleton groups — never chained onto a neighbour", () => {
    const q = build(
      queued({ id: qid(1), takenAt: at(0) }),
      queued({ id: qid(2), takenAt: null }),
      queued({ id: qid(3), takenAt: null }),
      queued({ id: qid(4), takenAt: at(5) }),
    );
    const next = assignGroups(q, W1);
    expect(next[qid(2)].groupId).toBe(qid(2));
    expect(next[qid(3)].groupId).toBe(qid(3));
    expect(next[qid(1)].groupId).toBe(next[qid(4)].groupId);
  });

  it("splits on a source change even within the gap", () => {
    const q = build(
      queued({ id: qid(1), takenAt: at(0), source: "camera" }),
      queued({ id: qid(2), takenAt: at(5), source: "gallery" }),
      queued({ id: qid(3), takenAt: at(10), source: "gallery" }),
    );
    const next = assignGroups(q, W1);
    expect(next[qid(1)].groupId).not.toBe(next[qid(2)].groupId);
    expect(next[qid(2)].groupId).toBe(next[qid(3)].groupId);
  });

  it("touches only the walk it is given and honours a custom gap", () => {
    const q = build(
      queued({ id: qid(1), takenAt: at(0) }),
      queued({ id: qid(2), takenAt: at(10) }),
      queued({ id: qid(3), walkId: W2, takenAt: at(0), groupId: "keep" }),
    );
    const next = assignGroups(q, W1, 5_000);
    expect(next[qid(1)].groupId).not.toBe(next[qid(2)].groupId);
    expect(next[qid(3)].groupId).toBe("keep");
  });
});

describe("propagateWithinGroup (rung 4, bounded)", () => {
  function group(...items: QueuedPhoto[]): PhotoQueue {
    return build(...items.map((i) => ({ ...i, groupId: "g" })));
  }

  it("assigns the unassigned members of a group with exactly one deciding plant", () => {
    const q = group(
      queued({ id: qid(1), takenAt: at(0), plantId: P1, evidence: "user" }),
      queued({ id: qid(2), takenAt: at(5), plantId: null, evidence: "none" }),
      queued({ id: qid(3), takenAt: at(9), plantId: null, evidence: "none", suggestedPlantId: P2 }),
    );
    const next = propagateWithinGroup(q, W1);
    expect(next[qid(2)]).toMatchObject({ plantId: P1, evidence: "group" });
    expect(next[qid(3)]).toMatchObject({ plantId: P1, evidence: "group", suggestedPlantId: null });
    expect(next[qid(1)]).toEqual(q[qid(1)]);
  });

  it("does nothing when two deciders disagree — the whole group needs a plant", () => {
    const q = group(
      queued({ id: qid(1), takenAt: at(0), plantId: P1, evidence: "user" }),
      queued({ id: qid(2), takenAt: at(5), plantId: P2, evidence: "code-scan" }),
      queued({ id: qid(3), takenAt: at(9), plantId: null, evidence: "none" }),
    );
    expect(propagateWithinGroup(q, W1)).toEqual(q);
  });

  it("does nothing with no decider, and weak evidence is not a decider", () => {
    const q = group(
      queued({ id: qid(1), takenAt: at(0), plantId: P1, evidence: "group" }),
      queued({ id: qid(2), takenAt: at(3), plantId: P1, evidence: "carried" }),
      queued({ id: qid(3), takenAt: at(5), plantId: null, evidence: "none" }),
    );
    expect(propagateWithinGroup(q, W1)).toEqual(q);
  });

  it("propagates to at most four photos, earliest first", () => {
    const q = group(
      queued({ id: qid(1), takenAt: at(0), plantId: P1, evidence: "tag-card" }),
      ...[2, 3, 4, 5, 6, 7].map((n) => queued({ id: qid(n), takenAt: at(n), plantId: null, evidence: "none" })),
    );
    const next = propagateWithinGroup(q, W1);
    const assigned = [2, 3, 4, 5, 6, 7].filter((n) => next[qid(n)].plantId === P1);
    expect(assigned).toEqual([2, 3, 4, 5]);
    expect(next[qid(6)].plantId).toBeNull();
    expect(next[qid(7)].plantId).toBeNull();
    expect(MAX_GROUP_PROPAGATION).toBe(4);
  });

  it("leaves other walks and other groups alone", () => {
    const q = build(
      queued({ id: qid(1), groupId: "a", plantId: P1, evidence: "marker" }),
      queued({ id: qid(2), groupId: "b", plantId: null, evidence: "none" }),
      queued({ id: qid(3), groupId: "a", walkId: W2, plantId: null, evidence: "none" }),
    );
    expect(propagateWithinGroup(q, W1)).toEqual(q);
  });
});

describe("reconcileInterrupted (kill mid-item, D-W2)", () => {
  const started = at(100);
  const analyzing = queued({ id: qid(1), status: "analyzing", startedAt: started, attempts: 2, runAnchorIso: at(90) });
  // The runner passes the queued file as the assessment's savedUri, so the
  // index entry of a landed walk photo names the queue basename.
  const index: PhotoIndex = {
    ["a1-00000001"]: { localUri: `file:///data/photos/${P1}/${FILE}`, plantId: P1, engine: "on-device", createdAt: at(150) },
  };

  it("leaves a queue with nothing analyzing untouched", () => {
    const q = build(queued({ id: qid(1) }), queued({ id: qid(2), status: "failed" }));
    expect(reconcileInterrupted(q, {}, {})).toEqual({ queue: q, relink: [] });
  });

  it("removes the record when its assessment landed and the index already links it", () => {
    const assessments: AssessmentStore = { ["a1-00000001"]: assessment("a1-00000001", P1, at(150)) };
    const result = reconcileInterrupted(build(analyzing), assessments, index);
    expect(result.queue).toEqual({});
    expect(result.relink).toEqual([]);
  });

  it("an index entry naming the queued file settles the record even when the clock disagrees — the file is owned", () => {
    const assessments: AssessmentStore = { ["a1-00000001"]: assessment("a1-00000001", P1, at(20)) };
    const result = reconcileInterrupted(build(analyzing), assessments, index);
    expect(result.queue).toEqual({});
    expect(result.relink).toEqual([]);
  });

  it("removes the record AND asks the io to relink when the index lacks the entry", () => {
    const assessments: AssessmentStore = { ["a1-00000001"]: assessment("a1-00000001", P1, at(150)) };
    const result = reconcileInterrupted(build(analyzing), assessments, {});
    expect(result.queue).toEqual({});
    expect(result.relink).toEqual([{ assessmentId: "a1-00000001", plantId: P1, basename: FILE }]);
  });

  it("a same-plant assessment made after the kill whose index entry names ANOTHER file never settles the record", () => {
    // The single-shot flow after a kill: its own photo, its own index entry.
    const other: PhotoIndex = {
      ["a1-00000001"]: { localUri: `file:///data/photos/${P1}/y9-00000001.jpg`, plantId: P1, engine: "on-device", createdAt: at(150) },
    };
    const assessments: AssessmentStore = { ["a1-00000001"]: assessment("a1-00000001", P1, at(150)) };
    const result = reconcileInterrupted(build(analyzing), assessments, other);
    expect(result.queue[qid(1)]).toMatchObject({ status: "pending", attempts: 2, runAnchorIso: at(90) });
    expect(result.relink).toEqual([]);
  });

  it("an assessment older than startedAt does not match — the item goes back to pending", () => {
    const assessments: AssessmentStore = { ["a1-00000001"]: assessment("a1-00000001", P1, at(99)) };
    const result = reconcileInterrupted(build(analyzing), assessments, {});
    expect(result.queue[qid(1)]).toMatchObject({ status: "pending", attempts: 2, error: null, timedOut: false });
    expect(result.relink).toEqual([]);
  });

  it("an assessment for another plant does not match, even when its index entry shares the basename", () => {
    const assessments: AssessmentStore = { ["a1-00000001"]: assessment("a1-00000001", P2, at(150)) };
    const otherPlant: PhotoIndex = {
      ["a1-00000001"]: { localUri: `file:///data/photos/${P2}/${FILE}`, plantId: P2, engine: "on-device", createdAt: at(150) },
    };
    expect(reconcileInterrupted(build(analyzing), assessments, otherPlant).queue[qid(1)].status).toBe("pending");
    expect(reconcileInterrupted(build(analyzing), assessments, {}).queue[qid(1)].status).toBe("pending");
  });

  it("with no assessments the item goes back to pending, attempts unchanged, anchor kept for the retry", () => {
    const result = reconcileInterrupted(build(analyzing), {}, {});
    expect(result.queue[qid(1)]).toMatchObject({ status: "pending", attempts: 2, runAnchorIso: at(90) });
  });

  it("an assessment at exactly startedAt matches, and non-analyzing siblings are untouched", () => {
    const sibling = queued({ id: qid(2), status: "pending" });
    const assessments: AssessmentStore = { ["a1-00000001"]: assessment("a1-00000001", P1, started) };
    const result = reconcileInterrupted(build(analyzing, sibling), assessments, index);
    expect(result.queue).toEqual({ [qid(2)]: sibling });
  });

  it("never lets one assessment settle two analyzing records", () => {
    const second = queued({ id: qid(2), status: "analyzing", startedAt: started, attempts: 1 });
    const assessments: AssessmentStore = { ["a1-00000001"]: assessment("a1-00000001", P1, at(150)) };
    const result = reconcileInterrupted(build(analyzing, second), assessments, index);
    expect(Object.keys(result.queue)).toHaveLength(1);
    expect(Object.values(result.queue)[0].status).toBe("pending");
  });
});

describe("pickWalkCover (D-W9)", () => {
  it("prefers a whole-plant shot, then a leaf, then the first by shooting time", () => {
    const items = [
      { assessmentId: "cut", subject: "cut", takenAt: at(0) },
      { assessmentId: "leaf-late", subject: "leaf", takenAt: at(30) },
      { assessmentId: "leaf-early", subject: "leaf", takenAt: at(10) },
      { assessmentId: "whole", subject: "whole_plant", takenAt: at(50) },
    ];
    expect(pickWalkCover(items)).toBe("whole");
    expect(pickWalkCover(items.filter((i) => i.subject !== "whole_plant"))).toBe("leaf-early");
    expect(pickWalkCover([items[0], { assessmentId: "cut-late", subject: "cut", takenAt: at(5) }])).toBe("cut");
  });

  it("puts unknown times after known ones and returns null for nothing", () => {
    expect(pickWalkCover([
      { assessmentId: "unknown", subject: "cut", takenAt: null },
      { assessmentId: "known", subject: "cut", takenAt: at(0) },
    ])).toBe("known");
    expect(pickWalkCover([])).toBeNull();
  });
});

describe("walk durations ring (D-W8)", () => {
  it("keeps the last N durations", () => {
    let ring: number[] = [];
    for (let i = 1; i <= 35; i++) ring = pushDuration(ring, i * 1000);
    expect(ring).toHaveLength(30);
    expect(ring[0]).toBe(6000);
    expect(ring[29]).toBe(35000);
    expect(pushDuration([1, 2], 3, 2)).toEqual([2, 3]);
  });

  it("ignores durations that cannot be real", () => {
    expect(pushDuration([1000], Number.NaN)).toEqual([1000]);
    expect(pushDuration([1000], -5)).toEqual([1000]);
    expect(pushDuration([1000], Number.POSITIVE_INFINITY)).toEqual([1000]);
  });

  it("reports the median and the count", () => {
    expect(durationStats([])).toEqual({ median: null, count: 0 });
    expect(durationStats([30_000])).toEqual({ median: 30_000, count: 1 });
    expect(durationStats([90_000, 30_000, 60_000])).toEqual({ median: 60_000, count: 3 });
    expect(durationStats([10, 20, 30, 40])).toEqual({ median: 25, count: 4 });
  });

  it("round-trips and degrades on read", () => {
    expect(parseDurations(serializeDurations([1, 2, 3]))).toEqual([1, 2, 3]);
    expect(parseDurations(null)).toEqual([]);
    expect(parseDurations("nope{")).toEqual([]);
    expect(parseDurations('{"a":1}')).toEqual([]);
    expect(parseDurations('[1,"x",-2,null,3]')).toEqual([1, 3]);
    expect(parseDurations(JSON.stringify(Array.from({ length: 40 }, (_, i) => i)))).toHaveLength(30);
  });
});

describe("photo queue persistence (untrusted on read, D-W16)", () => {
  it("round-trips", () => {
    const q = build(queued(), queued({ id: qid(2), status: "rejected", rejectedDiagnosis: diagnosis() }));
    expect(parsePhotoQueue(serializePhotoQueue(q))).toEqual(q);
  });

  it("degrades to an empty queue for null, junk and arrays", () => {
    expect(parsePhotoQueue(null)).toEqual({});
    expect(parsePhotoQueue("nope{")).toEqual({});
    expect(parsePhotoQueue("[1,2]")).toEqual({});
  });

  it("drops records whose id, plant or basename could name a path it must not (D-W16)", () => {
    const raw = JSON.stringify({
      [qid(1)]: queued({ id: qid(1) }),
      "..": queued({ id: ".." }),
      _inbox: queued({ id: "_inbox" }),
      [qid(2)]: queued({ id: qid(2), plantId: "../.." }),
      [qid(3)]: queued({ id: qid(3), plantId: PHOTO_INBOX_DIR }),
      [qid(4)]: queued({ id: qid(4), suggestedPlantId: "a/b" }),
      [qid(5)]: queued({ id: qid(5), basename: "../x1-00000001.jpg" }),
      [qid(6)]: queued({ id: qid(6), basename: "x.jpg" }),
      [qid(7)]: queued({ id: qid(9) }), // key !== id
      [qid(8)]: queued({ id: qid(8), plantId: null, evidence: "none", suggestedPlantId: null }),
      junk: "nope",
    });
    expect(Object.keys(parsePhotoQueue(raw)).sort()).toEqual([qid(1), qid(8)]);
  });

  it("drops a record with an unknown status — nothing else is a reason to lose a photo", () => {
    const raw = JSON.stringify({
      [qid(1)]: { ...queued({ id: qid(1) }), status: "assessed" },
      [qid(3)]: queued({ id: qid(3) }),
    });
    expect(Object.keys(parsePhotoQueue(raw))).toEqual([qid(3)]);
  });

  it("repairs a missing walk or arrival time instead of dropping the photo (D-W3 rung 6)", () => {
    const raw = JSON.stringify({
      [qid(1)]: { ...queued({ id: qid(1) }), walkId: 7 },
      [qid(2)]: { ...queued({ id: qid(2), takenAt: at(5) }), addedAt: undefined },
      [qid(3)]: { ...queued({ id: qid(3), takenAt: null }), addedAt: 12 },
    });
    const q = parsePhotoQueue(raw);
    expect(Object.keys(q).sort()).toEqual([qid(1), qid(2), qid(3)]);
    expect(q[qid(1)].walkId).toBe(qid(1));
    expect(q[qid(2)].addedAt).toBe(at(5));
    expect(q[qid(3)].addedAt).toBe("");
  });

  it("repairs an invalid rejected diagnosis to null instead of dropping the photo", () => {
    const raw = JSON.stringify({
      [qid(1)]: queued({ id: qid(1), status: "rejected", rejectedDiagnosis: { health_score: "high" } as unknown as AssessmentDiagnosis }),
      [qid(2)]: queued({ id: qid(2), status: "rejected", rejectedDiagnosis: diagnosis() }),
    });
    const q = parsePhotoQueue(raw);
    expect(q[qid(1)].rejectedDiagnosis).toBeNull();
    expect(q[qid(2)].rejectedDiagnosis).toEqual(diagnosis());
  });

  it("flags unreadable dimensions instead of storing a zero", () => {
    const raw = JSON.stringify({
      [qid(1)]: { ...queued({ id: qid(1) }), width: "wide" },
      [qid(2)]: { ...queued({ id: qid(2) }), height: 0 },
      [qid(3)]: { ...queued({ id: qid(3) }), width: undefined, height: undefined },
      [qid(4)]: queued({ id: qid(4) }),
    });
    const q = parsePhotoQueue(raw);
    for (const n of [1, 2, 3]) {
      expect(q[qid(n)].needsDims).toBe(true);
      expect(q[qid(n)].width).toBeGreaterThan(0);
      expect(q[qid(n)].height).toBeGreaterThan(0);
    }
    expect(q[qid(4)].needsDims).toBeUndefined();
    expect(q[qid(4)]).toMatchObject({ width: 1600, height: 1200 });
  });

  it("keeps needsDims across a save cycle — the repaired 1×1 is never mistaken for a real size", () => {
    const once = parsePhotoQueue(JSON.stringify({ [qid(1)]: { ...queued({ id: qid(1) }), width: 0, height: 0 } }));
    expect(once[qid(1)]).toMatchObject({ width: 1, height: 1, needsDims: true });
    const twice = parsePhotoQueue(serializePhotoQueue(once));
    expect(twice[qid(1)]).toMatchObject({ width: 1, height: 1, needsDims: true });
    // The io writes the same shape (flag + placeholder dims); the flag must win.
    const flagged = parsePhotoQueue(JSON.stringify({ [qid(2)]: { ...queued({ id: qid(2) }), needsDims: true } }));
    expect(flagged[qid(2)].needsDims).toBe(true);
    expect(flagged[qid(3)]).toBeUndefined();
  });

  it("caps a stored error and refuses date fields that are not instants (D-W13)", () => {
    const raw = JSON.stringify({
      [qid(1)]: {
        ...queued({ id: qid(1) }),
        error: "e".repeat(500),
        takenAt: "yesterday-ish",
        startedAt: `${at(0)}${" ".repeat(40)}`,
        runAnchorIso: at(0),
      },
    });
    const q = parsePhotoQueue(raw);
    expect(q[qid(1)].error).toHaveLength(200);
    expect(q[qid(1)].takenAt).toBeNull();
    expect(q[qid(1)].startedAt).toBeNull();
    expect(q[qid(1)].runAnchorIso).toBe(at(0));
  });

  it("repairs the small fields rather than dropping the photo", () => {
    const raw = JSON.stringify({
      [qid(1)]: {
        ...queued({ id: qid(1) }),
        attempts: 1.5,
        evidence: "psychic",
        source: "email",
        takenAt: 12,
        error: 42,
        timedOut: "yes",
        startedAt: {},
        runAnchorIso: [],
        codeDigest: 1,
        fileName: "f".repeat(100),
        groupId: undefined,
      },
      [qid(2)]: { ...queued({ id: qid(2) }), attempts: -3 },
    });
    const q = parsePhotoQueue(raw);
    expect(q[qid(1)]).toMatchObject({
      attempts: 0,
      evidence: "none",
      source: "gallery",
      takenAt: null,
      error: null,
      timedOut: false,
      startedAt: null,
      runAnchorIso: null,
      codeDigest: null,
      groupId: qid(1),
    });
    expect(q[qid(1)].fileName).toHaveLength(80);
    expect(q[qid(2)].attempts).toBe(0);
  });
});
