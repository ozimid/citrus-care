// F23 pruning run, pure half: photo → on-device model → stored plan. Same
// order and the same honesty as the assess flow (lib/assess.ts): the photo is
// saved on the phone FIRST so it survives a failed analysis, the model runs
// under the shared 25s/120s budget, and every failure is a distinct, honest,
// retryable string — there is no cloud to escalate to.
//
// The one difference worth naming: a "not_a_plant" reading is a dead end here
// rather than a save-anyway prompt. A pruning plan for a photo with no plant in
// it has nothing to offer the grower, so we refuse to store it; the photo is
// already on the phone either way.
//
// Dependency-injected and tested; PruneScreen wires the real photo-store-io /
// executorch / prune-io deps.

import type { PrunePlan } from "@citrus/shared";
import {
  InferenceTimeoutError,
  LOCAL_HARD_CEILING_MS,
  LOCAL_SLOW_THRESHOLD_MS,
  withInferenceBudget,
} from "./inference-budget";
import {
  PRUNE_ANALYSIS_FAILED_ERROR,
  PRUNE_PERSIST_ERROR,
  PRUNE_PHOTO_SAVE_ERROR,
  PRUNE_TIMEOUT_ERROR,
  PRUNE_UNAVAILABLE_ERROR,
  PRUNE_UNREADABLE_ERROR,
  PRUNE_USER_PROMPT,
  buildPrunePromptSystem,
  parsePrunePlanOutput,
  type PrunePromptRules,
} from "./prune-plan";

export interface PruneAnalysisDeps {
  isReady: () => boolean;
  /** Copy the temp JPEG into the durable local store; returns the new uri. */
  savePhoto: (plantId: string, sourceUri: string) => Promise<string>;
  /** Downscale to the model's 512px input discipline; returns a temp uri. */
  prepare: (uri: string) => Promise<string>;
  generate: (args: { imageUri: string; system: string; user: string }) => Promise<string>;
  /** Insert the plan into the on-device store; returns the new plan id. */
  persist: (args: {
    plantId: string;
    photoUri: string;
    photoAspect: number;
    ruleClass: string;
    plan: PrunePlan;
  }) => Promise<string>;
  /** Free the native session when the ceiling fires (best-effort). */
  interrupt?: () => void;
}

export interface PruneAnalysisInput {
  plantId: string;
  photoUri: string;
  /** width / height of the photo — stored with the plan so the overlay can
   * render it uncropped and keep the markers over the right branches. */
  photoAspect: number;
  /** Which rule pack produced `rules`, recorded on the stored plan. */
  ruleClass: string;
  rules: PrunePromptRules;
}

export type PrunePhase = "saving" | "analyzing";

/** What a run actually did, model's raw text included — stored on the phone by
 * the caller so a failure stops being a guessing game, and only ever leaves it
 * inside an email the user drafts themself (D-17). */
export interface PruneDebugInfo {
  outcome: "planned" | "rejected" | "unreadable";
  /** Parse failure reason when unreadable. */
  reason?: "no-json" | "invalid-json" | "schema-mismatch";
  raw: string;
  subject?: string;
  cuts?: number;
  /** Cuts whose marks were drawable / refused. */
  drawable?: number;
  dropped?: number;
}

export interface PruneHooks {
  onPhase?: (phase: PrunePhase) => void;
  onPhotoSaved?: (localUri: string) => void;
  onSlow?: () => void;
  /** Best-effort — a throwing sink must never break the run. */
  onDebug?: (info: PruneDebugInfo) => void;
}

function debugBestEffort(hooks: PruneHooks, info: PruneDebugInfo): void {
  try {
    hooks.onDebug?.(info);
  } catch (e) {
    console.error("[runPruneAnalysis] debug sink failed:", (e as Error).message);
  }
}

export type PruneAnalysisResult =
  | { status: "planned"; planId: string; plan: PrunePlan; localUri: string; droppedMarks: number }
  /** No plant in the photo — nothing was stored. The photo is on the phone. */
  | { status: "rejected"; plan: PrunePlan; localUri: string };

export async function runPruneAnalysis(
  deps: PruneAnalysisDeps,
  input: PruneAnalysisInput,
  hooks: PruneHooks = {},
): Promise<PruneAnalysisResult> {
  // Unlike the assess flow there is no retry-with-the-same-photo path: a
  // failed run is retried by taking a new photo, so every run saves once.
  hooks.onPhase?.("saving");
  let localUri: string;
  try {
    localUri = await deps.savePhoto(input.plantId, input.photoUri);
  } catch (e) {
    console.error("[runPruneAnalysis] local photo save failed:", (e as Error).message);
    throw new Error(PRUNE_PHOTO_SAVE_ERROR);
  }
  hooks.onPhotoSaved?.(localUri);

  hooks.onPhase?.("analyzing");
  if (!deps.isReady()) throw new Error(PRUNE_UNAVAILABLE_ERROR);

  const { plan, dropped } = await analyseWithBudget(deps, input, localUri, hooks);

  if (plan.subject === "not_a_plant") {
    return { status: "rejected", plan, localUri };
  }

  let planId: string;
  try {
    planId = await deps.persist({
      plantId: input.plantId,
      photoUri: localUri,
      photoAspect: input.photoAspect,
      ruleClass: input.ruleClass,
      plan,
    });
  } catch (e) {
    console.error("[runPruneAnalysis] plan persist failed:", (e as Error).message);
    throw new Error(PRUNE_PERSIST_ERROR);
  }
  return { status: "planned", planId, plan, localUri, droppedMarks: dropped };
}

async function analyseWithBudget(
  deps: PruneAnalysisDeps,
  input: PruneAnalysisInput,
  localUri: string,
  hooks: PruneHooks,
): Promise<{ plan: PrunePlan; dropped: number }> {
  let raw: string;
  try {
    raw = await withInferenceBudget(runModel(deps, input, localUri), {
      slowMs: LOCAL_SLOW_THRESHOLD_MS,
      hardMs: LOCAL_HARD_CEILING_MS,
      onSlow: hooks.onSlow,
      onHardTimeout: () => deps.interrupt?.(),
    });
  } catch (e) {
    console.error("[runPruneAnalysis] on-device inference failed:", (e as Error).message);
    if (e instanceof InferenceTimeoutError) throw new Error(PRUNE_TIMEOUT_ERROR);
    throw new Error(PRUNE_ANALYSIS_FAILED_ERROR);
  }

  const parsed = parsePrunePlanOutput(raw);
  if (!parsed.ok) {
    console.error("[runPruneAnalysis] on-device output rejected:", parsed.reason);
    debugBestEffort(hooks, { outcome: "unreadable", reason: parsed.reason, raw });
    throw new Error(PRUNE_UNREADABLE_ERROR);
  }
  if (parsed.dropped > 0) {
    // Not user-facing: the plan's text is intact and the placeable marks are
    // drawn. Logged because a phone that always drops marks is a model problem.
    console.error(`[runPruneAnalysis] dropped ${parsed.dropped} unplaceable mark(s)`);
  }
  debugBestEffort(hooks, {
    outcome: parsed.plan.subject === "not_a_plant" ? "rejected" : "planned",
    raw,
    subject: parsed.plan.subject,
    cuts: parsed.plan.cuts.length,
    drawable: parsed.plan.cuts.filter((cut) => cut.x !== undefined).length,
    dropped: parsed.dropped,
  });
  return { plan: parsed.plan, dropped: parsed.dropped };
}

async function runModel(
  deps: PruneAnalysisDeps,
  input: PruneAnalysisInput,
  localUri: string,
): Promise<string> {
  const imageUri = await deps.prepare(localUri);
  return deps.generate({
    imageUri,
    system: buildPrunePromptSystem(input.rules),
    user: PRUNE_USER_PROMPT,
  });
}
