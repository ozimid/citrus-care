import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { ApiError } from "./api";
import {
  RESULT_LOAD_ERROR,
  UPLOAD_FAILED_ERROR,
  friendlyAssessError,
  runAssess,
  type AssessDeps,
  type AssessPhase,
} from "./assess";

const DIAGNOSIS: AssessmentDiagnosis = {
  health_score: 72,
  summary: "Mostly healthy with minor chlorosis.",
  symptoms: [{ label: "Interveinal yellowing", severity: "low" }],
  causes: [{ label: "Nitrogen deficiency", likelihood: "medium", rationale: "Older leaves affected first." }],
  recommendations: [{ priority: 1, action: "Feed with citrus fertilizer", detail: "Apply a balanced citrus feed." }],
};

interface Call {
  kind: "api" | "raw";
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: unknown };
}

function makeDeps(overrides: Partial<AssessDeps> = {}) {
  const calls: Call[] = [];
  const blob = { size: 3 };
  const deps: AssessDeps = {
    api: async (path, init) => {
      calls.push({ kind: "api", url: path, init });
      if (path === "/photos/sign-upload") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ photoPath: "user-1/plant-1/p.jpg", uploadUrl: "https://signed.example/put" }),
        };
      }
      // /assess
      return { ok: true, status: 200, json: async () => ({ id: "assessment-9" }) };
    },
    fetchRaw: async (url, init) => {
      calls.push({ kind: "raw", url, init });
      return { ok: true, status: 200, json: async () => ({}), blob: async () => blob };
    },
    loadDiagnosis: async () => DIAGNOSIS,
    ...overrides,
  };
  return { deps, calls, blob };
}

const INPUT = { plantId: "plant-1", photoUri: "file:///tmp/photo.jpg", isCutCare: false };

describe("runAssess", () => {
  it("signs the upload, PUTs the jpeg bytes, posts /assess, and returns the parsed diagnosis", async () => {
    const { deps, calls, blob } = makeDeps();
    const phases: AssessPhase[] = [];
    const uploaded: string[] = [];

    const result = await runAssess(deps, INPUT, {
      onPhase: (p) => phases.push(p),
      onPhotoUploaded: (p) => uploaded.push(p),
    });

    expect(result).toEqual({ assessmentId: "assessment-9", diagnosis: DIAGNOSIS });
    expect(phases).toEqual(["uploading", "analyzing"]);
    expect(uploaded).toEqual(["user-1/plant-1/p.jpg"]);

    // sign-upload request body
    const sign = calls.find((c) => c.url === "/photos/sign-upload");
    expect(JSON.parse(sign?.init?.body as string)).toEqual({ plantId: "plant-1", mime: "image/jpeg" });

    // bytes read from the local uri, then PUT to the signed url as image/jpeg
    expect(calls.some((c) => c.kind === "raw" && c.url === INPUT.photoUri)).toBe(true);
    const put = calls.find((c) => c.url === "https://signed.example/put");
    expect(put?.init?.method).toBe("PUT");
    expect(put?.init?.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(put?.init?.body).toBe(blob);

    // /assess request carries only the server-supported fields
    const assess = calls.find((c) => c.url === "/assess");
    expect(JSON.parse(assess?.init?.body as string)).toEqual({
      plantId: "plant-1",
      photoPath: "user-1/plant-1/p.jpg",
      isCutCare: false,
    });
  });

  it("skips sign-upload and PUT when a photoPath from a previous attempt is supplied", async () => {
    const { deps, calls } = makeDeps();
    const phases: AssessPhase[] = [];

    await runAssess(deps, { ...INPUT, photoPath: "user-1/plant-1/kept.jpg" }, { onPhase: (p) => phases.push(p) });

    expect(phases).toEqual(["analyzing"]);
    expect(calls.filter((c) => c.kind === "raw")).toHaveLength(0);
    const assess = calls.find((c) => c.url === "/assess");
    expect(JSON.parse(assess?.init?.body as string)).toMatchObject({ photoPath: "user-1/plant-1/kept.jpg" });
  });

  it("sends isCutCare: true for cut mode", async () => {
    const { deps, calls } = makeDeps();
    await runAssess(deps, { ...INPUT, isCutCare: true });
    const assess = calls.find((c) => c.url === "/assess");
    expect(JSON.parse(assess?.init?.body as string)).toMatchObject({ isCutCare: true });
  });

  it("throws an ApiError carrying retryAfter when /assess is rate limited", async () => {
    const { deps } = makeDeps({
      api: async (path) => {
        if (path === "/photos/sign-upload") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ photoPath: "user-1/p.jpg", uploadUrl: "https://signed.example/put" }),
          };
        }
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: "Too many assessments. Please try again later.", retryAfter: 1800 }),
        };
      },
    });
    await expect(runAssess(deps, INPUT)).rejects.toMatchObject({ status: 429, retryAfter: 1800 });
  });

  it("fails with the generic upload string when the signed-URL PUT rejects", async () => {
    const { deps } = makeDeps({
      fetchRaw: async (url, init) =>
        init?.method === "PUT"
          ? { ok: false, status: 403, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({}), blob: async () => ({}) },
    });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(UPLOAD_FAILED_ERROR);
  });

  it("rejects a diagnosis row that fails the shared Zod schema", async () => {
    const { deps } = makeDeps({ loadDiagnosis: async () => ({ health_score: "not-a-number" }) });
    await expect(runAssess(deps, INPUT)).rejects.toThrow(RESULT_LOAD_ERROR);
  });
});

describe("friendlyAssessError (web-parity strings)", () => {
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

  it("maps auth, ownership, missing-photo, AI, and server failures", () => {
    expect(friendlyAssessError(new ApiError(401))).toBe("Session expired — please sign in again.");
    expect(friendlyAssessError(new ApiError(403))).toBe("Permission denied. Please sign in again.");
    expect(friendlyAssessError(new ApiError(404))).toBe("Photo not found. Please re-upload and try again.");
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
    expect(friendlyAssessError(new Error(UPLOAD_FAILED_ERROR))).toBe(UPLOAD_FAILED_ERROR);
    expect(friendlyAssessError(new Error(RESULT_LOAD_ERROR))).toBe(RESULT_LOAD_ERROR);
  });
});
