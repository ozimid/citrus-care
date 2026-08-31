// F23 pruning plans, IO half: AsyncStorage wiring around the pure store in
// prune-store.ts. Thin by policy (README testing) — the ordering, the tick
// bookkeeping and the untrusted-read repairs are all pure and tested there,
// and the run itself is the tested prune-flow.ts.
//
// Plan photos are written through savePlantPhoto, so they land in the same
// per-plant directory as assessment photos and are removed by the same cascade
// when the plant is deleted. They are deliberately NOT added to the photo
// index: that index maps assessmentId → photo, and a pruning plan is not an
// assessment. The plan record holds its own uri.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PrunePlan } from "@citrus/shared";
import { newLocalId } from "./local-id";
import {
  MARKS_NOTICE_SEEN_KEY,
  PRUNE_STORAGE_KEY,
  latestPlanForPlant,
  parsePruneStore,
  plansForPlant,
  removePlantPlans,
  serializePruneStore,
  toggleCutDone,
  upsertPrunePlan,
  type PruneStore,
  type StoredPrunePlan,
} from "./prune-store";

/** Reads degrade to an empty store — a corrupt blob must not wedge the screen. */
export async function loadPruneStore(): Promise<PruneStore> {
  try {
    return parsePruneStore(await AsyncStorage.getItem(PRUNE_STORAGE_KEY));
  } catch (e) {
    console.error("[prune-io] load failed:", (e as Error).message);
    return {};
  }
}

/** Writes throw — a silently unsaved plan loses the user's analysis. */
export async function savePruneStore(store: PruneStore): Promise<void> {
  await AsyncStorage.setItem(PRUNE_STORAGE_KEY, serializePruneStore(store));
}

/** Wired as runPruneAnalysis's `persist` dep. Returns the new plan id. */
export async function persistPrunePlan(input: {
  plantId: string;
  photoUri: string;
  photoAspect: number;
  ruleClass: string;
  plan: PrunePlan;
}): Promise<string> {
  const store = await loadPruneStore();
  const record: StoredPrunePlan = {
    id: newLocalId(Date.now(), Math.random()),
    plantId: input.plantId,
    createdAt: new Date().toISOString(),
    photoUri: input.photoUri,
    photoAspect: input.photoAspect,
    ruleClass: input.ruleClass,
    plan: input.plan,
    doneCuts: [],
  };
  await savePruneStore(upsertPrunePlan(store, record));
  return record.id;
}

export async function loadPlantPrunePlans(plantId: string): Promise<StoredPrunePlan[]> {
  return plansForPlant(await loadPruneStore(), plantId);
}

export async function loadLatestPrunePlan(plantId: string): Promise<StoredPrunePlan | null> {
  return latestPlanForPlant(await loadPruneStore(), plantId);
}

/** Tick a cut off in the garden. Returns the updated record so the screen can
 * re-render without a second read; null when the plan has gone. */
export async function toggleCut(planId: string, cutIndex: number): Promise<StoredPrunePlan | null> {
  const next = toggleCutDone(await loadPruneStore(), planId, cutIndex);
  await savePruneStore(next);
  return next[planId] ?? null;
}

/** Cascade on plant delete. */
export async function deletePlantPrunePlans(plantId: string): Promise<void> {
  await savePruneStore(removePlantPlans(await loadPruneStore(), plantId));
}

/** One-time marks disclosure. Read degrades to TRUE (seen) and the write is
 * best-effort — a broken storage layer must not turn a one-time notice into a
 * permanent nag (same rule as the F36 snap-tips flag). */
export async function loadMarksNoticeSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(MARKS_NOTICE_SEEN_KEY)) !== null;
  } catch (e) {
    console.error("[prune-io] marks-notice flag read failed:", (e as Error).message);
    return true;
  }
}

export async function markMarksNoticeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(MARKS_NOTICE_SEEN_KEY, new Date().toISOString());
  } catch (e) {
    console.error("[prune-io] marks-notice flag save failed:", (e as Error).message);
  }
}
