// The assess flow (D-16, local-first): save the downscaled JPEG on the phone
// FIRST (the photo persists even if analysis fails) → escalate to Gemini by
// POSTing the base64 image directly to /assess → link the local uri to the
// persisted assessment id in the photo index. Pure, dependency-injected, and
// tested; ReviewScreen wires the real photo-store-io/Supabase deps. Raw
// server/network messages never reach the UI (generic-message rule).

import { assessmentDiagnosisSchema, type AssessmentDiagnosis } from "@citrus/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, apiErrorFrom, type AuthorizedFetch } from "./api";
import type { AssessEngine, PhotoIndexEntry } from "./photo-store";

export const PHOTO_SAVE_FAILED_ERROR = "Couldn't save the photo. Please try again.";
export const ANALYSIS_OFFLINE_ERROR =
  "Photo saved on your phone. Analysis needs a connection — try again when you're back online.";
export const RESULT_LOAD_ERROR =
  "The assessment was saved, but the result couldn't be displayed. Check the plant on the Plants tab.";
const GENERIC_ERROR = "Something went wrong. Please check your connection and try again.";

/** Strings thrown by this module that are safe to show verbatim. */
const FLOW_ERRORS = new Set([PHOTO_SAVE_FAILED_ERROR, ANALYSIS_OFFLINE_ERROR, RESULT_LOAD_ERROR]);

/** Engine router seam (D-15): every assessment records which engine produced
 * it. Only Gemini escalation exists today; the on-device model plugs in here. */
const ENGINE: AssessEngine = "gemini";

export type AssessPhase = "saving" | "analyzing";

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
}

export interface AssessInput {
  plantId: string;
  photoUri: string;
  /** Cut mode maps to the server's isCutCare flag; leaf/whole-plant are
   * client-side framing guidance only — /assess accepts no other mode field. */
  isCutCare: boolean;
  /** Durable local uri from a previous attempt: retry without re-saving. */
  savedUri?: string | null;
}

export interface AssessHooks {
  onPhase?: (phase: AssessPhase) => void;
  /** Fires as soon as the photo is saved locally so the caller can keep the
   * durable uri for retries. */
  onPhotoSaved?: (localUri: string) => void;
}

export interface AssessResult {
  assessmentId: string;
  diagnosis: AssessmentDiagnosis;
  /** Durable on-phone uri of the photo this assessment was made from. */
  localUri: string;
}

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
        isCutCare: input.isCutCare,
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
  const { id } = (await res.json()) as { id: string };

  // Best-effort: a failed index write only costs a thumbnail, never the result.
  try {
    await deps.linkPhoto(id, {
      localUri,
      plantId: input.plantId,
      engine: ENGINE,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[runAssess] photo index link failed:", (e as Error).message);
  }

  // The server already Zod-validated Gemini's output before inserting; this
  // re-parse guards the round-trip through Postgres with the same shared schema.
  let diagnosis: AssessmentDiagnosis;
  try {
    diagnosis = assessmentDiagnosisSchema.parse(await deps.loadDiagnosis(id));
  } catch (e) {
    console.error("[runAssess] diagnosis load/parse failed:", (e as Error).message);
    throw new Error(RESULT_LOAD_ERROR);
  }

  return { assessmentId: id, diagnosis, localUri };
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
