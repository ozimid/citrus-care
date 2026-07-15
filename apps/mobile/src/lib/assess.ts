// The assess flow (design doc §7): sign-upload → PUT the jpeg bytes to the
// signed URL → POST /assess → load + Zod-parse the persisted diagnosis. Pure,
// dependency-injected, and tested; ReviewScreen wires the real fetch/Supabase
// deps. Error strings mirror apps/web assess-client.tsx exactly, and raw
// server/network messages never reach the UI (generic-message rule).

import { assessmentDiagnosisSchema, type AssessmentDiagnosis } from "@citrus/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, apiErrorFrom, type ApiRequestInit, type ApiResponse, type AuthorizedFetch } from "./api";

export const UPLOAD_FAILED_ERROR = "Upload failed. Please try again.";
export const RESULT_LOAD_ERROR =
  "The assessment was saved, but the result couldn't be displayed. Check the plant on the Plants tab.";
const GENERIC_ERROR = "Something went wrong. Please check your connection and try again.";

/** Strings thrown by this module that are safe to show verbatim. */
const FLOW_ERRORS = new Set([UPLOAD_FAILED_ERROR, RESULT_LOAD_ERROR]);

export type AssessPhase = "uploading" | "analyzing";

interface RawResponse extends ApiResponse {
  blob?: () => Promise<unknown>;
}

export interface AssessDeps {
  /** Bearer-authenticated fetch to apps/api (see api.ts / api-io.ts). */
  api: AuthorizedFetch;
  /** Plain fetch: reads the local photo uri and PUTs to the signed URL —
   * neither request wants an Authorization header. */
  fetchRaw: (url: string, init?: ApiRequestInit) => Promise<RawResponse>;
  /** Loads the persisted assessment's diagnosis JSON (fetchDiagnosisRow). */
  loadDiagnosis: (assessmentId: string) => Promise<unknown>;
}

export interface AssessInput {
  plantId: string;
  photoUri: string;
  /** Cut mode maps to the server's isCutCare flag; leaf/whole-plant are
   * client-side framing guidance only — /assess accepts no other mode field. */
  isCutCare: boolean;
  /** photoPath from a previous attempt: retry without re-uploading (web parity). */
  photoPath?: string | null;
}

export interface AssessHooks {
  onPhase?: (phase: AssessPhase) => void;
  /** Fires as soon as the photo is uploaded so the caller can cache the path for retries. */
  onPhotoUploaded?: (photoPath: string) => void;
}

export interface AssessResult {
  assessmentId: string;
  diagnosis: AssessmentDiagnosis;
}

export async function runAssess(
  deps: AssessDeps,
  input: AssessInput,
  hooks: AssessHooks = {},
): Promise<AssessResult> {
  let photoPath = input.photoPath ?? null;

  if (!photoPath) {
    hooks.onPhase?.("uploading");

    const signRes = await deps.api("/photos/sign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plantId: input.plantId, mime: "image/jpeg" }),
    });
    if (!signRes.ok) throw await apiErrorFrom(signRes);
    const { photoPath: signedPath, uploadUrl } = (await signRes.json()) as {
      photoPath: string;
      uploadUrl: string;
    };

    // Read the downscaled jpeg from the local file uri, then PUT the bytes.
    const fileRes = await deps.fetchRaw(input.photoUri);
    if (!fileRes.ok || !fileRes.blob) throw new Error(UPLOAD_FAILED_ERROR);
    const bytes = await fileRes.blob();

    const putRes = await deps.fetchRaw(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: bytes,
    });
    if (!putRes.ok) throw new Error(UPLOAD_FAILED_ERROR);

    photoPath = signedPath;
    hooks.onPhotoUploaded?.(photoPath);
  }

  hooks.onPhase?.("analyzing");
  const res = await deps.api("/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plantId: input.plantId, photoPath, isCutCare: input.isCutCare }),
  });
  if (!res.ok) throw await apiErrorFrom(res);
  const { id } = (await res.json()) as { id: string };

  // The server already Zod-validated Gemini's output before inserting; this
  // re-parse guards the round-trip through Postgres with the same shared schema.
  let diagnosis: AssessmentDiagnosis;
  try {
    diagnosis = assessmentDiagnosisSchema.parse(await deps.loadDiagnosis(id));
  } catch (e) {
    console.error("[runAssess] diagnosis load/parse failed:", (e as Error).message);
    throw new Error(RESULT_LOAD_ERROR);
  }

  return { assessmentId: id, diagnosis };
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

/** Status-code → user string mapping, mirroring apps/web assess-client.tsx.
 * Unknown errors collapse to a generic string — raw messages never leak. */
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
        return "Photo not found. Please re-upload and try again.";
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
