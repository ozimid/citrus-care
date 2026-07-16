// F20 — watering, IO half: AsyncStorage wiring for the pure log helpers in
// watering.ts (same split as photo-store.ts vs photo-store-io.ts). Untested by
// design — README testing policy: the logic lives in watering.test.ts.
//
// The log is local-only, like photos (D-16): the phone owns when you watered,
// nothing is synced. The care profile is NOT here — it rides on the plants row
// (plants.ts / plant-detail.ts already select care_profile).

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  markWatered,
  parseWateringLog,
  serializeWateringLog,
  WATERING_LOG_STORAGE_KEY,
  type WateringLog,
} from "./watering";

/** The whole log in one read — the Plants list plans every card from it. A
 * failed/garbled read degrades to "nothing logged", which just falls back to
 * the last-assessment anchor. */
export async function getWateringLog(): Promise<WateringLog> {
  try {
    return parseWateringLog(await AsyncStorage.getItem(WATERING_LOG_STORAGE_KEY));
  } catch (e) {
    console.error("[getWateringLog] read failed:", (e as Error).message);
    return {};
  }
}

/** Replace the whole watering log (backup import). Throws on a write failure. */
export async function saveWateringLog(log: WateringLog): Promise<void> {
  await AsyncStorage.setItem(WATERING_LOG_STORAGE_KEY, serializeWateringLog(log));
}

/**
 * Record a "Watered today" tap and return the updated log, so the caller can
 * recompute the plan without a second read. Throws on a write failure: this one
 * IS worth telling the user about — a silently unrecorded watering would show
 * the plant as due forever.
 */
export async function recordWatered(plantId: string, at: Date = new Date()): Promise<WateringLog> {
  const log = markWatered(await getWateringLog(), plantId, at);
  try {
    await AsyncStorage.setItem(WATERING_LOG_STORAGE_KEY, serializeWateringLog(log));
  } catch (e) {
    console.error("[recordWatered] write failed:", (e as Error).message);
    throw new Error("Could not record the watering. Please try again.");
  }
  return log;
}
