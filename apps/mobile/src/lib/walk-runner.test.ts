import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { ANALYSIS_FAILED_ERROR, ANALYSIS_TIMEOUT_ERROR, LOCAL_UNAVAILABLE_ERROR, type AssessResult } from "./assess";
import type { AssessmentStore } from "./assessment-store";
import { LOCAL_SLOW_THRESHOLD_MS } from "./inference-budget";
import type { QueuedPhoto } from "./photo-queue";
import {
  CONSECUTIVE_TIMEOUT_LIMIT,
  WALK_SLOW_LABEL,
  WHEN_IDLE_CAP_MS,
  anchorsByPlant,
  estimateRemainingMs,
  expectedCopy,
  formatMinutes,
  phaseLabel,
  progressLabel,
  runWalk,
  summarizeWalk,
  summaryCounts,
  summaryHeadline,
  withStoredDiagnosis,
  type ItemOutcome,
  type WalkControl,
  type WalkHooks,
  type WalkRunResult,
  type WalkRunnerDeps,
} from "./walk-runner";

// D-W5: the batch is strictly sequential over the single model session; the
// runner awaits whenIdle() (30 s cap) before every item, two consecutive
// timeouts end the run as "struggling", cancel is "stop after this photo" and
// no user tap ever interrupts. D-W6: one comparison anchor per (plant, walk).
// D-W18: a throwing mark stops the run with the outcomes kept for the summary.

const P1 = "p1-00000001";
const P2 = "p2-00000001";
const W1 = "w1-00000001";
const W2 = "w2-00000001";

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
    basename: "x1-00000001.jpg",
    width: 1600,
    height: 1200,
    takenAt: "2026-09-19T08:00:00.000Z",
    addedAt: "2026-09-19T08:00:05.000Z",
    source: "gallery",
    codeDigest: null,
    fileName: null,
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

function diagnosis(overrides: Partial<AssessmentDiagnosis> = {}): AssessmentDiagnosis {
  return {
    health_score: 78,
    summary: "Looks healthy.",
    subject: "whole_plant",
    symptoms: [],
    causes: [],
    recommendations: [],
    ...overrides,
  };
}

function assessed(id: string, score = 78): AssessResult {
  return { status: "assessed", assessmentId: id, diagnosis: diagnosis({ health_score: score }), localUri: "file:///x.jpg" };
}

function rejected(): AssessResult {
  return { status: "rejected", diagnosis: diagnosis({ subject: "not_a_plant", health_score: 0 }), localUri: "file:///x.jpg" };
}

/** Per-item scripted results: an AssessResult resolves, an Error rejects, a
 * number resolves `assessed` after that many ms (timer-driven), a function
 * runs with the item. */
type Script = AssessResult | Error | number | ((item: QueuedPhoto) => Promise<AssessResult>);

interface Harness {
  deps: WalkRunnerDeps;
  control: WalkControl;
  stop: () => void;
  calls: string[];
  anchors: Record<string, { markAnalyzing: string; assess: string }>;
  marks: {
    assessed: string[];
    rejected: string[];
    failed: Array<{ id: string; error: string; timedOut: boolean }>;
    pending: string[];
    pendingOptions: Array<{ restoreAttempts?: boolean } | undefined>;
  };
  inFlight: { now: number; max: number };
}

function makeHarness(
  script: Record<string, Script>,
  overrides: Partial<WalkRunnerDeps> = {},
  clock: { start?: number; tickMs?: number } = {},
): Harness {
  const calls: string[] = [];
  const anchors: Harness["anchors"] = {};
  const marks: Harness["marks"] = { assessed: [], rejected: [], failed: [], pending: [], pendingOptions: [] };
  const inFlight = { now: 0, max: 0 };
  let t = clock.start ?? Date.UTC(2026, 8, 19, 9, 0, 0);
  const tick = clock.tickMs ?? 1_000;
  let stopped = false;
  const deps: WalkRunnerDeps = {
    async assess(item, anchorIso) {
      calls.push(`assess:${item.id}`);
      anchors[item.id] = { ...(anchors[item.id] ?? { markAnalyzing: "", assess: "" }), assess: anchorIso };
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      try {
        const step = script[item.id];
        if (step === undefined) throw new Error(`unscripted item ${item.id}`);
        if (step instanceof Error) throw step;
        if (typeof step === "function") return await step(item);
        if (typeof step === "number") {
          return await new Promise<AssessResult>((resolve) => setTimeout(() => resolve(assessed(`a-${item.id}`)), step));
        }
        return step;
      } finally {
        inFlight.now -= 1;
      }
    },
    async markAnalyzing(item, _nowIso, anchorIso) {
      calls.push(`markAnalyzing:${item.id}`);
      anchors[item.id] = { ...(anchors[item.id] ?? { markAnalyzing: "", assess: "" }), markAnalyzing: anchorIso };
    },
    async markAssessed(item, assessmentId) {
      calls.push(`markAssessed:${item.id}`);
      marks.assessed.push(assessmentId);
    },
    async markRejected(item) {
      calls.push(`markRejected:${item.id}`);
      marks.rejected.push(item.id);
    },
    async markFailed(item, error, timedOut) {
      calls.push(`markFailed:${item.id}`);
      marks.failed.push({ id: item.id, error, timedOut });
    },
    async markPending(item, options) {
      calls.push(`markPending:${item.id}`);
      marks.pending.push(item.id);
      marks.pendingOptions.push(options);
    },
    async whenIdle() {
      calls.push("whenIdle");
    },
    now() {
      t += tick;
      return t;
    },
    ...overrides,
  };
  const control: WalkControl = {
    requested: () => stopped,
    stopAfterCurrent: () => {
      stopped = true;
    },
  };
  return { deps, control, stop: control.stopAfterCurrent, calls, anchors, marks, inFlight };
}

describe("runWalk — strictly sequential (D-W5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs one item at a time, in input order, never fanning out", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) }), queued({ id: qid(3) })];
    const h = makeHarness({ [qid(1)]: 1_000, [qid(2)]: 1_000, [qid(3)]: 1_000 });

    const pending = runWalk(items, h.deps, h.control);
    await vi.advanceTimersByTimeAsync(3_500);
    const result = await pending;

    expect(h.inFlight.max).toBe(1);
    expect(h.calls.filter((c) => c.startsWith("assess:"))).toEqual([`assess:${qid(1)}`, `assess:${qid(2)}`, `assess:${qid(3)}`]);
    expect(result.endedBy).toBe("complete");
    expect(result.outcomes.map((o) => o.kind)).toEqual(["assessed", "assessed", "assessed"]);
    expect(result.remaining).toBe(0);
  });

  it("awaits whenIdle BEFORE every item's markAnalyzing, and marks before it assesses", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) })];
    const h = makeHarness({ [qid(1)]: assessed("a1"), [qid(2)]: assessed("a2") });

    await runWalk(items, h.deps, h.control);

    expect(h.calls).toEqual([
      "whenIdle",
      `markAnalyzing:${qid(1)}`,
      `assess:${qid(1)}`,
      `markAssessed:${qid(1)}`,
      "whenIdle",
      `markAnalyzing:${qid(2)}`,
      `assess:${qid(2)}`,
      `markAssessed:${qid(2)}`,
    ]);
  });

  it("ends as engine-stalled when whenIdle never resolves within the cap — the item was never marked", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) })];
    const h = makeHarness({ [qid(1)]: assessed("a1") }, { whenIdle: () => new Promise<void>(() => {}) });

    const pending = runWalk(items, h.deps, h.control);
    await vi.advanceTimersByTimeAsync(WHEN_IDLE_CAP_MS - 1);
    expect(h.calls.filter((c) => c !== "whenIdle")).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    const result = await pending;

    expect(result.endedBy).toBe("engine-stalled");
    expect(result.outcomes).toEqual([]);
    expect(result.remaining).toBe(2);
    expect(h.calls).not.toContain(`markAnalyzing:${qid(1)}`);
    expect(h.calls).not.toContain(`assess:${qid(1)}`);
  });

  it("exposes the sequencing constants the design doc names", () => {
    expect(WHEN_IDLE_CAP_MS).toBe(30_000);
    expect(CONSECUTIVE_TIMEOUT_LIMIT).toBe(2);
  });
});

describe("runWalk — the comparison anchor is per (plant, walk) (D-W6)", () => {
  it("shares one instant across a plant's photos of one walk; a second walk gets its own; a persisted anchor wins", async () => {
    const persisted = "2026-09-18T07:00:00.000Z";
    const items = [
      queued({ id: qid(1), plantId: P1, walkId: W1 }),
      queued({ id: qid(2), plantId: P1, walkId: W1 }),
      queued({ id: qid(3), plantId: P1, walkId: W2 }),
      queued({ id: qid(4), plantId: P2, walkId: W1, runAnchorIso: persisted }),
    ];
    const h = makeHarness({
      [qid(1)]: assessed("a1"),
      [qid(2)]: assessed("a2"),
      [qid(3)]: assessed("a3"),
      [qid(4)]: assessed("a4"),
    });

    await runWalk(items, h.deps, h.control);

    const a = h.anchors;
    expect(a[qid(1)].markAnalyzing).toBe(a[qid(1)].assess);
    expect(a[qid(2)].markAnalyzing).toBe(a[qid(1)].markAnalyzing);
    expect(a[qid(2)].assess).toBe(a[qid(1)].assess);
    expect(a[qid(3)].markAnalyzing).not.toBe(a[qid(1)].markAnalyzing);
    expect(a[qid(4)].markAnalyzing).toBe(persisted);
    expect(a[qid(4)].assess).toBe(persisted);
    // The shared instant is a real ISO date minted from deps.now().
    expect(Number.isNaN(Date.parse(a[qid(1)].markAnalyzing))).toBe(false);
  });

  it("a resumed item's persisted anchor seeds its group, so a sibling without one compares against the same visit", async () => {
    const persisted = "2026-09-18T07:00:00.000Z";
    const items = [queued({ id: qid(1), runAnchorIso: persisted }), queued({ id: qid(2) })];
    const h = makeHarness({ [qid(1)]: assessed("a1"), [qid(2)]: assessed("a2") });

    await runWalk(items, h.deps, h.control);

    expect(h.anchors[qid(2)].markAnalyzing).toBe(persisted);
  });
});

describe("runWalk — outcome routing", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("assessed → markAssessed with the id, a duration pushed, and the diagnosis kept", async () => {
    const items = [queued({ id: qid(1) })];
    const h = makeHarness({ [qid(1)]: assessed("a-1", 81) });

    const result = await runWalk(items, h.deps, h.control);

    expect(h.marks.assessed).toEqual(["a-1"]);
    expect(result.durationsMs).toHaveLength(1);
    expect(result.durationsMs[0]).toBeGreaterThan(0);
    expect(result.outcomes[0]).toMatchObject({ kind: "assessed", id: qid(1), plantId: P1, assessmentId: "a-1" });
    const o = result.outcomes[0] as Extract<ItemOutcome, { kind: "assessed" }>;
    expect(o.diagnosis.health_score).toBe(81);
    expect(o.durationMs).toBe(result.durationsMs[0]);
  });

  it("rejected → markRejected with the diagnosis; no duration is recorded", async () => {
    const items = [queued({ id: qid(1) })];
    const h = makeHarness({ [qid(1)]: rejected() });

    const result = await runWalk(items, h.deps, h.control);

    expect(h.marks.rejected).toEqual([qid(1)]);
    expect(result.durationsMs).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({ kind: "rejected", id: qid(1), plantId: P1 });
    expect(result.endedBy).toBe("complete");
  });

  it("a timeout → failed with timedOut:true, and the run continues to the next item", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) })];
    const h = makeHarness({ [qid(1)]: new Error(ANALYSIS_TIMEOUT_ERROR), [qid(2)]: assessed("a2") });

    const result = await runWalk(items, h.deps, h.control);

    expect(h.marks.failed).toEqual([{ id: qid(1), error: ANALYSIS_TIMEOUT_ERROR, timedOut: true }]);
    expect(result.outcomes[0]).toEqual({ kind: "failed", id: qid(1), plantId: P1, error: ANALYSIS_TIMEOUT_ERROR, timedOut: true });
    expect(result.outcomes[1]).toMatchObject({ kind: "assessed", assessmentId: "a2" });
    expect(result.endedBy).toBe("complete");
  });

  it("another flow error → failed with that honest string, timedOut:false", async () => {
    const items = [queued({ id: qid(1) })];
    const h = makeHarness({ [qid(1)]: new Error(ANALYSIS_FAILED_ERROR) });

    const result = await runWalk(items, h.deps, h.control);

    expect(h.marks.failed).toEqual([{ id: qid(1), error: ANALYSIS_FAILED_ERROR, timedOut: false }]);
    expect(result.outcomes[0]).toMatchObject({ kind: "failed", error: ANALYSIS_FAILED_ERROR, timedOut: false });
  });

  it("an unknown throw collapses to the generic string — raw messages never reach the queue", async () => {
    const items = [queued({ id: qid(1) })];
    const h = makeHarness({ [qid(1)]: new Error("ExecutorchError: tensor shape mismatch at 0x7f") });

    const result = await runWalk(items, h.deps, h.control);

    expect(h.marks.failed[0].error).toBe("Something went wrong. Please try again.");
    expect(h.marks.failed[0].timedOut).toBe(false);
    expect(JSON.stringify(result.outcomes)).not.toContain("Executorch");
  });

  it("LOCAL_UNAVAILABLE_ERROR → markPending and engine-unavailable; the remaining items are untouched", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) }), queued({ id: qid(3) })];
    const h = makeHarness({ [qid(1)]: assessed("a1"), [qid(2)]: new Error(LOCAL_UNAVAILABLE_ERROR), [qid(3)]: assessed("a3") });

    const result = await runWalk(items, h.deps, h.control);

    expect(result.endedBy).toBe("engine-unavailable");
    expect(h.marks.pending).toEqual([qid(2)]);
    expect(h.marks.failed).toEqual([]);
    expect(result.outcomes).toHaveLength(1);
    expect(result.remaining).toBe(2);
    expect(h.calls).not.toContain(`markAnalyzing:${qid(3)}`);
    expect(h.calls).not.toContain(`assess:${qid(3)}`);
  });

  it("an engine-unavailable ending hands the attempt back — no model time was spent, so it must not count toward the cap (D-W2)", async () => {
    const items = [queued({ id: qid(1), attempts: 1 })];
    const h = makeHarness({ [qid(1)]: new Error(LOCAL_UNAVAILABLE_ERROR) });

    await runWalk(items, h.deps, h.control);

    expect(h.marks.pendingOptions).toEqual([{ restoreAttempts: true }]);
  });

  it("skips a photo with no plant without spending model time (D-W3 rung 6)", async () => {
    const items = [queued({ id: qid(1), plantId: null, evidence: "none" }), queued({ id: qid(2) })];
    const h = makeHarness({ [qid(2)]: assessed("a2") });

    const result = await runWalk(items, h.deps, h.control);

    expect(h.calls).not.toContain(`assess:${qid(1)}`);
    expect(result.outcomes.map((o) => o.id)).toEqual([qid(2)]);
    expect(result.endedBy).toBe("complete");
  });
});

describe("runWalk — the two-strike breaker (D-W5)", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("two consecutive timeouts end the run as struggling; the third item never starts", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) }), queued({ id: qid(3) })];
    const h = makeHarness({
      [qid(1)]: new Error(ANALYSIS_TIMEOUT_ERROR),
      [qid(2)]: new Error(ANALYSIS_TIMEOUT_ERROR),
      [qid(3)]: assessed("a3"),
    });

    const result = await runWalk(items, h.deps, h.control);

    expect(result.endedBy).toBe("struggling");
    expect(result.outcomes).toHaveLength(2);
    expect(h.marks.failed.map((f) => f.timedOut)).toEqual([true, true]);
    expect(h.calls).not.toContain(`assess:${qid(3)}`);
    expect(result.remaining).toBe(1);
  });

  it("a success between two timeouts resets the strike", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) }), queued({ id: qid(3) }), queued({ id: qid(4) })];
    const h = makeHarness({
      [qid(1)]: new Error(ANALYSIS_TIMEOUT_ERROR),
      [qid(2)]: assessed("a2"),
      [qid(3)]: new Error(ANALYSIS_TIMEOUT_ERROR),
      [qid(4)]: assessed("a4"),
    });

    const result = await runWalk(items, h.deps, h.control);

    expect(result.endedBy).toBe("complete");
    expect(result.outcomes).toHaveLength(4);
  });

  it("a non-timeout failure also resets the strike — only timeouts count", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) }), queued({ id: qid(3) })];
    const h = makeHarness({
      [qid(1)]: new Error(ANALYSIS_TIMEOUT_ERROR),
      [qid(2)]: new Error(ANALYSIS_FAILED_ERROR),
      [qid(3)]: new Error(ANALYSIS_TIMEOUT_ERROR),
    });

    const result = await runWalk(items, h.deps, h.control);

    expect(result.endedBy).toBe("complete");
    expect(result.outcomes).toHaveLength(3);
  });
});

describe("runWalk — stop after the current photo (D-W5)", () => {
  it("a stop requested during item 2 lets item 2 finish and never starts item 3", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) }), queued({ id: qid(3) })];
    let h: Harness;
    h = makeHarness({
      [qid(1)]: assessed("a1"),
      [qid(2)]: async () => {
        h.stop();
        return assessed("a2");
      },
      [qid(3)]: assessed("a3"),
    });

    const result = await runWalk(items, h.deps, h.control);

    expect(result.endedBy).toBe("stopped");
    expect(h.marks.assessed).toEqual(["a1", "a2"]);
    expect(result.outcomes).toHaveLength(2);
    expect(h.calls).not.toContain(`markAnalyzing:${qid(3)}`);
    expect(h.calls).not.toContain(`assess:${qid(3)}`);
    expect(result.remaining).toBe(1);
  });

  it("a stop requested before the first item runs nothing", async () => {
    const items = [queued({ id: qid(1) })];
    const h = makeHarness({ [qid(1)]: assessed("a1") });
    h.stop();

    const result = await runWalk(items, h.deps, h.control);

    expect(result).toEqual({ outcomes: [], endedBy: "stopped", durationsMs: [], remaining: 1 });
    expect(h.calls).toEqual([]);
  });

  it("an empty list completes at once", async () => {
    const h = makeHarness({});
    expect(await runWalk([], h.deps, h.control)).toEqual({ outcomes: [], endedBy: "complete", durationsMs: [], remaining: 0 });
  });
});

describe("runWalk — a throwing mark stops the run (D-W18)", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("markAssessed throwing → storage-error, with the assessed outcome KEPT for the summary", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) })];
    const h = makeHarness(
      { [qid(1)]: assessed("a1"), [qid(2)]: assessed("a2") },
      {
        async markAssessed() {
          throw new Error("SQLITE_FULL");
        },
      },
    );

    const result = await runWalk(items, h.deps, h.control);

    expect(result.endedBy).toBe("storage-error");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ kind: "assessed", assessmentId: "a1" });
    expect(result.durationsMs).toHaveLength(1);
    expect(h.calls).not.toContain(`assess:${qid(2)}`);
    expect(result.remaining).toBe(1);
  });

  it("markAnalyzing throwing → storage-error before any model time is spent", async () => {
    const items = [queued({ id: qid(1) })];
    const h = makeHarness(
      { [qid(1)]: assessed("a1") },
      {
        async markAnalyzing() {
          throw new Error("SQLITE_FULL");
        },
      },
    );

    const result = await runWalk(items, h.deps, h.control);

    expect(result.endedBy).toBe("storage-error");
    expect(result.outcomes).toEqual([]);
    expect(h.calls).not.toContain(`assess:${qid(1)}`);
    expect(result.remaining).toBe(1);
  });

  it("markFailed throwing → storage-error with the failed outcome kept", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) })];
    const h = makeHarness(
      { [qid(1)]: new Error(ANALYSIS_FAILED_ERROR), [qid(2)]: assessed("a2") },
      {
        async markFailed() {
          throw new Error("SQLITE_FULL");
        },
      },
    );

    const result = await runWalk(items, h.deps, h.control);

    expect(result.endedBy).toBe("storage-error");
    expect(result.outcomes).toEqual([{ kind: "failed", id: qid(1), plantId: P1, error: ANALYSIS_FAILED_ERROR, timedOut: false }]);
  });
});

describe("runWalk — hooks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports item start (0-based), the saving → analyzing phases and item end in order", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) })];
    const h = makeHarness({ [qid(1)]: assessed("a1"), [qid(2)]: rejected() });
    const log: string[] = [];
    const hooks: WalkHooks = {
      onItemStart: (index, item) => log.push(`start:${index}:${item.id}`),
      onPhase: (phase) => log.push(`phase:${phase}`),
      onItemEnd: (index, outcome) => log.push(`end:${index}:${outcome.kind}`),
    };

    await runWalk(items, h.deps, h.control, hooks);

    expect(log).toEqual([
      `start:0:${qid(1)}`,
      "phase:saving",
      "phase:analyzing",
      "end:0:assessed",
      `start:1:${qid(2)}`,
      "phase:saving",
      "phase:analyzing",
      "end:1:rejected",
    ]);
  });

  it("fires onSlow once when one photo passes the slow threshold, and not for a quick one", async () => {
    const items = [queued({ id: qid(1) }), queued({ id: qid(2) })];
    const h = makeHarness({ [qid(1)]: LOCAL_SLOW_THRESHOLD_MS + 5_000, [qid(2)]: 1_000 });
    let slow = 0;

    const pending = runWalk(items, h.deps, h.control, { onSlow: () => (slow += 1) });
    await vi.advanceTimersByTimeAsync(LOCAL_SLOW_THRESHOLD_MS + 5_000 + 1_500);
    const result = await pending;

    expect(slow).toBe(1);
    expect(result.outcomes).toHaveLength(2);
  });

  it("a throwing hook never breaks the run", async () => {
    const items = [queued({ id: qid(1) })];
    const h = makeHarness({ [qid(1)]: assessed("a1") });

    const result = await runWalk(items, h.deps, h.control, {
      onItemStart: () => {
        throw new Error("render crashed");
      },
      onItemEnd: () => {
        throw new Error("render crashed");
      },
    });

    expect(result.endedBy).toBe("complete");
    expect(h.marks.assessed).toEqual(["a1"]);
  });
});

describe("estimateRemainingMs (D-W8: measured, median)", () => {
  it("has no estimate before two samples", () => {
    expect(estimateRemainingMs([], 5)).toBeNull();
    expect(estimateRemainingMs([50_000], 5)).toBeNull();
  });

  it("is the median × remaining, so one cold first run does not dominate", () => {
    expect(estimateRemainingMs([40_000, 60_000], 2)).toBe(100_000);
    // Mean would be ~163 s per photo; the median ignores the 400 s outlier.
    expect(estimateRemainingMs([30_000, 60_000, 400_000], 5)).toBe(300_000);
    expect(estimateRemainingMs([30_000, 60_000], 0)).toBe(0);
  });
});

describe("formatMinutes", () => {
  it("rounds to honest coarse buckets", () => {
    expect(formatMinutes(0)).toBe("under a minute");
    expect(formatMinutes(59_999)).toBe("under a minute");
    expect(formatMinutes(60_000)).toBe("about 1 min");
    expect(formatMinutes(80_000)).toBe("about 1 min");
    expect(formatMinutes(9 * 60_000)).toBe("about 9 min");
    expect(formatMinutes(60 * 60_000)).toBe("about 1 h");
    expect(formatMinutes(70 * 60_000)).toBe("about 1 h 10 min");
    expect(formatMinutes(Number.NaN)).toBe("under a minute");
  });
});

describe("expectedCopy (D-W8)", () => {
  it("with no history says 'up to 2 minutes per photo' and asks to keep the app open", () => {
    expect(expectedCopy(12, [])).toBe(
      "Each photo takes up to 2 minutes on this phone — often much less. 12 photos could take a while; keep Citrus Care open.",
    );
    expect(expectedCopy(12, [45_000])).toBe(
      "Each photo takes up to 2 minutes on this phone — often much less. 12 photos could take a while; keep Citrus Care open.",
    );
    expect(expectedCopy(1, [])).toBe("Each photo takes up to 2 minutes on this phone — often much less. Keep Citrus Care open.");
  });

  it("with history estimates from the measured ring", () => {
    expect(expectedCopy(9, [60_000, 60_000])).toBe("About 9 min for 9 photos, based on your last runs. Keep Citrus Care open.");
    expect(expectedCopy(1, [30_000, 40_000])).toBe("Under a minute for 1 photo, based on your last runs. Keep Citrus Care open.");
    expect(expectedCopy(40, [90_000, 120_000, 100_000])).toBe(
      "About 1 h 7 min for 40 photos, based on your last runs. Keep Citrus Care open.",
    );
  });

  it("never leaks the 25 s hint or the 120 s ceiling, and never shows a percentage", () => {
    for (const copy of [expectedCopy(3, []), expectedCopy(3, [50_000, 70_000]), expectedCopy(7, [110_000, 115_000, 119_000])]) {
      expect(copy).not.toContain("25");
      expect(copy).not.toContain("120");
      expect(copy).not.toContain("%");
    }
  });
});

describe("progressLabel / phaseLabel", () => {
  it("is a true count plus a plant plus a phase sentence — never a percentage", () => {
    expect(progressLabel(3, 12, "Meyer lemon", false)).toBe("3 of 12 · Meyer lemon · analyzing on this phone…");
    expect(progressLabel(3, 12, "Meyer lemon", true)).toBe("3 of 12 · Meyer lemon · still analyzing — this one's taking longer…");
    expect(progressLabel(12, 12, "Lime (L3)", true)).not.toContain("%");
  });

  it("phaseLabel carries the single-shot ReviewScreen copy byte for byte", () => {
    expect(phaseLabel("saving", false)).toBe("Saving photo…");
    expect(phaseLabel("analyzing", false)).toBe("Analyzing on this phone…");
    expect(phaseLabel("analyzing", true)).toBe("Still analyzing — the first one takes longer…");
    expect(phaseLabel("saving", true)).toBe("Still analyzing — the first one takes longer…");
    expect(phaseLabel(null, false)).toBe("");
  });

  it("the walk's per-row slow line never claims 'the first one' — it is shown on photo seven too", () => {
    expect(WALK_SLOW_LABEL).toBe("Still analyzing — this one's taking longer…");
    expect(WALK_SLOW_LABEL).not.toContain("first");
    expect(WALK_SLOW_LABEL).not.toContain("%");
  });
});

// The runner's outcome carries what runAssess returned: the model's raw parse.
// The deterministic better/same/worse is injected only on persist
// (withComputedComparison), so the summary, the bulk reminder and the opened
// diagnosis must read the STORED row, never the model's.
describe("withStoredDiagnosis (the D-W6 delta comes from the persisted row)", () => {
  const raw = diagnosis({ health_score: 78 });
  const stored: AssessmentStore = {
    ["a1-00000001"]: {
      id: "a1-00000001",
      plantId: P1,
      createdAt: "2026-09-19T09:00:00.000Z",
      diagnosis: diagnosis({ health_score: 78, comparison: { delta: "worse", notes: "Health fell from 90 to 78." } }),
      comparedToId: "a0-00000001",
      engine: "on-device",
    },
  };

  it("swaps the model's diagnosis for the stored one, comparison included", () => {
    const result: AssessResult = { status: "assessed", assessmentId: "a1-00000001", diagnosis: raw, localUri: "file:///x.jpg" };
    const out = withStoredDiagnosis(result, stored);
    expect(out.status).toBe("assessed");
    expect(out.diagnosis.comparison).toEqual({ delta: "worse", notes: "Health fell from 90 to 78." });
    expect(raw.comparison).toBeUndefined(); // input untouched
  });

  it("keeps the model's diagnosis when the store has no such row (a degraded read), and leaves a rejection alone", () => {
    const result: AssessResult = { status: "assessed", assessmentId: "missing-00000001", diagnosis: raw, localUri: "file:///x.jpg" };
    expect(withStoredDiagnosis(result, stored)).toBe(result);
    const rejection = rejected();
    expect(withStoredDiagnosis(rejection, stored)).toBe(rejection);
  });
});

describe("anchorsByPlant (the summary's 'vs. before' date is the anchor of the plant's latest assessed photo)", () => {
  it("picks the anchor of the LATEST assessed outcome per plant — a second walk of the same plant wins over the first", () => {
    const outcomes: ItemOutcome[] = [
      { kind: "assessed", id: qid(1), plantId: P1, assessmentId: "a1", diagnosis: diagnosis(), durationMs: 1 },
      { kind: "rejected", id: qid(2), plantId: P2, diagnosis: diagnosis({ subject: "not_a_plant" }) },
      { kind: "assessed", id: qid(3), plantId: P1, assessmentId: "a3", diagnosis: diagnosis(), durationMs: 1 },
      { kind: "failed", id: qid(4), plantId: P1, error: ANALYSIS_TIMEOUT_ERROR, timedOut: true },
    ];
    const anchorOf = { [qid(1)]: "2026-09-01T09:00:00.000Z", [qid(3)]: "2026-09-10T09:00:00.000Z", [qid(4)]: "2026-09-10T09:00:00.000Z" };

    expect(anchorsByPlant(outcomes, anchorOf)).toEqual({ [P1]: "2026-09-10T09:00:00.000Z" });
  });

  it("is null for a plant whose assessed photo has no recorded anchor, and empty for no outcomes", () => {
    const outcomes: ItemOutcome[] = [{ kind: "assessed", id: qid(1), plantId: P1, assessmentId: "a1", diagnosis: diagnosis(), durationMs: 1 }];
    expect(anchorsByPlant(outcomes, {})).toEqual({ [P1]: null });
    expect(anchorsByPlant([], {})).toEqual({});
  });
});

describe("summarizeWalk", () => {
  const plants = [
    { id: P1, name: "Meyer lemon" },
    { id: P2, name: "Lime" },
  ];
  const outcomes: ItemOutcome[] = [
    { kind: "assessed", id: qid(1), plantId: P1, assessmentId: "a1", diagnosis: diagnosis({ health_score: 55 }), durationMs: 40_000 },
    { kind: "rejected", id: qid(2), plantId: P2, diagnosis: diagnosis({ subject: "not_a_plant", health_score: 0 }) },
    {
      kind: "assessed",
      id: qid(3),
      plantId: P1,
      assessmentId: "a3",
      diagnosis: diagnosis({ health_score: 78, comparison: { delta: "better", notes: "Up from 55." } }),
      durationMs: 50_000,
    },
    { kind: "failed", id: qid(4), plantId: P1, error: ANALYSIS_TIMEOUT_ERROR, timedOut: true },
    { kind: "failed", id: qid(5), plantId: P2, error: ANALYSIS_FAILED_ERROR, timedOut: false },
  ];

  it("makes one row per plant in first-seen order, with the latest score/band/delta and the per-kind counts", () => {
    const rows = summarizeWalk(outcomes, plants, { [P1]: "2026-09-01T09:00:00.000Z", [P2]: null });

    expect(rows).toEqual([
      {
        plantId: P1,
        plantName: "Meyer lemon",
        count: 3,
        latestScore: 78,
        latestBand: "Good",
        delta: "better",
        anchorDate: "2026-09-01T09:00:00.000Z",
        rejected: 0,
        failed: 0,
        timedOut: 1,
      },
      {
        plantId: P2,
        plantName: "Lime",
        count: 2,
        latestScore: null,
        latestBand: null,
        delta: null,
        anchorDate: null,
        rejected: 1,
        failed: 1,
        timedOut: 0,
      },
    ]);
  });

  it("reads an 'unknown' or missing comparison as no delta, and names a missing plant honestly", () => {
    const rows = summarizeWalk(
      [
        { kind: "assessed", id: qid(1), plantId: "gone-00000001", assessmentId: "a1", diagnosis: diagnosis({ health_score: 30, comparison: { delta: "unknown", notes: "n/a" } }), durationMs: 1 },
      ],
      plants,
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ plantName: "Plant", latestScore: 30, latestBand: "Poor", delta: null, anchorDate: null });
  });

  it("is empty for an empty run", () => {
    expect(summarizeWalk([], plants, {})).toEqual([]);
  });
});

describe("summaryHeadline", () => {
  function result(endedBy: WalkRunResult["endedBy"], outcomes: ItemOutcome[], remaining = 0): WalkRunResult {
    return { outcomes, endedBy, durationsMs: [], remaining };
  }
  const ok = (n: number): ItemOutcome => ({ kind: "assessed", id: qid(n), plantId: P1, assessmentId: `a${n}`, diagnosis: diagnosis(), durationMs: 1 });
  const notPlant = (n: number): ItemOutcome => ({ kind: "rejected", id: qid(n), plantId: P1, diagnosis: diagnosis({ subject: "not_a_plant" }) });
  const tooLong = (n: number): ItemOutcome => ({ kind: "failed", id: qid(n), plantId: P1, error: ANALYSIS_TIMEOUT_ERROR, timedOut: true });
  const broke = (n: number): ItemOutcome => ({ kind: "failed", id: qid(n), plantId: P1, error: ANALYSIS_FAILED_ERROR, timedOut: false });

  it("counts the finished run honestly, omitting empty buckets", () => {
    const many = [...Array.from({ length: 11 }, (_, i) => ok(i + 1)), notPlant(12), tooLong(13), tooLong(14)];
    expect(summaryHeadline(result("complete", many))).toBe("Done · 11 analyzed · 1 wasn't a plant · 2 took too long");
    expect(summaryHeadline(result("complete", [ok(1), ok(2)]))).toBe("Done · 2 analyzed");
    expect(summaryHeadline(result("complete", [ok(1), notPlant(2), notPlant(3), broke(4)]))).toBe(
      "Done · 1 analyzed · 2 weren't plants · 1 couldn't be analyzed",
    );
  });

  it("a stopped run says how many are still waiting", () => {
    const five = Array.from({ length: 5 }, (_, i) => ok(i + 1));
    expect(summaryHeadline(result("stopped", five, 7))).toBe("Stopped · 5 analyzed · 7 waiting");
    expect(summaryHeadline(result("stopped", [], 3))).toBe("Stopped · 0 analyzed · 3 waiting");
  });

  it("a finished run whose photos the user sent back to waiting (a late Retry) says so too", () => {
    expect(summaryHeadline(result("complete", [ok(1)], 1))).toBe("Done · 1 analyzed · 1 waiting");
    expect(summaryHeadline(result("complete", [ok(1)], 0))).toBe("Done · 1 analyzed");
  });

  it("the engine and storage endings are honest, generic sentences", () => {
    expect(summaryHeadline(result("engine-unavailable", []))).toBe("The AI isn't ready on this phone — your photos are kept.");
    expect(summaryHeadline(result("struggling", [tooLong(1), tooLong(2)]))).toBe(
      "This phone is struggling — stopped after two photos took too long. Nothing was lost; try again later.",
    );
    expect(summaryHeadline(result("engine-stalled", []))).toBe("The AI didn't respond — your photos are kept. Try again in a moment.");
    expect(summaryHeadline(result("storage-error", [ok(1)]))).toBe("Couldn't save progress — your photos are kept. Reopen the app and try again.");
  });

  it("never shows a percentage", () => {
    for (const end of ["complete", "stopped", "engine-unavailable", "struggling", "engine-stalled", "storage-error"] as const) {
      expect(summaryHeadline(result(end, [ok(1)], 2))).not.toContain("%");
    }
  });

  // The four abnormal endings keep their cause sentence; the tally the wait
  // bought is a second line, so fourteen minutes and seven scores never read
  // as "this phone is struggling" alone.
  describe("summaryCounts", () => {
    it("is the assessed count plus what is still waiting, for the endings whose headline has no counts", () => {
      const seven = Array.from({ length: 7 }, (_, i) => ok(i + 1));
      expect(summaryCounts(result("struggling", [...seven, tooLong(8), tooLong(9)], 5))).toBe("7 analyzed · 5 still waiting");
      expect(summaryCounts(result("engine-unavailable", [], 12))).toBe("0 analyzed · 12 still waiting");
      expect(summaryCounts(result("engine-stalled", [ok(1)], 1))).toBe("1 analyzed · 1 still waiting");
      expect(summaryCounts(result("storage-error", [ok(1), broke(2)]))).toBe("1 analyzed · 0 still waiting");
    });

    it("is null for complete and stopped — their headline already counts", () => {
      expect(summaryCounts(result("complete", [ok(1)]))).toBeNull();
      expect(summaryCounts(result("stopped", [ok(1)], 2))).toBeNull();
    });
  });
});

// Mirrors arch-guard's D-P9 sweep: the runner only awaits the injected assess
// step, so it must never read as a model caller — not even in a comment.
const RUNNER_SOURCE = join(__dirname, "walk-runner.ts");

describe("guard: walk-runner never contains the model call", () => {
  it("has no `.generate(` / `generate({` text anywhere in the module", () => {
    const source = readFileSync(RUNNER_SOURCE, "utf8");
    expect(source).not.toMatch(/\.generate\(/);
    expect(source).not.toMatch(/generate\(\s*\{/);
    expect(source).not.toMatch(/generate\(/);
  });

  it("imports no react-native or expo module", () => {
    const source = readFileSync(RUNNER_SOURCE, "utf8");
    expect(source).not.toMatch(/from\s+["'](react-native|expo)/);
  });
});
