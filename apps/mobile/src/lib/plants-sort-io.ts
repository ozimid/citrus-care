// Plants-tab sort preference, IO half (thin, untested by policy — the
// capture-modes-io pattern). F39 Phase 3b: "Newest" is today's order; "Needs
// a check" ranks never-assessed and longest-unassessed plants first
// (walk-order.ts sortByStaleness). Remembered across opens; the read degrades
// to "newest" so a broken storage layer can never hide a plant behind an
// order the user did not choose, and the write is best-effort.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type PlantsSort = "newest" | "stale";

export const PLANTS_SORT_KEY = "citrus.plants-sort.v1";

export async function loadPlantsSort(): Promise<PlantsSort> {
  try {
    return (await AsyncStorage.getItem(PLANTS_SORT_KEY)) === "stale" ? "stale" : "newest";
  } catch (e) {
    console.error("[plants] sort preference read failed:", (e as Error).message);
    return "newest";
  }
}

export async function savePlantsSort(sort: PlantsSort): Promise<void> {
  try {
    await AsyncStorage.setItem(PLANTS_SORT_KEY, sort);
  } catch (e) {
    console.error("[plants] sort preference save failed:", (e as Error).message);
  }
}
