// F23 pruning plans, pure half: one AsyncStorage blob keyed by plan id (the
// flat shape assessment-store uses), because a plan belongs to a plant the same
// way an assessment does — many per plant, newest first, cascade on delete.
//
// `doneCuts` is what makes this a tracker rather than a one-shot answer: the
// grower is standing at the plant with the phone, ticking cuts off as they make
// them. Indexes into plan.cuts, which is safe because a stored plan is never
// re-ordered after it is written (prune-plan sorts by priority BEFORE the plan
// is stored).
//
// Untrusted on read: a malformed record is dropped, a malformed doneCuts list
// is repaired to empty — losing a tick is nothing, losing the plan is not.
// The AsyncStorage wiring is the thin prune-io.ts.

import type { PrunePlan } from "@citrus/shared";

export interface StoredPrunePlan {
  id: string;
  plantId: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Durable on-phone uri of the photo the plan was drawn on. Lives under the
   * plant's photo directory, so deleting the plant deletes it. */
  photoUri: string;
  /** width / height of that photo. Load-bearing, not decoration: the cuts are
   * percentages OF THE PHOTO, so the overlay has to render the image at its
   * true aspect ratio (never cropped to fit) or every marker slides off the
   * branch it was pointing at. */
  photoAspect: number;
  /** Which rule pack produced the prompt ("citrus", "rose", …) — recorded so a
   * later rule-pack change is visible rather than silently retroactive. */
  ruleClass: string;
  plan: PrunePlan;
  /** Indexes into plan.cuts the grower has ticked off. */
  doneCuts: number[];
}

/** planId → plan. */
export type PruneStore = Record<string, StoredPrunePlan>;

export const PRUNE_STORAGE_KEY = "citrus.prune-plans.v1";

/** Set once the grower has seen the "these marks can be wrong" disclosure. The
 * disclosure is proportionate to an irreversible physical action, so it is
 * shown before the first overlay — and only once. */
export const MARKS_NOTICE_SEEN_KEY = "citrus.prune-marks-notice.v1";

export function upsertPrunePlan(store: PruneStore, plan: StoredPrunePlan): PruneStore {
  return { ...store, [plan.id]: plan };
}

function byCreatedAtDesc(a: StoredPrunePlan, b: StoredPrunePlan): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export function plansForPlant(store: PruneStore, plantId: string): StoredPrunePlan[] {
  return Object.values(store)
    .filter((plan) => plan.plantId === plantId)
    .sort(byCreatedAtDesc);
}

export function latestPlanForPlant(store: PruneStore, plantId: string): StoredPrunePlan | null {
  return plansForPlant(store, plantId)[0] ?? null;
}

/** Cascade on plant delete. */
export function removePlantPlans(store: PruneStore, plantId: string): PruneStore {
  const next: PruneStore = {};
  for (const [id, plan] of Object.entries(store)) {
    if (plan.plantId !== plantId) next[id] = plan;
  }
  return next;
}

/** Tick a cut off (or back on). An index that isn't a cut in this plan, or an
 * unknown plan, is a no-op — the store never invents a tick. */
export function toggleCutDone(store: PruneStore, planId: string, cutIndex: number): PruneStore {
  const plan = store[planId];
  if (!plan) return store;
  if (!Number.isInteger(cutIndex) || cutIndex < 0 || cutIndex >= plan.plan.cuts.length) return store;
  const done = plan.doneCuts.includes(cutIndex)
    ? plan.doneCuts.filter((index) => index !== cutIndex)
    : [...plan.doneCuts, cutIndex].sort((a, b) => a - b);
  return { ...store, [planId]: { ...plan, doneCuts: done } };
}

export function cutProgress(plan: StoredPrunePlan): { done: number; total: number } {
  return { done: plan.doneCuts.length, total: plan.plan.cuts.length };
}

/** A square is the honest fallback for an unreadable aspect: it distorts the
 * picture visibly rather than quietly shifting the markers on a plausible one. */
function validAspect(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

/** Keep only indexes that point at a real cut in this plan. */
function validDoneCuts(value: unknown, cutCount: number): number[] {
  if (!Array.isArray(value)) return [];
  const clean = value.filter(
    (index): index is number => Number.isInteger(index) && index >= 0 && index < cutCount,
  );
  return [...new Set(clean)].sort((a, b) => a - b);
}

function isValidRecord(value: unknown): value is StoredPrunePlan {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  const plan = p.plan as Record<string, unknown> | null | undefined;
  return (
    typeof p.id === "string" &&
    typeof p.plantId === "string" &&
    typeof p.createdAt === "string" &&
    typeof p.photoUri === "string" &&
    typeof p.ruleClass === "string" &&
    typeof plan === "object" &&
    plan !== null &&
    typeof plan.summary === "string" &&
    Array.isArray(plan.cuts)
  );
}

/** Parse the stored blob. Untrusted: malformed JSON or records degrade
 * (dropped / empty store), never throw. */
export function parsePruneStore(json: string | null): PruneStore {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const store: PruneStore = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isValidRecord(value)) continue;
    store[id] = {
      ...value,
      photoAspect: validAspect(value.photoAspect),
      doneCuts: validDoneCuts(value.doneCuts, value.plan.cuts.length),
    };
  }
  return store;
}

export function serializePruneStore(store: PruneStore): string {
  return JSON.stringify(store);
}
