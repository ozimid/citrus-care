// On-device engine (D-15 Stage 2), pure half: the opt-in setting + the
// state machine that turns the executorch session's runtime status into a
// Profile row, plus the assessment row a locally produced diagnosis persists
// as. Off by default — the 1.3 GB Gemma 4 E2B download is never started
// unasked (docs/research/on-device-vlm-native.md). The AsyncStorage and
// Supabase wiring is the thin local-engine-io.ts; the executorch session
// itself lives in components/LocalEngineSession.tsx (native, dev-build only).

import type { AssessmentDiagnosis } from "@citrus/shared";
import { SPIKE_SYSTEM_PROMPT } from "./spike-vlm";

export const LOCAL_ENGINE_STORAGE_KEY = "citrus.local-engine.v1";

/** Quantized Gemma 4 E2B, per the research doc's model choice. */
export const LOCAL_MODEL_SIZE_LABEL = "1.3 GB";

/** Shown before the first download so the size/network cost is a choice. */
export const LOCAL_MODEL_DOWNLOAD_WARNING =
  `Downloads a ${LOCAL_MODEL_SIZE_LABEL} model over WiFi (once). After that your photos are analyzed ` +
  `on this phone — nothing is sent anywhere. Anything the local model can't handle still goes to Gemini.`;

export interface LocalEngineSettings {
  /** The user's opt-in. Off means the router never touches the local model. */
  enabled: boolean;
  /** True once the model has finished downloading on this phone — suppresses
   * the size warning on re-enable (the files survive a disable). */
  downloaded: boolean;
}

export const DEFAULT_LOCAL_ENGINE_SETTINGS: LocalEngineSettings = {
  enabled: false,
  downloaded: false,
};

/** Stored settings are untrusted: anything malformed degrades to "off", which
 * is the safe default (Gemini handles everything). Never throws. */
export function parseLocalEngineSettings(json: string | null): LocalEngineSettings {
  if (!json) return DEFAULT_LOCAL_ENGINE_SETTINGS;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return DEFAULT_LOCAL_ENGINE_SETTINGS;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return DEFAULT_LOCAL_ENGINE_SETTINGS;
  }
  const r = raw as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    downloaded: r.downloaded === true,
  };
}

export function serializeLocalEngineSettings(settings: LocalEngineSettings): string {
  return JSON.stringify(settings);
}

export function needsDownloadWarning(settings: LocalEngineSettings): boolean {
  return !settings.downloaded;
}

/** Structural slice of react-native-executorch's useLLM return value — the
 * only three fields the state machine needs, so this module stays pure. */
export interface LocalEngineRuntime {
  isReady: boolean;
  /** 0..1 from the library's resource fetcher. */
  downloadProgress: number;
  error: unknown;
}

export type LocalEngineState =
  | { kind: "off" }
  | { kind: "downloading"; percent: number }
  | { kind: "preparing" }
  | { kind: "ready" }
  | { kind: "failed" };

/** settings + session status → what the Profile row shows and whether the
 * router may use the local model. `runtime` is null while the (lazily
 * imported) session component hasn't mounted yet. */
export function localEngineState(
  settings: LocalEngineSettings,
  runtime: LocalEngineRuntime | null,
): LocalEngineState {
  if (!settings.enabled) return { kind: "off" };
  if (!runtime) return { kind: "preparing" };
  // Error wins over isReady: a session that errored can't be trusted to infer.
  if (runtime.error) return { kind: "failed" };
  if (runtime.isReady) return { kind: "ready" };
  const p = runtime.downloadProgress;
  if (p > 0 && p < 1) {
    return { kind: "downloading", percent: Math.min(100, Math.max(0, Math.round(p * 100))) };
  }
  return { kind: "preparing" };
}

/** The single gate the router asks: a diagnosis only runs locally when the
 * session is actually loaded. Every other state escalates to Gemini. */
export function shouldRouteLocal(state: LocalEngineState): boolean {
  return state.kind === "ready";
}

export function localEngineStatusLabel(state: LocalEngineState): string {
  switch (state.kind) {
    case "off":
      return "Off";
    case "downloading":
      return `Downloading ${state.percent}%`;
    case "preparing":
      return "Preparing…";
    case "ready":
      return "Ready";
    case "failed":
      return "Setup failed";
  }
}

/** Row subtitle. Honest about the two things a user can't see: disabling keeps
 * the downloaded files, and a failed/off engine silently means Gemini. */
export function localEngineSubtitle(
  state: LocalEngineState,
  settings: LocalEngineSettings,
): string {
  switch (state.kind) {
    case "off":
      return settings.downloaded
        ? "Gemini is analyzing your photos. The downloaded model stays on this phone — turn this back on any time, or remove it by deleting the app."
        : `Analyze photos privately on this phone. First use downloads ${LOCAL_MODEL_SIZE_LABEL} over WiFi.`;
    case "downloading":
      return `Downloading ${LOCAL_MODEL_SIZE_LABEL} over WiFi — one time. Gemini handles assessments meanwhile.`;
    case "preparing":
      return "Starting the on-device model…";
    case "ready":
      return "Photos are analyzed on this phone. Anything the local model can't read goes to Gemini automatically.";
    case "failed":
      return "Couldn't set up the on-device model — Gemini is handling your assessments. Tap to try again.";
  }
}

/** The compact on-device prompt (shared with the Stage 1 spike), specialized
 * for cut care the way the server's buildSystemPrompt is. A ~2B local model
 * has no responseSchema enforcement, hence the explicit JSON-only rules. */
export function localSystemPrompt(isCutCare: boolean): string {
  if (!isCutCare) return SPIKE_SYSTEM_PROMPT;
  return SPIKE_SYSTEM_PROMPT.replace(
    "You are a plant care expert. Diagnose the plant in the photo and prescribe prioritized care actions for a home grower.",
    `You are a plant care expert specializing in pruning. Diagnose the health of the pruning cut or branch wound in the photo and prescribe prioritized aftercare for a home grower.

Judge the cut itself: a correct cut is just outside the branch collar — a flush cut (too close to the trunk) or a long stub both heal badly. Look for decay, borer holes, or callous forming over the edges. health_score rates the cut/wound, not the tree.`,
  );
}

export const LOCAL_USER_PROMPT =
  "Diagnose the health of the plant in this photo. Reply with the JSON object only.";

export interface LocalAssessmentRowInput {
  plantId: string;
  userId: string;
  diagnosis: AssessmentDiagnosis;
  /** The model's raw text, kept for debugging exactly as /assess keeps Gemini's. */
  raw: string;
  isCutCare: boolean;
  previousAssessmentId: string | null;
}

/** Mirrors the insert in apps/api/src/routes/assess.ts. */
export interface LocalAssessmentRow {
  plant_id: string;
  user_id: string;
  photo_path: null;
  health_score: number;
  symptoms: AssessmentDiagnosis["symptoms"];
  diagnosis: AssessmentDiagnosis;
  recommendations: AssessmentDiagnosis["recommendations"];
  compared_to_assessment_id: string | null;
  raw_output: string;
  is_cut_care: boolean;
  cut_health_score: number | null;
}

/** An on-device diagnosis is persisted by the phone itself — /assess runs
 * Gemini, so it can't save this one. The row MUST match what the server
 * inserts field-for-field or timelines (deltas, cut-care split) diverge by
 * engine. photo_path stays null: photos never reach a server store (D-16). */
export function buildLocalAssessmentRow(input: LocalAssessmentRowInput): LocalAssessmentRow {
  return {
    plant_id: input.plantId,
    user_id: input.userId,
    photo_path: null,
    health_score: input.diagnosis.health_score,
    symptoms: input.diagnosis.symptoms,
    diagnosis: input.diagnosis,
    recommendations: input.diagnosis.recommendations,
    compared_to_assessment_id: input.previousAssessmentId,
    raw_output: input.raw,
    is_cut_care: input.isCutCare,
    cut_health_score: input.isCutCare ? input.diagnosis.health_score : null,
  };
}
