import { describe, expect, it } from "vitest";
import type { AssessmentDiagnosis } from "@citrus/shared";
import {
  DEFAULT_LOCAL_ENGINE_SETTINGS,
  buildLocalAssessmentRow,
  localEngineState,
  localEngineStatusLabel,
  localEngineSubtitle,
  localSystemPrompt,
  needsDownloadWarning,
  parseLocalEngineSettings,
  serializeLocalEngineSettings,
  shouldRouteLocal,
  type LocalEngineRuntime,
  type LocalEngineSettings,
} from "./local-engine";

// D-15 Stage 2: the on-device engine is opt-in (off by default) and the router
// only uses it once the executorch session reports ready. Everything here is
// pure — the AsyncStorage/Supabase wiring lives in local-engine-io.ts.

const OFF: LocalEngineSettings = { enabled: false, downloaded: false };
const ON: LocalEngineSettings = { enabled: true, downloaded: false };
const ON_CACHED: LocalEngineSettings = { enabled: true, downloaded: true };

function runtime(over: Partial<LocalEngineRuntime> = {}): LocalEngineRuntime {
  return { isReady: false, downloadProgress: 0, error: null, ...over };
}

describe("local engine settings (persisted, opt-in)", () => {
  it("defaults to off — the 1.3 GB model is never fetched unasked", () => {
    expect(DEFAULT_LOCAL_ENGINE_SETTINGS).toEqual({ enabled: false, downloaded: false });
    expect(parseLocalEngineSettings(null)).toEqual(DEFAULT_LOCAL_ENGINE_SETTINGS);
  });

  it("round-trips through storage", () => {
    expect(parseLocalEngineSettings(serializeLocalEngineSettings(ON_CACHED))).toEqual(ON_CACHED);
  });

  it("degrades malformed stored data to the default instead of throwing", () => {
    expect(parseLocalEngineSettings("{not json")).toEqual(DEFAULT_LOCAL_ENGINE_SETTINGS);
    expect(parseLocalEngineSettings("[]")).toEqual(DEFAULT_LOCAL_ENGINE_SETTINGS);
    expect(parseLocalEngineSettings('{"enabled":"yes"}')).toEqual(DEFAULT_LOCAL_ENGINE_SETTINGS);
    expect(parseLocalEngineSettings('{"enabled":true}')).toEqual({ enabled: true, downloaded: false });
  });

  it("warns about the download only until the model is cached on this phone", () => {
    expect(needsDownloadWarning(OFF)).toBe(true);
    expect(needsDownloadWarning({ enabled: false, downloaded: true })).toBe(false);
  });
});

describe("localEngineState (settings + executorch runtime → row state)", () => {
  it("is off whenever the user hasn't opted in, whatever the runtime says", () => {
    expect(localEngineState(OFF, runtime({ isReady: true }))).toEqual({ kind: "off" });
    expect(localEngineState(OFF, null)).toEqual({ kind: "off" });
  });

  it("is preparing while the session mounts (enabled, no runtime yet)", () => {
    expect(localEngineState(ON, null)).toEqual({ kind: "preparing" });
  });

  it("reports download progress as a whole percent", () => {
    expect(localEngineState(ON, runtime({ downloadProgress: 0.4237 }))).toEqual({
      kind: "downloading",
      percent: 42,
    });
  });

  it("is preparing once the bytes are down but the session isn't ready", () => {
    expect(localEngineState(ON, runtime({ downloadProgress: 1 }))).toEqual({ kind: "preparing" });
  });

  it("is ready only when the runtime says so", () => {
    expect(localEngineState(ON, runtime({ isReady: true, downloadProgress: 1 }))).toEqual({
      kind: "ready",
    });
  });

  it("is failed on a runtime error — even if it also claims ready", () => {
    expect(localEngineState(ON, runtime({ error: new Error("OOM"), isReady: true }))).toEqual({
      kind: "failed",
    });
  });

  it("routes to the local model in exactly one state: ready", () => {
    expect(shouldRouteLocal({ kind: "ready" })).toBe(true);
    expect(shouldRouteLocal({ kind: "off" })).toBe(false);
    expect(shouldRouteLocal({ kind: "preparing" })).toBe(false);
    expect(shouldRouteLocal({ kind: "downloading", percent: 99 })).toBe(false);
    expect(shouldRouteLocal({ kind: "failed" })).toBe(false);
  });
});

describe("row copy (honest about what disabling does)", () => {
  it("labels every state", () => {
    expect(localEngineStatusLabel({ kind: "off" })).toBe("Off");
    expect(localEngineStatusLabel({ kind: "downloading", percent: 7 })).toBe("Downloading 7%");
    expect(localEngineStatusLabel({ kind: "preparing" })).toBe("Preparing…");
    expect(localEngineStatusLabel({ kind: "ready" })).toBe("Ready");
    expect(localEngineStatusLabel({ kind: "failed" })).toBe("Setup failed");
  });

  it("says the files stay on the phone when switched off after a download", () => {
    const subtitle = localEngineSubtitle({ kind: "off" }, { enabled: false, downloaded: true });
    expect(subtitle).toMatch(/stays on this phone/i);
    expect(subtitle).not.toMatch(/1\.3 GB over WiFi/i);
  });

  it("warns about size and WiFi before the first download", () => {
    expect(localEngineSubtitle({ kind: "off" }, OFF)).toMatch(/1\.3 GB/);
  });

  it("tells the user Gemini is covering them while the local engine is failed", () => {
    expect(localEngineSubtitle({ kind: "failed" }, ON)).toMatch(/Gemini/);
  });
});

describe("localSystemPrompt", () => {
  it("asks for JSON only in both modes", () => {
    expect(localSystemPrompt(false)).toMatch(/VALID JSON ONLY/);
    expect(localSystemPrompt(true)).toMatch(/VALID JSON ONLY/);
  });

  it("switches to pruning-cut framing for cut care", () => {
    expect(localSystemPrompt(true)).toMatch(/pruning cut/i);
    expect(localSystemPrompt(false)).not.toMatch(/pruning cut/i);
  });
});

const DIAGNOSIS: AssessmentDiagnosis = {
  health_score: 64,
  summary: "Minor leaf yellowing.",
  symptoms: [{ label: "Yellow tips", severity: "low" }],
  causes: [{ label: "Underwatering", likelihood: "medium", rationale: "Dry, crisp margins." }],
  recommendations: [{ priority: 1, action: "Water deeply", detail: "Until it drains." }],
};

// The row MUST match what apps/api/src/routes/assess.ts inserts, or a locally
// produced assessment breaks the timeline (deltas, cut-care split, RLS).
describe("buildLocalAssessmentRow (mirrors the /assess insert)", () => {
  it("builds the same row shape the server writes, with photo_path null (D-16)", () => {
    expect(
      buildLocalAssessmentRow({
        plantId: "plant-1",
        userId: "user-7",
        diagnosis: DIAGNOSIS,
        raw: '{"health_score":64}',
        isCutCare: false,
        previousAssessmentId: "assessment-3",
      }),
    ).toEqual({
      plant_id: "plant-1",
      user_id: "user-7",
      photo_path: null,
      health_score: 64,
      symptoms: DIAGNOSIS.symptoms,
      diagnosis: DIAGNOSIS,
      recommendations: DIAGNOSIS.recommendations,
      compared_to_assessment_id: "assessment-3",
      raw_output: '{"health_score":64}',
      is_cut_care: false,
      cut_health_score: null,
    });
  });

  it("carries the score into cut_health_score for cut care (server parity)", () => {
    const row = buildLocalAssessmentRow({
      plantId: "plant-1",
      userId: "user-7",
      diagnosis: DIAGNOSIS,
      raw: "{}",
      isCutCare: true,
      previousAssessmentId: null,
    });
    expect(row.is_cut_care).toBe(true);
    expect(row.cut_health_score).toBe(64);
    expect(row.compared_to_assessment_id).toBeNull();
  });
});
