// The assess flow (D-17 Gemma-only): save the downscaled JPEG on the phone
// FIRST (the photo persists even if analysis fails) → run the on-device Gemma
// model → persist the diagnosis locally → link the local uri to the assessment
// id in the photo index. There is NO cloud fallback: Gemma is the only engine,
// so a phone that can't run it gets an honest, retryable error instead of a
// silent escalation. F21: no capture mode goes in — the model reports the
// subject it saw, and a "not_a_plant" reading comes back as a rejected result
// that was never persisted (the caller offers "save anyway" → force). Pure,
// dependency-injected, and tested; ReviewScreen wires the real photo-store-io /
// local-store / executorch deps. Raw model/runtime messages never reach the UI.

import type { AssessmentDiagnosis } from "@citrus/shared";
import type { AssessEngine, PhotoIndexEntry } from "./photo-store";
import { parseDiagnosisOutput } from "./spike-vlm";

export const PHOTO_SAVE_FAILED_ERROR = "Couldn't save the photo. Please try again.";
export const LOCAL_UNAVAILABLE_ERROR =
  "On-device AI isn't ready on this phone yet. Set it up in Profile (needs ~2 GB free and a recent phone), then try again.";
export const ANALYSIS_FAILED_ERROR =
  "Your phone couldn't run the analysis — it may be low on memory. Close other apps and try again.";
export const ANALYSIS_UNREADABLE_ERROR =
  "Couldn't read a clear result from the analysis. Retake the photo in better light and try again.";
export const ANALYSIS_TIMEOUT_ERROR =
  "The analysis is taking too long on this phone. Retake the photo in better light and try again.";
export const PERSIST_FAILED_ERROR = "Couldn't save the assessment. Please try again.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Strings thrown by this module that are safe to show verbatim — all honest
 * and retryable (the photo is already on the phone). */
const FLOW_ERRORS = new Set([
  PHOTO_SAVE_FAILED_ERROR,
  LOCAL_UNAVAILABLE_ERROR,
  ANALYSIS_FAILED_ERROR,
  ANALYSIS_UNREADABLE_ERROR,
  ANALYSIS_TIMEOUT_ERROR,
  PERSIST_FAILED_ERROR,
]);

/** On a mid-range phone the first inference (cold model) is legitimately slow,
 * so past this we only change the UI copy — we do NOT abandon the result (there
 * is nowhere to escalate to). */
export const LOCAL_SLOW_THRESHOLD_MS = 25_000;

/** Safety valve: past this the model is stuck. We interrupt() the single native
 * session so the next attempt isn't blocked, then surface a retryable error. */
export const LOCAL_HARD_CEILING_MS = 120_000;

/** The hard ceiling is a distinct outcome (interrupt + timeout message), so it
 * needs its own type — a message string would be indistinguishable from a model
 * that threw with unlucky wording. */
class LocalTimeoutError extends Error {
  constructor() {
    super(`on-device inference exceeded ${LOCAL_HARD_CEILING_MS}ms`);
    this.name = "LocalTimeoutError";
  }
}

export type AssessPhase = "saving" | "analyzing";

/** The on-device engine, injected. Wired in ReviewScreen from the
 * LocalEngineProvider context; never imported here, so this module stays pure
 * and the executorch native runtime stays out of the bundle graph. */
export interface LocalAssessDeps {
  /** True only when the model session is loaded and ready to infer. */
  isReady: () => boolean;
  /** Downscale the saved photo to 512px long edge — the local model's input
   * discipline (full-res turns seconds into minutes). Returns a temp uri. */
  prepare: (uri: string) => Promise<string>;
  /** Run the local VLM over the prepared image; returns its raw text. */
  generate: (args: { imageUri: string }) => Promise<string>;
  /** Insert the assessment row into the on-device store. Returns the new id. */
  persist: (args: {
    plantId: string;
    diagnosis: AssessmentDiagnosis;
    raw: string;
  }) => Promise<string>;
  /** Free the native session when the hard ceiling fires (best-effort). */
  interrupt?: () => void;
}

export interface AssessDeps {
  /** Copy the temp JPEG into the durable local store; returns the new uri
   * (photo-store-io savePlantPhoto). */
  savePhoto: (plantId: string, sourceUri: string) => Promise<string>;
  /** Record the local uri ↔ assessment id link (photo-store-io). */
  linkPhoto: (assessmentId: string, entry: PhotoIndexEntry) => Promise<void>;
  /** The on-device engine — required: it is the only engine now. */
  local: LocalAssessDeps;
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
  /** Fires when inference passes LOCAL_SLOW_THRESHOLD_MS — a UI hint only; the
   * flow keeps waiting for the result. */
  onSlow?: () => void;
}

/** Saved to the timeline — the normal outcome. */
export interface AssessedResult {
  status: "assessed";
  assessmentId: string;
  diagnosis: AssessmentDiagnosis;
  /** Durable on-phone uri of the photo this assessment was made from. */
  localUri: string;
}

/** F21 — the model read the photo as a non-plant, so nothing was written.
 * Not an error: the diagnosis explains itself, and re-running with
 * `force: true` saves it anyway. The photo is on the phone either way. */
export interface RejectedResult {
  status: "rejected";
  diagnosis: AssessmentDiagnosis;
  localUri: string;
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

  // Gemma-only: no engine, no analysis. Honest and retryable — the photo is
  // already safe on the phone.
  if (!deps.local.isReady()) {
    throw new Error(LOCAL_UNAVAILABLE_ERROR);
  }

  const outcome = await runLocal(deps.local, input, localUri, hooks);
  if (outcome.status === "rejected") {
    return { status: "rejected", diagnosis: outcome.diagnosis, localUri };
  }
  await linkPhotoBestEffort(deps, outcome.assessmentId, localUri, input.plantId, "on-device");
  return {
    status: "assessed",
    assessmentId: outcome.assessmentId,
    diagnosis: outcome.diagnosis,
    localUri,
  };
}

/** The on-device attempt. Every failure mode throws a distinct, honest,
 * retryable FLOW_ERROR — there is no escalation. A not_a_plant reading is not a
 * failure: it comes back as a rejected outcome. */
async function runLocal(
  local: LocalAssessDeps,
  input: AssessInput,
  localUri: string,
  hooks: AssessHooks,
): Promise<
  | { status: "assessed"; assessmentId: string; diagnosis: AssessmentDiagnosis }
  | { status: "rejected"; diagnosis: AssessmentDiagnosis }
> {
  const inference = await diagnoseWithBudget(local, localUri, hooks);

  // F21: don't put a non-plant in a plant's timeline unless the user says to.
  if (inference.diagnosis.subject === "not_a_plant" && !input.force) {
    return { status: "rejected", diagnosis: inference.diagnosis };
  }

  let assessmentId: string;
  try {
    assessmentId = await local.persist({
      plantId: input.plantId,
      diagnosis: inference.diagnosis,
      raw: inference.raw,
    });
  } catch (e) {
    console.error("[runAssess] local persist failed:", (e as Error).message);
    throw new Error(PERSIST_FAILED_ERROR);
  }
  return { status: "assessed", assessmentId, diagnosis: inference.diagnosis };
}

/** The budget-wrapped diagnose step shared by the normal flow and F35's
 * diagnose-only path: 25s slow hint, 120s interrupt ceiling, honest errors,
 * schema gate. Never persists anything. */
async function diagnoseWithBudget(
  local: LocalAssessDeps,
  localUri: string,
  hooks: AssessHooks,
): Promise<{ diagnosis: AssessmentDiagnosis; raw: string }> {
  let inference: { diagnosis: AssessmentDiagnosis; raw: string } | null;
  try {
    inference = await withBudget(localDiagnose(local, localUri), {
      slowMs: LOCAL_SLOW_THRESHOLD_MS,
      hardMs: LOCAL_HARD_CEILING_MS,
      onSlow: hooks.onSlow,
      onHardTimeout: () => local.interrupt?.(),
    });
  } catch (e) {
    console.error("[runAssess] on-device inference failed:", (e as Error).message);
    if (e instanceof LocalTimeoutError) throw new Error(ANALYSIS_TIMEOUT_ERROR);
    throw new Error(ANALYSIS_FAILED_ERROR);
  }
  // Unparseable output — the small local model has no responseSchema, so the
  // shared Zod schema is the only gate (logged with its reason in localDiagnose).
  if (!inference) throw new Error(ANALYSIS_UNREADABLE_ERROR);
  return inference;
}

export type DiagnoseOnlyResult =
  | { status: "diagnosed"; diagnosis: AssessmentDiagnosis; raw: string }
  | { status: "rejected"; diagnosis: AssessmentDiagnosis; raw: string };

/** F35 snap-first: diagnose a photo BEFORE any plant exists. Nothing is saved
 * or persisted — the caller shows the AI-drafted new-plant sheet and, once the
 * user confirms, completes with persistDeferredAssessment. */
export async function runDiagnoseOnly(
  deps: AssessDeps,
  input: { photoUri: string; force?: boolean },
  hooks: AssessHooks = {},
): Promise<DiagnoseOnlyResult> {
  if (!deps.local.isReady()) throw new Error(LOCAL_UNAVAILABLE_ERROR);
  hooks.onPhase?.("analyzing");
  const inference = await diagnoseWithBudget(deps.local, input.photoUri, hooks);
  if (inference.diagnosis.subject === "not_a_plant" && !input.force) {
    return { status: "rejected", diagnosis: inference.diagnosis, raw: inference.raw };
  }
  return { status: "diagnosed", diagnosis: inference.diagnosis, raw: inference.raw };
}

/** F35: the write half of snap-first — runs AFTER the user confirmed the new
 * plant. Same order and honesty as the normal flow: photo file first, then the
 * assessment row, then the best-effort thumbnail link. Returns the new
 * assessment id. */
export async function persistDeferredAssessment(
  deps: AssessDeps,
  args: { plantId: string; photoUri: string; diagnosis: AssessmentDiagnosis; raw: string },
  hooks: AssessHooks = {},
): Promise<string> {
  hooks.onPhase?.("saving");
  let localUri: string;
  try {
    localUri = await deps.savePhoto(args.plantId, args.photoUri);
    hooks.onPhotoSaved?.(localUri);
  } catch (e) {
    console.error("[runAssess] deferred photo save failed:", (e as Error).message);
    throw new Error(PHOTO_SAVE_FAILED_ERROR);
  }
  let assessmentId: string;
  try {
    assessmentId = await deps.local.persist({
      plantId: args.plantId,
      diagnosis: args.diagnosis,
      raw: args.raw,
    });
  } catch (e) {
    console.error("[runAssess] deferred persist failed:", (e as Error).message);
    throw new Error(PERSIST_FAILED_ERROR);
  }
  await linkPhotoBestEffort(deps, assessmentId, localUri, args.plantId, "on-device");
  return assessmentId;
}

async function localDiagnose(
  local: LocalAssessDeps,
  localUri: string,
): Promise<{ diagnosis: AssessmentDiagnosis; raw: string } | null> {
  const imageUri = await local.prepare(localUri);
  const raw = await local.generate({ imageUri });
  const parsed = parseDiagnosisOutput(raw);
  if (!parsed.ok) {
    console.error("[runAssess] on-device output rejected:", parsed.reason);
    return null;
  }
  return { diagnosis: parsed.diagnosis, raw };
}

interface Budget {
  slowMs: number;
  hardMs: number;
  onSlow?: () => void;
  onHardTimeout?: () => void;
}

/** Run `promise` with two timers: a soft `slowMs` that only fires `onSlow` (a
 * UI hint — the inference keeps running), and a hard `hardMs` that fires
 * `onHardTimeout` and rejects with LocalTimeoutError. The abandoned inference
 * keeps running in the native runtime; onHardTimeout interrupt()s it. */
function withBudget<T>(promise: Promise<T>, budget: Budget): Promise<T> {
  let slowTimer: ReturnType<typeof setTimeout>;
  let hardTimer: ReturnType<typeof setTimeout>;
  const slow = new Promise<void>((resolve) => {
    slowTimer = setTimeout(() => {
      budget.onSlow?.();
      resolve();
    }, budget.slowMs);
  });
  // Keep `slow` from being an unhandled floating promise without letting it win
  // the race (it resolves void, never a T).
  void slow;
  const ceiling = new Promise<never>((_, reject) => {
    hardTimer = setTimeout(() => {
      budget.onHardTimeout?.();
      reject(new LocalTimeoutError());
    }, budget.hardMs);
  });
  return Promise.race([promise, ceiling]).finally(() => {
    clearTimeout(slowTimer);
    clearTimeout(hardTimer);
  });
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

/** Error → user string mapping. The flow's own honest strings pass through;
 * everything else collapses to a generic string — raw messages never leak. */
export function friendlyAssessError(e: unknown): string {
  if (e instanceof Error && FLOW_ERRORS.has(e.message)) return e.message;
  return GENERIC_ERROR;
}
