import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import {
  ANALYSIS_FAILED_ERROR,
  ANALYSIS_TIMEOUT_ERROR,
  ANALYSIS_UNREADABLE_ERROR,
  LOCAL_HARD_CEILING_MS,
  LOCAL_SLOW_THRESHOLD_MS,
  LOCAL_UNAVAILABLE_ERROR,
  PERSIST_FAILED_ERROR,
  PHOTO_SAVE_FAILED_ERROR,
  friendlyAssessError,
  runAssess,
  type AssessDeps,
  type AssessPhase,
  type AssessResult,
  type AssessedResult,
  type LocalAssessDeps,
} from "./assess";
import type { PhotoIndexEntry } from "./photo-store";

/** Narrow to the persisted branch — fails loudly rather than typing around it. */
function assessed(result: AssessResult): AssessedResult {
  if (result.status !== "assessed") {
    throw new Error(`expected an assessed result, got "${result.status}"`);
  }
  return result;
}

// D-17: Gemma is the only engine. The flow saves the photo on the phone FIRST
// (it persists even if analysis fails), runs the on-device model, and persists
// the diagnosis locally. There is no cloud fallback: a phone that can't run the
// model gets an honest, retryable error, not a silent escalation.

const LOCAL_JSON = JSON.stringify({
  health_score: 81,
  summary: "Healthy foliage, no visible pests.",
  subject: "leaf",
  symptoms: [],
  causes: [],
  recommendations: [{ priority: 1, action: "Keep watering weekly", detail: "Same schedule." }],
});

const LOCAL_DIAGNOSIS: AssessmentDiagnosis = JSON.parse(LOCAL_JSON);

function makeLocal(overrides: Partial<LocalAssessDeps> = {}) {
  const generated: { imageUri: string }[] = [];
  const persisted: unknown[] = [];
  const prepared: string[] = [];
  const interrupted: number[] = [];
  const local: LocalAssessDeps = {
    isReady: () => true,
    prepare: async (uri) => {
      prepared.push(uri);
      return `${uri}#512`;
    },
    generate: async (args) => {
      generated.push(args);
      return LOCAL_JSON;
    },
    persist: async (args) => {
      persisted.push(args);
      return "assessment-local-1";
    },
    interrupt: () => {
      interrupted.push(Date.now());
    },
    ...overrides,
  };
  return { local, generated, persisted, prepared, interrupted };
}

function makeDeps(overrides: Partial<AssessDeps> = {}) {
  const saved: { plantId: string; sourceUri: string }[] = [];
  const linked: { assessmentId: string; entry: PhotoIndexEntry }[] = [];
  const { local } = makeLocal();
  const deps: AssessDeps = {
    savePhoto: async (plantId, sourceUri) => {
      saved.push({ plantId, sourceUri });
      return "file:///docs/photos/plant-1/saved.jpg";
    },
    linkPhoto: async (assessmentId, entry) => {
      linked.push({ assessmentId, entry });
    },
    local,
    ...overrides,
  };
  return { deps, saved, linked };
}

const INPUT = { plantId: "plant-1", photoUri: "file:///tmp/photo.jpg" };

describe("runAssess (Gemma-only)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves locally first, runs the on-device model, persists, links, returns the diagnosis", async () => {
    const { local, prepared, generated, persisted } = makeLocal();
    const { deps, saved, linked } = makeDeps({ local });
    const phases: AssessPhase[] = [];
    const savedUris: string[] = [];

    const result = await runAssess(deps, INPUT, {
      onPhase: (p) => phases.push(p),
      onPhotoSaved: (uri) => savedUris.push(uri),
    });

    expect(result).toEqual({
      status: "assessed",
      assessmentId: "assessment-local-1",
      diagnosis: LOCAL_DIAGNOSIS,
      localUri: "file:///docs/photos/plant-1/saved.jpg",
      engine: "on-device",
    });
    expect(phases).toEqual(["saving", "analyzing"]);
    expect(saved).toEqual([{ plantId: "plant-1", sourceUri: "file:///tmp/photo.jpg" }]);
    expect(savedUris).toEqual(["file:///docs/photos/plant-1/saved.jpg"]);

    // 512px downscale before inference (research doc: full-res = minutes).
    expect(prepared).toEqual(["file:///docs/photos/plant-1/saved.jpg"]);
    expect(generated).toEqual([{ imageUri: "file:///docs/photos/plant-1/saved.jpg#512" }]);

    // Persisted directly on the phone, raw output kept. No cut flag: the row
    // derives it from the diagnosis's own subject (F21).
    expect(persisted).toEqual([
      { plantId: "plant-1", diagnosis: LOCAL_DIAGNOSIS, raw: LOCAL_JSON },
    ]);

    // The index records the engine that produced the row.
    expect(linked).toHaveLength(1);
    expect(linked[0].assessmentId).toBe("assessment-local-1");
    expect(linked[0].entry).toMatchObject({
      localUri: "file:///docs/photos/plant-1/saved.jpg",
      plantId: "plant-1",
      engine: "on-device",
    });
    expect(typeof linked[0].entry.createdAt).toBe("string");
  });

  it("skips the local save when a savedUri from a previous attempt is supplied", async () => {
    const { deps, saved } = makeDeps();
    const phases: AssessPhase[] = [];

    const result = await runAssess(
      deps,
      { ...INPUT, savedUri: "file:///docs/photos/plant-1/kept.jpg" },
      { onPhase: (p) => phases.push(p) },
    );

    expect(phases).toEqual(["analyzing"]);
    expect(saved).toEqual([]);
    expect(result.localUri).toBe("file:///docs/photos/plant-1/kept.jpg");
  });

  it("keeps a cut detected by the local model — no mode was ever needed (F21)", async () => {
    const { local, persisted } = makeLocal({
      generate: async () => JSON.stringify({ ...LOCAL_DIAGNOSIS, subject: "cut" }),
    });
    const { deps } = makeDeps({ local });
    const result = await runAssess(deps, INPUT);
    expect(result.engine).toBe("on-device");
    expect(result.diagnosis.subject).toBe("cut");
    expect(persisted).toHaveLength(1);
  });

  it("fails with the save error (and never runs the model) when the local save fails", async () => {
    const { local, generated } = makeLocal();
    const { deps } = makeDeps({
      local,
      savePhoto: async () => {
        throw new Error("disk full: /data/user/0/...");
      },
    });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(PHOTO_SAVE_FAILED_ERROR);
    expect(generated).toEqual([]);
  });

  it("still returns the result when linking the photo index fails (best-effort)", async () => {
    const { deps } = makeDeps({
      linkPhoto: async () => {
        throw new Error("AsyncStorage unavailable");
      },
    });
    const result = await runAssess(deps, INPUT);
    expect(assessed(result).assessmentId).toBe("assessment-local-1");
  });
});

// D-17: there is no cloud fallback, so every on-device failure is terminal and
// user-visible. Each one is a distinct, honest, retryable message — never a
// silent escalation, never a raw model/runtime string.
describe("runAssess on-device failures are terminal (no fallback)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errors honestly when the on-device model isn't set up / ready", async () => {
    const { local } = makeLocal({ isReady: () => false });
    const { deps } = makeDeps({ local });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(LOCAL_UNAVAILABLE_ERROR);
  });

  it("errors when the model throws (e.g. OOM), photo already saved", async () => {
    const { local } = makeLocal({
      generate: async () => {
        throw new Error("ExecuTorch: failed to allocate 400MB");
      },
    });
    const { deps, saved } = makeDeps({ local });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(ANALYSIS_FAILED_ERROR);
    expect(saved).toHaveLength(1);
  });

  it("errors when the model output can't be parsed to the shared schema", async () => {
    const { local, persisted } = makeLocal({
      generate: async () => 'Sure! Here you go: {"health_score": "very bad"}',
    });
    const { deps } = makeDeps({ local });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(ANALYSIS_UNREADABLE_ERROR);
    // Never persist output that didn't validate.
    expect(persisted).toEqual([]);
  });

  it("errors when the model output contains no JSON at all", async () => {
    const { local } = makeLocal({ generate: async () => "I cannot see a plant in this image." });
    const { deps } = makeDeps({ local });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(ANALYSIS_UNREADABLE_ERROR);
  });

  it("errors when the local persist fails", async () => {
    const { local } = makeLocal({
      persist: async () => {
        throw new Error("AsyncStorage write failed");
      },
    });
    const { deps } = makeDeps({ local });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(PERSIST_FAILED_ERROR);
  });
});

// F21: a non-plant photo must not land in a plant's timeline. "Save anyway" is
// the user's override — never the model's.
describe("runAssess not_a_plant rejection (F21)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const NOT_A_PLANT = {
    health_score: 0,
    summary: "This is a coffee mug, not a plant.",
    subject: "not_a_plant",
    subject_note: "Ceramic mug on a desk.",
    symptoms: [],
    causes: [],
    recommendations: [],
  };

  it("returns a rejection without persisting, photo still on the phone", async () => {
    const { local, persisted } = makeLocal({ generate: async () => JSON.stringify(NOT_A_PLANT) });
    const { deps, linked } = makeDeps({ local });

    const result = await runAssess(deps, INPUT);

    expect(result.status).toBe("rejected");
    expect(result.diagnosis.subject).toBe("not_a_plant");
    expect(result.engine).toBe("on-device");
    expect(result.localUri).toBe("file:///docs/photos/plant-1/saved.jpg");
    expect(persisted).toEqual([]);
    // Nothing to link: there is no assessment to link a photo to.
    expect(linked).toEqual([]);
  });

  it("persists a local not_a_plant result when the user forces it", async () => {
    const { local, persisted } = makeLocal({ generate: async () => JSON.stringify(NOT_A_PLANT) });
    const { deps } = makeDeps({ local });

    const result = await runAssess(deps, { ...INPUT, force: true });

    expect(result.status).toBe("assessed");
    expect(persisted).toHaveLength(1);
    expect(assessed(result).assessmentId).toBe("assessment-local-1");
  });
});

describe("runAssess local inference budget (slow hint + hard ceiling)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires the slow hint but keeps waiting for a result past the slow threshold", async () => {
    const { local } = makeLocal({
      generate: () =>
        new Promise<string>((resolve) => setTimeout(() => resolve(LOCAL_JSON), LOCAL_SLOW_THRESHOLD_MS + 5_000)),
    });
    const { deps } = makeDeps({ local });
    const slow: number[] = [];

    const pending = runAssess(deps, INPUT, { onSlow: () => slow.push(Date.now()) });
    await vi.advanceTimersByTimeAsync(LOCAL_SLOW_THRESHOLD_MS + 5_000);

    const result = await pending;
    expect(slow).toHaveLength(1);
    expect(result.engine).toBe("on-device");
  });

  it("interrupts the session and errors at the hard ceiling", async () => {
    const { local, interrupted } = makeLocal({ generate: () => new Promise<string>(() => {}) });
    const { deps } = makeDeps({ local });

    const pending = runAssess(deps, INPUT);
    const assertion = expect(pending).rejects.toThrow(ANALYSIS_TIMEOUT_ERROR);
    await vi.advanceTimersByTimeAsync(LOCAL_HARD_CEILING_MS + 1);
    await assertion;
    // interrupt() frees the single native session so the next attempt isn't blocked.
    expect(interrupted).toHaveLength(1);
  });

  it("keeps a result that lands just inside the hard ceiling", async () => {
    const { local } = makeLocal({
      generate: () =>
        new Promise<string>((resolve) => setTimeout(() => resolve(LOCAL_JSON), LOCAL_HARD_CEILING_MS - 1)),
    });
    const { deps } = makeDeps({ local });

    const pending = runAssess(deps, INPUT);
    await vi.advanceTimersByTimeAsync(LOCAL_HARD_CEILING_MS);
    expect((await pending).engine).toBe("on-device");
  });

  it("gives the slow hint room before the hard ceiling", () => {
    expect(LOCAL_SLOW_THRESHOLD_MS).toBeLessThan(LOCAL_HARD_CEILING_MS);
  });
});

describe("friendlyAssessError (generic-message rule)", () => {
  it("passes through the flow's own honest, retryable strings", () => {
    for (const msg of [
      PHOTO_SAVE_FAILED_ERROR,
      LOCAL_UNAVAILABLE_ERROR,
      ANALYSIS_FAILED_ERROR,
      ANALYSIS_UNREADABLE_ERROR,
      ANALYSIS_TIMEOUT_ERROR,
      PERSIST_FAILED_ERROR,
    ]) {
      expect(friendlyAssessError(new Error(msg))).toBe(msg);
    }
  });

  it("never leaks raw messages for unknown failures", () => {
    expect(friendlyAssessError(new TypeError("Vulkan device lost @0xdeadbeef"))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(friendlyAssessError("weird")).toBe("Something went wrong. Please try again.");
  });
});
