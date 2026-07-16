// The assess flow (D-16 local-first + D-15 Stage 2 engine router): save the
// downscaled JPEG on the phone FIRST (the photo persists even if analysis
// fails) → try the on-device model when the user enabled it and it is ready →
// otherwise (or on ANY local failure) escalate silently to Gemini by POSTing
// the base64 image directly to /assess → link the local uri to the persisted
// assessment id in the photo index, recording which engine produced it.
// F21: no capture mode goes in — the model reports the subject it saw, and a
// "not_a_plant" reading from EITHER engine comes back as a rejected result
// that was never persisted (the caller offers "save anyway" → force). Pure,
// dependency-injected, and tested; ReviewScreen wires the real
// photo-store-io/Supabase/executorch deps. Raw server/network/model messages
// never reach the UI (generic-message rule).

import { assessmentDiagnosisSchema, type AssessmentDiagnosis } from "@citrus/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, apiErrorFrom, type AuthorizedFetch } from "./api";
import type { AssessEngine, PhotoIndexEntry } from "./photo-store";
import { parseDiagnosisOutput } from "./spike-vlm";

export const PHOTO_SAVE_FAILED_ERROR = "Couldn't save the photo. Please try again.";
export const ANALYSIS_OFFLINE_ERROR =
  "Photo saved on your phone. Analysis needs a connection — try again when you're back online.";
export const RESULT_LOAD_ERROR =
  "The assessment was saved, but the result couldn't be displayed. Check the plant on the Plants tab.";
const GENERIC_ERROR = "Something went wrong. Please check your connection and try again.";

/** Strings thrown by this module that are safe to show verbatim. */
const FLOW_ERRORS = new Set([PHOTO_SAVE_FAILED_ERROR, ANALYSIS_OFFLINE_ERROR, RESULT_LOAD_ERROR]);

/** Hard ceiling on the whole on-device attempt (downscale + inference). The
 * research doc budgets 3–10 s/photo at 512px; past 20 s the model is stuck or
 * thrashing and the user is better served by Gemini than by waiting. */
export const LOCAL_INFERENCE_TIMEOUT_MS = 20_000;

const LOCAL_TIMEOUT_REASON = `on-device inference exceeded ${LOCAL_INFERENCE_TIMEOUT_MS}ms`;

export type AssessPhase = "saving" | "analyzing";

/** The on-device engine, injected. Absent (or not ready) → Gemini, which is
 * also what every local failure collapses to. Wired in ReviewScreen from the
 * LocalEngineProvider context; never imported here, so this module stays pure
 * and the executorch native runtime stays out of the bundle graph. */
export interface LocalAssessDeps {
  /** True only when the user opted in AND the model session is loaded. */
  isReady: () => boolean;
  /** Downscale the saved photo to 512px long edge — the local model's input
   * discipline (full-res turns seconds into minutes). Returns a temp uri. */
  prepare: (uri: string) => Promise<string>;
  /** Run the local VLM over the prepared image; returns its raw text. */
  generate: (args: { imageUri: string }) => Promise<string>;
  /** Insert the assessment row directly (local-engine-io persistLocalAssessment)
   * — /assess can't save this one, it runs Gemini. Returns the new id. */
  persist: (args: {
    plantId: string;
    diagnosis: AssessmentDiagnosis;
    raw: string;
  }) => Promise<string>;
}

export interface AssessDeps {
  /** Bearer-authenticated fetch to apps/api (see api.ts / api-io.ts). */
  api: AuthorizedFetch;
  /** Copy the temp JPEG into the durable local store; returns the new uri
   * (photo-store-io savePlantPhoto). */
  savePhoto: (plantId: string, sourceUri: string) => Promise<string>;
  /** Read a saved photo back as base64 (photo-store-io readPhotoBase64). */
  readPhotoBase64: (uri: string) => Promise<string>;
  /** Record the local uri ↔ assessment id link (photo-store-io). */
  linkPhoto: (assessmentId: string, entry: PhotoIndexEntry) => Promise<void>;
  /** Loads the persisted assessment's diagnosis JSON (fetchDiagnosisRow). */
  loadDiagnosis: (assessmentId: string) => Promise<unknown>;
  /** D-15 Stage 2. Omit for a Gemini-only build. */
  local?: LocalAssessDeps;
}

export interface AssessInput {
  plantId: string;
  photoUri: string;
  /** Durable local uri from a previous attempt: retry without re-saving. */
  savedUri?: string | null;
  /** "Save anyway" — persist even when the model reads the photo as a
   * non-plant. The user's override, never the model's (F21). */
  force?: boolean;
}

export interface AssessHooks {
  onPhase?: (phase: AssessPhase) => void;
  /** Fires as soon as the photo is saved locally so the caller can keep the
   * durable uri for retries. */
  onPhotoSaved?: (localUri: string) => void;
}

/** Saved to the timeline — the normal outcome. */
export interface AssessedResult {
  status: "assessed";
  assessmentId: string;
  diagnosis: AssessmentDiagnosis;
  /** Durable on-phone uri of the photo this assessment was made from. */
  localUri: string;
  /** Which engine actually produced this diagnosis (provenance badge). */
  engine: AssessEngine;
}

/** F21 — the model read the photo as a non-plant, so nothing was written.
 * Not an error: the diagnosis explains itself, and re-running with
 * `force: true` saves it anyway. The photo is on the phone either way. */
export interface RejectedResult {
  status: "rejected";
  diagnosis: AssessmentDiagnosis;
  localUri: string;
  engine: AssessEngine;
}

export type AssessResult = AssessedResult | RejectedResult;

export async function runAssess(
  deps: AssessDeps,
  input: AssessInput,
  hooks: AssessHooks = {},
): Promise<AssessResult> {
  let localUri = input.savedUri ?? null;

  if (!localUri) {
    hooks.onPhase?.("saving");
    try {
      localUri = await deps.savePhoto(input.plantId, input.photoUri);
    } catch (e) {
      console.error("[runAssess] local photo save failed:", (e as Error).message);
      throw new Error(PHOTO_SAVE_FAILED_ERROR);
    }
    hooks.onPhotoSaved?.(localUri);
  }

  hooks.onPhase?.("analyzing");

  // On-device first. Any failure at all — disabled, unready, timeout, throw,
  // unparseable output, failed insert — falls through to Gemini without a word
  // to the user; the reason is logged for us instead.
  if (deps.local?.isReady()) {
    const local = await tryLocalAssess(deps.local, input, localUri);
    if (local) {
      // A rejection is an answer, not a local failure: escalating would spend
      // a Gemini call to be told the same thing, and there is no row to link.
      if (local.status === "rejected") {
        return { status: "rejected", diagnosis: local.diagnosis, localUri, engine: "on-device" };
      }
      await linkPhotoBestEffort(deps, local.assessmentId, localUri, input.plantId, "on-device");
      return { ...local, localUri, engine: "on-device" };
    }
  }

  const imageBase64 = await deps.readPhotoBase64(localUri);

  let res;
  try {
    res = await deps.api("/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plantId: input.plantId,
        imageBase64,
        mime: "image/jpeg",
        // No mode field: the model detects the subject (F21).
        ...(input.force ? { force: true } : {}),
      }),
    });
  } catch (e) {
    // ApiError means the server (or auth) answered — let the status mapping
    // speak. Anything else is a transport failure: the photo is already safe
    // on the phone, only the analysis needs a connection.
    if (e instanceof ApiError) throw e;
    console.error("[runAssess] escalation request failed:", (e as Error).message);
    throw new Error(ANALYSIS_OFFLINE_ERROR);
  }
  if (!res.ok) throw await apiErrorFrom(res);
  const payload = (await res.json()) as
    | { id: string; rejected?: undefined }
    | { rejected: true; diagnosis: unknown };

  // The server declined to save a non-plant photo (F21). Its diagnosis is
  // still model output — the shared schema is the gate, exactly as on the
  // saved path; a rejection we can't parse is just a failure.
  if (payload.rejected) {
    let diagnosis: AssessmentDiagnosis;
    try {
      diagnosis = assessmentDiagnosisSchema.parse(payload.diagnosis);
    } catch (e) {
      console.error("[runAssess] rejection payload failed schema:", (e as Error).message);
      throw new Error(RESULT_LOAD_ERROR);
    }
    return { status: "rejected", diagnosis, localUri, engine: "gemini" };
  }

  const { id } = payload;

  await linkPhotoBestEffort(deps, id, localUri, input.plantId, "gemini");

  // The server already Zod-validated Gemini's output before inserting; this
  // re-parse guards the round-trip through Postgres with the same shared schema.
  let diagnosis: AssessmentDiagnosis;
  try {
    diagnosis = assessmentDiagnosisSchema.parse(await deps.loadDiagnosis(id));
  } catch (e) {
    console.error("[runAssess] diagnosis load/parse failed:", (e as Error).message);
    throw new Error(RESULT_LOAD_ERROR);
  }

  return { status: "assessed", assessmentId: id, diagnosis, localUri, engine: "gemini" };
}

/** A failed index write only costs a thumbnail, never the result. */
async function linkPhotoBestEffort(
  deps: AssessDeps,
  assessmentId: string,
  localUri: string,
  plantId: string,
  engine: AssessEngine,
): Promise<void> {
  try {
    await deps.linkPhoto(assessmentId, {
      localUri,
      plantId,
      engine,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[runAssess] photo index link failed:", (e as Error).message);
  }
}

/** The whole on-device attempt, bounded and swallowed: returns null for every
 * failure mode so the caller's only job is "null → escalate". A rejection is
 * NOT a failure — it comes back as a real outcome. */
async function tryLocalAssess(
  local: LocalAssessDeps,
  input: AssessInput,
  localUri: string,
): Promise<
  | { status: "assessed"; assessmentId: string; diagnosis: AssessmentDiagnosis }
  | { status: "rejected"; diagnosis: AssessmentDiagnosis }
  | null
> {
  try {
    const inference = await withTimeout(
      localDiagnose(local, input, localUri),
      LOCAL_INFERENCE_TIMEOUT_MS,
    );
    // Unparseable output — already logged with its reason.
    if (!inference) return null;

    // Same rule the server applies (F21): don't put a non-plant in a plant's
    // timeline unless the user explicitly said to.
    if (inference.diagnosis.subject === "not_a_plant" && !input.force) {
      return { status: "rejected", diagnosis: inference.diagnosis };
    }

    const assessmentId = await local.persist({
      plantId: input.plantId,
      diagnosis: inference.diagnosis,
      raw: inference.raw,
    });
    return { status: "assessed", assessmentId, diagnosis: inference.diagnosis };
  } catch (e) {
    console.error("[runAssess] on-device attempt failed, escalating:", (e as Error).message);
    return null;
  }
}

async function localDiagnose(
  local: LocalAssessDeps,
  input: AssessInput,
  localUri: string,
): Promise<{ diagnosis: AssessmentDiagnosis; raw: string } | null> {
  const imageUri = await local.prepare(localUri);
  const raw = await local.generate({ imageUri });
  // A small local model has no responseSchema enforcement — the shared Zod
  // schema is the gate, and failing it is a normal, expected escalation.
  const parsed = parseDiagnosisOutput(raw);
  if (!parsed.ok) {
    console.error("[runAssess] on-device output rejected, escalating:", parsed.reason);
    return null;
  }
  return { diagnosis: parsed.diagnosis, raw };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(LOCAL_TIMEOUT_REASON)), ms);
  });
  // The abandoned inference keeps running to completion in the native runtime;
  // we simply stop waiting on it. clearTimeout keeps the timer from pinning
  // the JS thread awake after a fast win.
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

/** Thin Supabase read for the just-inserted assessment (RLS-scoped). Kept here
 * next to the flow it serves; injected as deps.loadDiagnosis. */
export async function fetchDiagnosisRow(client: SupabaseClient, assessmentId: string): Promise<unknown> {
  const { data, error } = await client
    .from("assessments")
    .select("diagnosis")
    .eq("id", assessmentId)
    .single();
  if (error) {
    console.error("[fetchDiagnosisRow] query failed:", error.message);
    throw new Error(RESULT_LOAD_ERROR);
  }
  return (data as { diagnosis: unknown }).diagnosis;
}

/** Status-code → user string mapping. Unknown errors collapse to a generic
 * string — raw messages never leak. */
export function friendlyAssessError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 429:
        return e.retryAfter
          ? `Too many assessments. Try again in ${Math.ceil(e.retryAfter / 60)} min.`
          : "Too many assessments. Please wait and try again.";
      case 401:
        return "Session expired — please sign in again.";
      case 403:
        return "Permission denied. Please sign in again.";
      case 404:
        return "Plant not found. Please close and try again.";
      case 502:
        return "The AI service returned an error. Please try again in a moment.";
      case 500:
        return "Server error — please try again.";
      default:
        return GENERIC_ERROR;
    }
  }
  if (e instanceof Error && FLOW_ERRORS.has(e.message)) return e.message;
  return GENERIC_ERROR;
}
