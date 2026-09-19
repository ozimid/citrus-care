// F39 Garden Walk — the run, pure half (D-W5, D-W6, D-W8, D-W18). Analyzes a
// queue of photos ONE AT A TIME over an injected assess step. This module
// never touches the model: the model closure lives in
// components/assess-deps.ts, outside src/lib, so arch-guard's D-P9 sweep keeps
// its invariant — and a guard test in walk-runner.test.ts keeps the call text
// out of this file, comments included. The AsyncStorage marks, the engine's
// whenIdle() and the clock are all injected (WalkRunnerDeps), so vitest can
// prove the sequencing without a phone.
//
// Why strictly sequential (D-W5): the 120 s budget starts at enqueue and the
// interrupt is global, so fanning out would let photo #5's ceiling kill photo
// #1; a hard-timed-out inference keeps running natively and would eat the
// next item's clock. Hence: await whenIdle() before EVERY item (30 s cap), two
// consecutive timeouts end the run as "struggling", and cancel is only ever
// "stop after this photo" — no user tap interrupts.

import type { AssessmentDiagnosis } from "@citrus/shared";
import {
  ANALYSIS_TIMEOUT_ERROR,
  LOCAL_UNAVAILABLE_ERROR,
  friendlyAssessError,
  type AssessPhase,
  type AssessResult,
} from "./assess";
import type { AssessmentStore } from "./assessment-store";
import { healthBand } from "./health";
import { LOCAL_SLOW_THRESHOLD_MS } from "./inference-budget";
import { durationStats, type QueuedPhoto } from "./photo-queue";
import type { PlantListItem } from "./plants";

/** How long the runner waits for the model session to free up before an item.
 * A nested modal's backfill (care profile, chat) can hold the session; past
 * this the run ends as "engine-stalled" with the item still pending. */
export const WHEN_IDLE_CAP_MS = 30_000;
/** Consecutive hard timeouts that end the run as "struggling" (D-W5). */
export const CONSECUTIVE_TIMEOUT_LIMIT = 2;

export type WalkEnd =
  | "complete"
  | "stopped"
  | "engine-unavailable"
  | "engine-stalled"
  | "struggling"
  | "storage-error";

export type ItemOutcome =
  | {
      kind: "assessed";
      id: string;
      plantId: string;
      assessmentId: string;
      diagnosis: AssessmentDiagnosis;
      /** Model time for this photo — feeds the D-W8 durations ring. */
      durationMs: number;
    }
  | { kind: "rejected"; id: string; plantId: string; diagnosis: AssessmentDiagnosis }
  | { kind: "failed"; id: string; plantId: string; error: string; timedOut: boolean };

/** Everything the runner needs from the world. `assess` is the whole
 * single-shot flow for one queued photo (its plant, its durable uri, the
 * comparison anchor); the `mark*` steps persist the queue record (a throw
 * ends the run, D-W18); `whenIdle` is the engine's tail promise. */
export interface WalkRunnerDeps {
  assess(item: QueuedPhoto, anchorIso: string): Promise<AssessResult>;
  markAnalyzing(item: QueuedPhoto, nowIso: string, anchorIso: string): Promise<void>;
  markAssessed(item: QueuedPhoto, assessmentId: string): Promise<void>;
  markRejected(item: QueuedPhoto, diagnosis: AssessmentDiagnosis): Promise<void>;
  markFailed(item: QueuedPhoto, error: string, timedOut: boolean): Promise<void>;
  /** Back to waiting. `restoreAttempts` = the attempt markAnalyzing counted
   * never reached the model (engine unavailable), so the record must go back
   * to `item.attempts` — D-W2 caps model RUNS, not near-misses. */
  markPending(item: QueuedPhoto, options?: { restoreAttempts?: boolean }): Promise<void>;
  whenIdle(): Promise<void>;
  now(): number;
}

/** "Stop after this photo": the screen flips it, the runner reads it between
 * items. Nothing here ever interrupts a running inference. */
export interface WalkControl {
  requested(): boolean;
  stopAfterCurrent(): void;
}

export interface WalkHooks {
  /** `index` is 0-based (the position in `items`). */
  onItemStart?(index: number, item: QueuedPhoto): void;
  /** "saving" while the analyzing mark is persisted (a flash), "analyzing"
   * while the model runs — the same two phases the single-shot screen shows. */
  onPhase?(phase: AssessPhase): void;
  /** Once per item that passes the shared slow threshold; a UI hint only. */
  onSlow?(): void;
  onItemEnd?(index: number, outcome: ItemOutcome): void;
}

export interface WalkRunResult {
  /** In run order. Kept in memory even when a mark failed (D-W18). */
  outcomes: ItemOutcome[];
  endedBy: WalkEnd;
  /** Model time of each assessed photo, for the durations ring. */
  durationsMs: number[];
  /** Items the run did not finish — still pending in the queue. Always set by
   * runWalk; optional only so a hand-built result stays valid. */
  remaining?: number;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** A hook is UI; a throwing one must never end a run. */
function safeHook(run: () => void): void {
  try {
    run();
  } catch (e) {
    console.error("[runWalk] hook failed:", (e as Error).message);
  }
}

/** True when the engine went idle within `capMs`; false when the cap won.
 * A rejected tail means the previous request failed — the session is free. */
function idleWithin(whenIdle: () => Promise<void>, capMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), capMs);
    const settle = () => {
      clearTimeout(timer);
      resolve(true);
    };
    try {
      whenIdle().then(settle, settle);
    } catch {
      settle();
    }
  });
}

/** A persisted mark that throws ends the run (D-W18); the caller decides how.
 * Returns whether it was saved. */
async function tryMark(step: string, mark: () => Promise<void>): Promise<boolean> {
  try {
    await mark();
    return true;
  } catch (e) {
    console.error(`[runWalk] ${step} failed:`, (e as Error).message);
    return false;
  }
}

/** D-W6: one comparison anchor per (plant, walk) — the instant the plant's
 * first photo of that walk started in THIS run, so two angles of one tree 40 s
 * apart never read "Worse" against each other. A record that already carries
 * an anchor (resume, retry) keeps it, and seeds its group with it so a sibling
 * without one compares against the same visit. */
function anchorFor(anchors: Map<string, string>, item: QueuedPhoto, plantId: string, now: () => number): string {
  const key = `${plantId}\n${item.walkId}`;
  const known = anchors.get(key);
  const anchor = item.runAnchorIso ?? known ?? isoOf(now());
  if (known === undefined) anchors.set(key, anchor);
  return anchor;
}

/**
 * Analyze `items` in order, one at a time. Per item: stop check → whenIdle
 * (capped) → markAnalyzing (persisted BEFORE the model, D-W2) → assess →
 * the matching mark. Outcomes are collected for the summary; the queue
 * records are the source of truth on disk.
 */
export async function runWalk(
  items: QueuedPhoto[],
  deps: WalkRunnerDeps,
  control: WalkControl,
  hooks: WalkHooks = {},
): Promise<WalkRunResult> {
  const outcomes: ItemOutcome[] = [];
  const durationsMs: number[] = [];
  const anchors = new Map<string, string>();
  let strikes = 0;

  const end = (endedBy: WalkEnd, nextIndex: number): WalkRunResult => ({
    outcomes,
    endedBy,
    durationsMs,
    remaining: Math.max(0, items.length - nextIndex),
  });

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const plantId = item.plantId;
    // D-W3 rung 6: an unassigned photo never spends model time.
    if (plantId === null) continue;
    if (control.requested()) return end("stopped", index);

    safeHook(() => hooks.onItemStart?.(index, item));

    if (!(await idleWithin(deps.whenIdle, WHEN_IDLE_CAP_MS))) return end("engine-stalled", index);

    const anchor = anchorFor(anchors, item, plantId, deps.now);
    safeHook(() => hooks.onPhase?.("saving"));
    if (!(await tryMark("markAnalyzing", () => deps.markAnalyzing(item, isoOf(deps.now()), anchor)))) {
      return end("storage-error", index);
    }

    safeHook(() => hooks.onPhase?.("analyzing"));
    const startedMs = deps.now();
    // The same slow hint the single-shot flow gives: copy changes, nothing is
    // abandoned. (Only the estimate copy is barred from these constants.)
    const slowTimer = setTimeout(() => safeHook(() => hooks.onSlow?.()), LOCAL_SLOW_THRESHOLD_MS);
    let result: AssessResult | null = null;
    let failure: unknown = null;
    let failed = false;
    try {
      result = await deps.assess(item, anchor);
    } catch (e) {
      failed = true;
      failure = e;
    } finally {
      clearTimeout(slowTimer);
    }

    if (failed || result === null) {
      const message = failure instanceof Error ? failure.message : "";
      if (message === LOCAL_UNAVAILABLE_ERROR) {
        // Not this photo's fault: back to waiting with the attempt handed back
        // (no model time was spent), and the run ends honestly.
        if (!(await tryMark("markPending", () => deps.markPending(item, { restoreAttempts: true })))) {
          return end("storage-error", index);
        }
        return end("engine-unavailable", index);
      }
      const timedOut = message === ANALYSIS_TIMEOUT_ERROR;
      const outcome: ItemOutcome = { kind: "failed", id: item.id, plantId, error: friendlyAssessError(failure), timedOut };
      outcomes.push(outcome);
      const saved = await tryMark("markFailed", () => deps.markFailed(item, outcome.error, timedOut));
      safeHook(() => hooks.onItemEnd?.(index, outcome));
      if (!saved) return end("storage-error", index + 1);
      strikes = timedOut ? strikes + 1 : 0;
      if (strikes >= CONSECUTIVE_TIMEOUT_LIMIT) return end("struggling", index + 1);
      continue;
    }

    strikes = 0;
    if (result.status === "rejected") {
      const outcome: ItemOutcome = { kind: "rejected", id: item.id, plantId, diagnosis: result.diagnosis };
      outcomes.push(outcome);
      const saved = await tryMark("markRejected", () => deps.markRejected(item, outcome.diagnosis));
      safeHook(() => hooks.onItemEnd?.(index, outcome));
      if (!saved) return end("storage-error", index + 1);
      continue;
    }

    const durationMs = Math.max(0, deps.now() - startedMs);
    durationsMs.push(durationMs);
    const outcome: ItemOutcome = {
      kind: "assessed",
      id: item.id,
      plantId,
      assessmentId: result.assessmentId,
      diagnosis: result.diagnosis,
      durationMs,
    };
    outcomes.push(outcome);
    const saved = await tryMark("markAssessed", () => deps.markAssessed(item, outcome.assessmentId));
    safeHook(() => hooks.onItemEnd?.(index, outcome));
    if (!saved) return end("storage-error", index + 1);
  }

  return end("complete", items.length);
}

/** The runner's outcome carries what the assess step returned — the model's
 * raw parse. The deterministic better/same/worse (withComputedComparison) is
 * injected only when the row is PERSISTED, and only the id comes back, so the
 * summary's delta (D-W6), the bulk reminder's interval (D-W10) and the opened
 * diagnosis must read the stored row. A row the store cannot show (a degraded
 * read) keeps the model's — a missing delta, never a wrong one. */
export function withStoredDiagnosis(result: AssessResult, store: AssessmentStore): AssessResult {
  if (result.status !== "assessed") return result;
  const stored = store[result.assessmentId]?.diagnosis;
  return stored ? { ...result, diagnosis: stored } : result;
}

// ---- Progress copy (D-W8): a true count, phase words, measured minutes ----

/** Median of the measured ring × photos left; null until two samples exist —
 * one cold first run is not a forecast. */
export function estimateRemainingMs(ring: number[], remaining: number): number | null {
  const { median, count } = durationStats(ring);
  if (median === null || count < 2) return null;
  return Math.round(median * Math.max(0, remaining));
}

/** "under a minute" · "about 9 min" · "about 1 h 10 min" — coarse on purpose. */
export function formatMinutes(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "under a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`;
}

function photosWord(count: number): string {
  return count === 1 ? "1 photo" : `${count} photos`;
}

/** What to expect before tapping "Analyze now". Without history the honest
 * line is the per-photo ceiling in plain words; with history, the measured
 * estimate. Written out, never computed from the budget constants. */
export function expectedCopy(count: number, ring: number[]): string {
  const estimate = estimateRemainingMs(ring, count);
  if (estimate === null) {
    const lead = "Each photo takes up to 2 minutes on this phone — often much less.";
    return count === 1
      ? `${lead} Keep Citrus Care open.`
      : `${lead} ${photosWord(count)} could take a while; keep Citrus Care open.`;
  }
  const when = formatMinutes(estimate);
  return `${when.charAt(0).toUpperCase()}${when.slice(1)} for ${photosWord(count)}, based on your last runs. Keep Citrus Care open.`;
}

/** "3 of 12 · Meyer lemon · analyzing on this phone…" — `index` is the
 * 1-based position of the photo being worked on. Never a percentage. */
export function progressLabel(index: number, total: number, plantLabel: string, slow: boolean): string {
  const phase = slow ? "still analyzing — this one's taking longer…" : "analyzing on this phone…";
  return `${index} of ${total} · ${plantLabel} · ${phase}`;
}

const PHASE_LABEL: Record<AssessPhase, string> = {
  saving: "Saving photo…",
  analyzing: "Analyzing on this phone…",
};

// First inference on a cold model is legitimately slow — say so rather than
// leaving the user staring at a spinner (there is no cloud to fall back to).
const SLOW_LABEL = "Still analyzing — the first one takes longer…";

/** The single-shot busy line (moved from ReviewScreen so both screens share
 * the copy): the slow hint wins, else the phase, else nothing. */
export function phaseLabel(phase: AssessPhase | null, slow: boolean): string {
  return slow ? SLOW_LABEL : phase ? PHASE_LABEL[phase] : "";
}

/** The walk's per-row slow line. "The first one takes longer" is single-shot
 * copy — on photo seven it is a falsifiable claim in the run's most anxious
 * moment, so the row says what the header says. */
export const WALK_SLOW_LABEL = "Still analyzing — this one's taking longer…";

// ---- Summary ----

export interface WalkSummaryRow {
  plantId: string;
  plantName: string;
  /** Photos of this plant in the run, every kind. */
  count: number;
  latestScore: number | null;
  latestBand: string | null;
  /** From the latest assessed photo's comparison; "unknown" reads as none. */
  delta: "better" | "same" | "worse" | null;
  /** The pre-walk anchor the deltas compare against (D-W6). */
  anchorDate: string | null;
  rejected: number;
  /** Failed for a reason other than the ceiling; timeouts are counted apart. */
  failed: number;
  timedOut: number;
}

function deltaOf(diagnosis: AssessmentDiagnosis): WalkSummaryRow["delta"] {
  const delta = diagnosis.comparison?.delta;
  return delta === "better" || delta === "same" || delta === "worse" ? delta : null;
}

/** The summary's per-plant "vs. before <date>": the anchor of the plant's
 * LATEST assessed photo — the one whose delta the row shows. Anchors are per
 * (plant, walk) (D-W6), so `anchorOf` is keyed by photo id (what the screen
 * recorded when each photo was marked), and a mixed-walk run picks the walk
 * the shown delta was computed against, not the first walk of the plant. */
export function anchorsByPlant(outcomes: ItemOutcome[], anchorOf: Record<string, string | undefined>): Record<string, string | null> {
  const byPlant: Record<string, string | null> = {};
  for (const outcome of outcomes) {
    if (outcome.kind === "assessed") byPlant[outcome.plantId] = anchorOf[outcome.id] ?? null;
  }
  return byPlant;
}

/** One row per plant, in the order the run first reached it. Built from the
 * in-memory outcomes, so it is right even when a mark failed (D-W18). */
export function summarizeWalk(
  outcomes: ItemOutcome[],
  plants: Pick<PlantListItem, "id" | "name">[],
  anchors: Record<string, string | null>,
): WalkSummaryRow[] {
  const names = new Map(plants.map((p) => [p.id, p.name] as const));
  const rows = new Map<string, WalkSummaryRow>();
  for (const outcome of outcomes) {
    let row = rows.get(outcome.plantId);
    if (!row) {
      const anchor = anchors[outcome.plantId];
      row = {
        plantId: outcome.plantId,
        plantName: names.get(outcome.plantId) ?? "Plant",
        count: 0,
        latestScore: null,
        latestBand: null,
        delta: null,
        anchorDate: typeof anchor === "string" ? anchor : null,
        rejected: 0,
        failed: 0,
        timedOut: 0,
      };
      rows.set(outcome.plantId, row);
    }
    row.count += 1;
    if (outcome.kind === "assessed") {
      row.latestScore = outcome.diagnosis.health_score;
      row.latestBand = healthBand(outcome.diagnosis.health_score).label;
      row.delta = deltaOf(outcome.diagnosis);
    } else if (outcome.kind === "rejected") {
      row.rejected += 1;
    } else if (outcome.timedOut) {
      row.timedOut += 1;
    } else {
      row.failed += 1;
    }
  }
  return [...rows.values()];
}

/** "Done · 11 analyzed · 1 wasn't a plant · 2 took too long" — counts for a
 * run that ran; one honest, generic sentence for a run the phone ended. */
export function summaryHeadline(result: WalkRunResult): string {
  switch (result.endedBy) {
    case "engine-unavailable":
      return "The AI isn't ready on this phone — your photos are kept.";
    case "struggling":
      return "This phone is struggling — stopped after two photos took too long. Nothing was lost; try again later.";
    case "engine-stalled":
      return "The AI didn't respond — your photos are kept. Try again in a moment.";
    case "storage-error":
      return "Couldn't save progress — your photos are kept. Reopen the app and try again.";
    case "complete":
    case "stopped": {
      let assessed = 0;
      let rejected = 0;
      let timedOut = 0;
      let failed = 0;
      for (const o of result.outcomes) {
        if (o.kind === "assessed") assessed += 1;
        else if (o.kind === "rejected") rejected += 1;
        else if (o.timedOut) timedOut += 1;
        else failed += 1;
      }
      const parts = [result.endedBy === "complete" ? "Done" : "Stopped", `${assessed} analyzed`];
      if (rejected > 0) parts.push(rejected === 1 ? "1 wasn't a plant" : `${rejected} weren't plants`);
      if (timedOut > 0) parts.push(`${timedOut} took too long`);
      if (failed > 0) parts.push(`${failed} couldn't be analyzed`);
      // Stopped early, or a finished run whose photos the user sent back to
      // waiting with a late Retry: either way they are in the queue, not lost.
      const remaining = result.remaining ?? 0;
      if (remaining > 0) parts.push(`${remaining} waiting`);
      return parts.join(" · ");
    }
  }
}

/** The tally under an abnormal ending's headline — "7 analyzed · 5 still
 * waiting" — so the cause sentence never hides what the wait bought. Null for
 * complete/stopped, whose headline already counts. */
export function summaryCounts(result: WalkRunResult): string | null {
  if (result.endedBy === "complete" || result.endedBy === "stopped") return null;
  const assessed = result.outcomes.filter((o) => o.kind === "assessed").length;
  return `${assessed} analyzed · ${result.remaining ?? 0} still waiting`;
}
