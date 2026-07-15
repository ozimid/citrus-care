import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { ApiError } from "./api";
import {
  ANALYSIS_OFFLINE_ERROR,
  PHOTO_SAVE_FAILED_ERROR,
  RESULT_LOAD_ERROR,
  friendlyAssessError,
  runAssess,
  type AssessDeps,
  type AssessPhase,
} from "./assess";
import type { PhotoIndexEntry } from "./photo-store";

// D-16 flow: local save FIRST (the photo persists on the phone even if the
// analysis fails) → POST /assess with the base64 image directly → link the
// local uri to the persisted assessment id in the photo index.

const DIAGNOSIS: AssessmentDiagnosis = {
  health_score: 72,
  summary: "Mostly healthy with minor chlorosis.",
  symptoms: [{ label: "Interveinal yellowing", severity: "low" }],
  causes: [{ label: "Nitrogen deficiency", likelihood: "medium", rationale: "Older leaves affected first." }],
  recommendations: [{ priority: 1, action: "Feed with citrus fertilizer", detail: "Apply a balanced citrus feed." }],
};

interface ApiCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: unknown };
}

function makeDeps(overrides: Partial<AssessDeps> = {}) {
  const apiCalls: ApiCall[] = [];
  const saved: { plantId: string; sourceUri: string }[] = [];
  const linked: { assessmentId: string; entry: PhotoIndexEntry }[] = [];
  const deps: AssessDeps = {
    api: async (path, init) => {
      apiCalls.push({ url: path, init });
      return { ok: true, status: 200, json: async () => ({ id: "assessment-9" }) };
    },
    savePhoto: async (plantId, sourceUri) => {
      saved.push({ plantId, sourceUri });
      return "file:///docs/photos/plant-1/saved.jpg";
    },
    readPhotoBase64: async () => "QkFTRTY0",
    linkPhoto: async (assessmentId, entry) => {
      linked.push({ assessmentId, entry });
    },
    loadDiagnosis: async () => DIAGNOSIS,
    ...overrides,
  };
  return { deps, apiCalls, saved, linked };
}

const INPUT = { plantId: "plant-1", photoUri: "file:///tmp/photo.jpg", isCutCare: false };

describe("runAssess (local-first, direct-image escalation)", () => {
  it("saves locally first, posts the base64 image to /assess, links the photo, returns the diagnosis", async () => {
    const { deps, apiCalls, saved, linked } = makeDeps();
    const phases: AssessPhase[] = [];
    const savedUris: string[] = [];

    const result = await runAssess(deps, INPUT, {
      onPhase: (p) => phases.push(p),
      onPhotoSaved: (uri) => savedUris.push(uri),
    });

    expect(result).toEqual({
      assessmentId: "assessment-9",
      diagnosis: DIAGNOSIS,
      localUri: "file:///docs/photos/plant-1/saved.jpg",
    });
    expect(phases).toEqual(["saving", "analyzing"]);
    expect(saved).toEqual([{ plantId: "plant-1", sourceUri: "file:///tmp/photo.jpg" }]);
    expect(savedUris).toEqual(["file:///docs/photos/plant-1/saved.jpg"]);

    // The escalation request carries the image itself — no upload, no photoPath.
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].url).toBe("/assess");
    expect(JSON.parse(apiCalls[0].init?.body as string)).toEqual({
      plantId: "plant-1",
      imageBase64: "QkFTRTY0",
      mime: "image/jpeg",
      isCutCare: false,
    });

    // Local uri ↔ assessment id link, with the engine recorded (D-15 seam).
    expect(linked).toHaveLength(1);
    expect(linked[0].assessmentId).toBe("assessment-9");
    expect(linked[0].entry).toMatchObject({
      localUri: "file:///docs/photos/plant-1/saved.jpg",
      plantId: "plant-1",
      engine: "gemini",
    });
    expect(typeof linked[0].entry.createdAt).toBe("string");
  });

  it("skips the local save when a savedUri from a previous attempt is supplied", async () => {
    const { deps, saved, apiCalls } = makeDeps();
    const phases: AssessPhase[] = [];

    const result = await runAssess(
      deps,
      { ...INPUT, savedUri: "file:///docs/photos/plant-1/kept.jpg" },
      { onPhase: (p) => phases.push(p) },
    );

    expect(phases).toEqual(["analyzing"]);
    expect(saved).toEqual([]);
    expect(apiCalls).toHaveLength(1);
    expect(result.localUri).toBe("file:///docs/photos/plant-1/kept.jpg");
  });

  it("sends isCutCare: true for cut mode", async () => {
    const { deps, apiCalls } = makeDeps();
    await runAssess(deps, { ...INPUT, isCutCare: true });
    expect(JSON.parse(apiCalls[0].init?.body as string)).toMatchObject({ isCutCare: true });
  });

  it("fails with the save error (and never calls the API) when the local save fails", async () => {
    const { deps, apiCalls } = makeDeps({
      savePhoto: async () => {
        throw new Error("disk full: /data/user/0/...");
      },
    });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(PHOTO_SAVE_FAILED_ERROR);
    expect(apiCalls).toHaveLength(0);
  });

  it("maps a network failure AFTER the local save to the offline string (photo is safe)", async () => {
    const { deps, saved } = makeDeps({
      api: async () => {
        throw new TypeError("Network request failed");
      },
    });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(ANALYSIS_OFFLINE_ERROR);
    expect(saved).toHaveLength(1);
  });

  it("rethrows ApiError statuses untouched (server reached — not an offline case)", async () => {
    const { deps } = makeDeps({
      api: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: "Too many assessments. Please try again later.", retryAfter: 1800 }),
      }),
    });
    await expect(runAssess(deps, INPUT)).rejects.toMatchObject({ status: 429, retryAfter: 1800 });
  });

  it("still returns the result when linking the photo index fails (best-effort)", async () => {
    const { deps } = makeDeps({
      linkPhoto: async () => {
        throw new Error("AsyncStorage unavailable");
      },
    });
    const result = await runAssess(deps, INPUT);
    expect(result.assessmentId).toBe("assessment-9");
  });

  it("rejects a diagnosis row that fails the shared Zod schema", async () => {
    const { deps } = makeDeps({ loadDiagnosis: async () => ({ health_score: "not-a-number" }) });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(RESULT_LOAD_ERROR);
  });
});

describe("friendlyAssessError (generic-message rule)", () => {
  it("shows minutes remaining on 429 with retryAfter", () => {
    expect(friendlyAssessError(new ApiError(429, "raw server text", 1800))).toBe(
      "Too many assessments. Try again in 30 min.",
    );
    expect(friendlyAssessError(new ApiError(429, undefined, 61))).toBe(
      "Too many assessments. Try again in 2 min.",
    );
  });

  it("falls back to the waitless 429 string without retryAfter", () => {
    expect(friendlyAssessError(new ApiError(429))).toBe("Too many assessments. Please wait and try again.");
  });

  it("maps auth, missing-plant, AI, and server failures", () => {
    expect(friendlyAssessError(new ApiError(401))).toBe("Session expired — please sign in again.");
    expect(friendlyAssessError(new ApiError(403))).toBe("Permission denied. Please sign in again.");
    expect(friendlyAssessError(new ApiError(404))).toBe("Plant not found. Please close and try again.");
    expect(friendlyAssessError(new ApiError(502))).toBe(
      "The AI service returned an error. Please try again in a moment.",
    );
    expect(friendlyAssessError(new ApiError(500))).toBe("Server error — please try again.");
  });

  it("never leaks raw messages for unknown failures", () => {
    expect(friendlyAssessError(new TypeError("Network request failed"))).toBe(
      "Something went wrong. Please check your connection and try again.",
    );
    expect(friendlyAssessError("weird")).toBe("Something went wrong. Please check your connection and try again.");
  });

  it("passes through the flow's own friendly strings", () => {
    expect(friendlyAssessError(new Error(PHOTO_SAVE_FAILED_ERROR))).toBe(PHOTO_SAVE_FAILED_ERROR);
    expect(friendlyAssessError(new Error(ANALYSIS_OFFLINE_ERROR))).toBe(ANALYSIS_OFFLINE_ERROR);
    expect(friendlyAssessError(new Error(RESULT_LOAD_ERROR))).toBe(RESULT_LOAD_ERROR);
  });
});
