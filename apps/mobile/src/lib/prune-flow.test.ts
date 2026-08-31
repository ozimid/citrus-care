import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_HARD_CEILING_MS, LOCAL_SLOW_THRESHOLD_MS } from "./inference-budget";
import {
  PRUNE_ANALYSIS_FAILED_ERROR,
  PRUNE_PERSIST_ERROR,
  PRUNE_PHOTO_SAVE_ERROR,
  PRUNE_TIMEOUT_ERROR,
  PRUNE_UNAVAILABLE_ERROR,
  PRUNE_UNREADABLE_ERROR,
  type PrunePromptRules,
} from "./prune-plan";
import { runPruneAnalysis, type PruneAnalysisDeps, type PruneAnalysisResult } from "./prune-flow";

const RULES: PrunePromptRules = {
  className: "Rose",
  seasonLine: "Late August: deadhead only.",
  rules: ["Cut above an outward-facing bud eye."],
  never: ["Never leave a stub."],
};

const MODEL_JSON = JSON.stringify({
  summary: "Two crossing canes in the middle.",
  subject: "plant",
  confidence: "medium",
  cuts: [{ label: "Crossing cane", action: "Cut here", reason: "Rubs", priority: 1, x: 40, y: 55 }],
  general_steps: ["Wipe the blades between plants."],
});

const INPUT = {
  plantId: "plant-1",
  photoUri: "file:///tmp/shot.jpg",
  photoAspect: 0.75,
  ruleClass: "rose",
  rules: RULES,
};

function makeDeps(overrides: Partial<PruneAnalysisDeps> = {}) {
  const saved: { plantId: string; sourceUri: string }[] = [];
  const prepared: string[] = [];
  const generated: { imageUri: string; system: string; user: string }[] = [];
  const persisted: unknown[] = [];
  const interrupted: string[] = [];
  const deps: PruneAnalysisDeps = {
    isReady: () => true,
    savePhoto: async (plantId, sourceUri) => {
      saved.push({ plantId, sourceUri });
      return "file:///docs/photos/plant-1/saved.jpg";
    },
    prepare: async (uri) => {
      prepared.push(uri);
      return `${uri}#512`;
    },
    generate: async (args) => {
      generated.push(args);
      return MODEL_JSON;
    },
    persist: async (args) => {
      persisted.push(args);
      return "plan-1";
    },
    interrupt: () => interrupted.push("interrupt"),
    ...overrides,
  };
  return { deps, saved, prepared, generated, persisted, interrupted };
}

function planned(result: PruneAnalysisResult) {
  if (result.status !== "planned") throw new Error(`expected a planned result, got ${result.status}`);
  return result;
}

describe("runPruneAnalysis happy path", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("saves the photo, analyses the downscaled copy, and stores the plan", async () => {
    const { deps, saved, prepared, generated, persisted } = makeDeps();
    const result = planned(await runPruneAnalysis(deps, INPUT));

    expect(saved).toEqual([{ plantId: "plant-1", sourceUri: "file:///tmp/shot.jpg" }]);
    expect(prepared).toEqual(["file:///docs/photos/plant-1/saved.jpg"]);
    expect(generated[0].imageUri).toBe("file:///docs/photos/plant-1/saved.jpg#512");
    expect(result.planId).toBe("plan-1");
    expect(result.plan.cuts).toHaveLength(1);
    expect(result.localUri).toBe("file:///docs/photos/plant-1/saved.jpg");
    expect(persisted).toEqual([
      {
        plantId: "plant-1",
        photoUri: "file:///docs/photos/plant-1/saved.jpg",
        photoAspect: 0.75,
        ruleClass: "rose",
        plan: result.plan,
      },
    ]);
  });

  it("puts this plant's rules in the prompt it sends", async () => {
    const { deps, generated } = makeDeps();
    await runPruneAnalysis(deps, INPUT);
    expect(generated[0].system).toContain("Rose");
    expect(generated[0].system).toContain("Cut above an outward-facing bud eye.");
    expect(generated[0].system).toContain("Late August: deadhead only.");
    expect(generated[0].user.length).toBeGreaterThan(0);
  });

  it("reports the phases so the screen can say what it is doing", async () => {
    const { deps } = makeDeps();
    const phases: string[] = [];
    await runPruneAnalysis(deps, INPUT, { onPhase: (phase) => phases.push(phase) });
    expect(phases).toEqual(["saving", "analyzing"]);
  });

  it("hands the durable uri up as soon as the photo lands", async () => {
    const { deps } = makeDeps();
    const uris: string[] = [];
    await runPruneAnalysis(deps, INPUT, { onPhotoSaved: (uri) => uris.push(uri) });
    expect(uris).toEqual(["file:///docs/photos/plant-1/saved.jpg"]);
  });
});

describe("runPruneAnalysis failure modes are honest and retryable", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("fails on a photo it could not save", async () => {
    const { deps } = makeDeps({
      savePhoto: async () => {
        throw new Error("ENOSPC");
      },
    });
    await expect(runPruneAnalysis(deps, INPUT)).rejects.toThrow(PRUNE_PHOTO_SAVE_ERROR);
  });

  it("keeps the photo but refuses to analyse when the engine isn't ready", async () => {
    const { deps, saved, generated } = makeDeps({ isReady: () => false });
    await expect(runPruneAnalysis(deps, INPUT)).rejects.toThrow(PRUNE_UNAVAILABLE_ERROR);
    expect(saved).toHaveLength(1);
    expect(generated).toHaveLength(0);
  });

  it("turns a model crash into a retryable error", async () => {
    const { deps } = makeDeps({
      generate: async () => {
        throw new Error("vulkan device lost");
      },
    });
    await expect(runPruneAnalysis(deps, INPUT)).rejects.toThrow(PRUNE_ANALYSIS_FAILED_ERROR);
  });

  it("reports unreadable output rather than inventing a plan", async () => {
    const { deps, persisted } = makeDeps({ generate: async () => "I'm not sure, sorry!" });
    await expect(runPruneAnalysis(deps, INPUT)).rejects.toThrow(PRUNE_UNREADABLE_ERROR);
    expect(persisted).toHaveLength(0);
  });

  it("surfaces a failed store write", async () => {
    const { deps } = makeDeps({
      persist: async () => {
        throw new Error("AsyncStorage full");
      },
    });
    await expect(runPruneAnalysis(deps, INPUT)).rejects.toThrow(PRUNE_PERSIST_ERROR);
  });

  it("does not store a plan for a photo with no plant in it", async () => {
    const { deps, persisted } = makeDeps({
      generate: async () =>
        JSON.stringify({ summary: "This is a keyboard.", subject: "not_a_plant", cuts: [] }),
    });
    const result = await runPruneAnalysis(deps, INPUT);
    expect(result.status).toBe("rejected");
    expect(persisted).toHaveLength(0);
  });

  it("DOES store a plan the model marked unclear — the seasonal advice still helps", async () => {
    const { deps, persisted } = makeDeps({
      generate: async () =>
        JSON.stringify({ summary: "Too dark to place a cut.", subject: "unclear", cuts: [] }),
    });
    const result = planned(await runPruneAnalysis(deps, INPUT));
    expect(result.plan.subject).toBe("unclear");
    expect(persisted).toHaveLength(1);
  });
});

describe("runPruneAnalysis under the shared inference budget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hints that it is slow but keeps waiting", async () => {
    const slow: string[] = [];
    const { deps } = makeDeps({
      generate: () =>
        new Promise<string>((resolve) =>
          setTimeout(() => resolve(MODEL_JSON), LOCAL_SLOW_THRESHOLD_MS + 1_000),
        ),
    });
    const pending = runPruneAnalysis(deps, INPUT, { onSlow: () => slow.push("slow") });
    await vi.advanceTimersByTimeAsync(LOCAL_SLOW_THRESHOLD_MS + 1_000);
    expect((await pending).status).toBe("planned");
    expect(slow).toEqual(["slow"]);
  });

  it("interrupts the session and gives up honestly at the ceiling", async () => {
    const { deps, interrupted } = makeDeps({ generate: () => new Promise<string>(() => {}) });
    const pending = runPruneAnalysis(deps, INPUT);
    const assertion = expect(pending).rejects.toThrow(PRUNE_TIMEOUT_ERROR);
    await vi.advanceTimersByTimeAsync(LOCAL_HARD_CEILING_MS + 1);
    await assertion;
    expect(interrupted).toEqual(["interrupt"]);
  });
});

// Device feedback 2026-08-31, round two: the screen said the model failed but
// nothing recorded WHY or WHAT it said — so every failure is a guessing game.
// The debug hook reports the run's outcome + the raw model text; the caller
// stores it on the phone and the user can choose to email it.
describe("runPruneAnalysis onDebug", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("reports an unreadable answer with its parse reason and the raw text", async () => {
    const debugs: unknown[] = [];
    const { deps } = makeDeps({ generate: async () => "I cannot see any plant here, sorry!" });
    await expect(
      runPruneAnalysis(deps, INPUT, { onDebug: (d) => debugs.push(d) }),
    ).rejects.toThrow(PRUNE_UNREADABLE_ERROR);
    expect(debugs).toEqual([
      { outcome: "unreadable", reason: "no-json", raw: "I cannot see any plant here, sorry!" },
    ]);
  });

  it("reports a successful run with cut and dropped-mark counts", async () => {
    const debugs: Array<{ raw?: unknown }> = [];
    const { deps } = makeDeps({
      generate: async () =>
        JSON.stringify({
          summary: "ok",
          subject: "plant",
          cuts: [
            { label: "A", action: "Cut", reason: "Why", priority: 1, x: 40, y: 40 },
            { label: "B", action: "Cut", reason: "Why", priority: 1, x: -4, y: 40 },
          ],
        }),
    });
    await runPruneAnalysis(deps, INPUT, { onDebug: (d) => debugs.push(d) });
    expect(debugs[0]).toMatchObject({ outcome: "planned", cuts: 2, drawable: 1, dropped: 1, subject: "plant" });
    expect(typeof debugs[0].raw).toBe("string");
  });

  it("never lets a throwing debug hook break the run", async () => {
    const { deps } = makeDeps();
    const result = await runPruneAnalysis(deps, INPUT, {
      onDebug: () => {
        throw new Error("debug sink exploded");
      },
    });
    expect(result.status).toBe("planned");
  });
});

describe("onDebug covers the failure class the full-res change most risks", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("reports an inference crash as outcome 'failed'", async () => {
    const debugs: Array<{ outcome?: string }> = [];
    const { deps } = makeDeps({
      generate: async () => {
        throw new Error("native OOM");
      },
    });
    await expect(
      runPruneAnalysis(deps, INPUT, { onDebug: (d) => debugs.push(d) }),
    ).rejects.toThrow(PRUNE_ANALYSIS_FAILED_ERROR);
    expect(debugs[0]).toMatchObject({ outcome: "failed", raw: "" });
    expect(typeof (debugs[0] as { elapsedMs?: unknown }).elapsedMs).toBe("number");
  });

  it("reports the hard ceiling as outcome 'timeout' — the datum IS that there was no text", async () => {
    vi.useFakeTimers();
    const debugs: Array<{ outcome?: string }> = [];
    const { deps } = makeDeps({ generate: () => new Promise<string>(() => {}) });
    const pending = runPruneAnalysis(deps, INPUT, { onDebug: (d) => debugs.push(d) });
    const assertion = expect(pending).rejects.toThrow(PRUNE_TIMEOUT_ERROR);
    await vi.advanceTimersByTimeAsync(LOCAL_HARD_CEILING_MS + 1);
    await assertion;
    expect(debugs[0]).toMatchObject({ outcome: "timeout", raw: "" });
    vi.useRealTimers();
  });
});

describe("an already-durable photo is not copied again", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  // The latest-photo default and retry-same-shot both feed the flow a photo
  // that is ALREADY in durable storage; re-saving it duplicated the file on
  // every run (critic finding). savedUri short-circuits the save.
  it("skips the save when the caller marks the photo durable", async () => {
    const { deps, saved, prepared } = makeDeps();
    const result = await runPruneAnalysis(deps, {
      ...INPUT,
      photoUri: "file:///docs/photos/plant-1/already.jpg",
      savedUri: "file:///docs/photos/plant-1/already.jpg",
    });
    expect(saved).toEqual([]);
    expect(prepared).toEqual(["file:///docs/photos/plant-1/already.jpg"]);
    expect(result.status).toBe("planned");
  });
});
