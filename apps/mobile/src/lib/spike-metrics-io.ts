// Thin AsyncStorage wrapper around the pure run-log logic in spike-metrics.ts
// (same pure/side-effectful split as photo-store.ts vs photo-store-io.ts).
// Untested by design — README testing policy: modules importing react-native
// are exercised via `expo export` bundling, the logic via spike-metrics.test.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { RUN_LOG_STORAGE_KEY, parseRunLog, serializeRunLog, type SpikeRun } from "./spike-metrics";

export async function loadRunLog(): Promise<SpikeRun[]> {
  return parseRunLog(await AsyncStorage.getItem(RUN_LOG_STORAGE_KEY));
}

export async function saveRunLog(log: SpikeRun[]): Promise<void> {
  await AsyncStorage.setItem(RUN_LOG_STORAGE_KEY, serializeRunLog(log));
}
