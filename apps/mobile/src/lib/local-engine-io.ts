// On-device engine, IO half (D-15 Stage 2, D-17 local-only): AsyncStorage for
// the opt-in setting + the on-device store insert that persists a locally
// produced assessment. Thin by design (README testing policy) — the state
// machine and the settings parsing are pure and tested in local-engine.ts /
// local-engine.test.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { Paths } from "expo-file-system";
import type { AssessmentDiagnosis } from "@citrus/shared";
import {
  assessmentsForPlant,
  upsertAssessment,
  withComputedComparison,
  type StoredAssessment,
} from "./assessment-store";
import { loadAssessmentStore, saveAssessmentStore } from "./assessment-store-io";
import { newLocalId } from "./local-id";
import { setPlantCover } from "./plant-store-io";
import {
  DEFAULT_LOCAL_ENGINE_SETTINGS,
  LOCAL_ENGINE_STORAGE_KEY,
  parseLocalEngineSettings,
  serializeLocalEngineSettings,
  type LocalEngineSettings,
  LOAD_SENTINEL_STORAGE_KEY,
  deviceCapability,
} from "./local-engine";

export async function loadLocalEngineSettings(): Promise<LocalEngineSettings> {
  try {
    return parseLocalEngineSettings(await AsyncStorage.getItem(LOCAL_ENGINE_STORAGE_KEY));
  } catch (e) {
    // A settings read is never worth blocking the app: fall back to "off".
    console.error("[local-engine-io] settings load failed:", (e as Error).message);
    return DEFAULT_LOCAL_ENGINE_SETTINGS;
  }
}

/** F33: the live pre-flight verdict (expo-device + Platform feed the pure
 * deviceCapability). Sync — both readings are constants. */
export function deviceCapabilitySnapshot(): ReturnType<typeof deviceCapability> {
  const api = Platform.OS === "android" && typeof Platform.Version === "number" ? Platform.Version : null;
  return deviceCapability(Device.totalMemory, api);
}

/** P0 crash sentinel: present = the last model load never reported back (the
 * process died mid-load). Read degrades to false; arm/clear are best-effort
 * at the call site (a failed sentinel write must not block the engine). */
export async function loadLoadSentinel(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LOAD_SENTINEL_STORAGE_KEY)) !== null;
  } catch (e) {
    console.error("[local-engine] sentinel read failed:", (e as Error).message);
    return false;
  }
}

export async function armLoadSentinel(): Promise<void> {
  await AsyncStorage.setItem(LOAD_SENTINEL_STORAGE_KEY, new Date().toISOString());
}

export async function clearLoadSentinel(): Promise<void> {
  await AsyncStorage.removeItem(LOAD_SENTINEL_STORAGE_KEY);
}

export async function saveLocalEngineSettings(settings: LocalEngineSettings): Promise<void> {
  await AsyncStorage.setItem(LOCAL_ENGINE_STORAGE_KEY, serializeLocalEngineSettings(settings));
}

/** F22 — free bytes on internal storage, for the pre-download precheck
 * (expo-file-system SDK 57; a sync native getter). Null when the platform
 * won't say: hasRoomForLocalModel treats that as "don't block". */
export function availableDiskSpaceBytes(): number | null {
  try {
    const bytes = Paths.availableDiskSpace;
    return typeof bytes === "number" && !Number.isNaN(bytes) ? bytes : null;
  } catch (e) {
    console.error("[local-engine-io] free space read failed:", (e as Error).message);
    return null;
  }
}

export interface PersistLocalAssessmentInput {
  plantId: string;
  diagnosis: AssessmentDiagnosis;
  /** The model's raw text — accepted for the assess-flow contract, not stored
   * (the structured diagnosis is what matters, and raw would bloat the store). */
  raw: string;
}

/** Insert an on-device diagnosis into the local assessment store (D-17). The
 * newest existing assessment is the comparison anchor: its health score drives
 * the deterministic better/same/worse delta injected here so the timeline trend
 * survives without a model-emitted comparison. Best-effort cover update. Throws
 * on a store write failure (the assess flow surfaces it as a retryable error). */
export async function persistLocalAssessment(input: PersistLocalAssessmentInput): Promise<string> {
  const store = await loadAssessmentStore();
  const previous = assessmentsForPlant(store, input.plantId)[0] ?? null;
  const diagnosis = withComputedComparison(input.diagnosis, previous?.diagnosis.health_score ?? null);

  const assessment: StoredAssessment = {
    id: newLocalId(Date.now(), Math.random()),
    plantId: input.plantId,
    createdAt: new Date().toISOString(),
    diagnosis,
    comparedToId: previous?.id ?? null,
    engine: "on-device",
  };
  await saveAssessmentStore(upsertAssessment(store, assessment));

  // A missed cover only costs a thumbnail — never fail the assessment for it.
  try {
    await setPlantCover(input.plantId, assessment.id);
  } catch (e) {
    console.error("[local-engine-io] cover update failed:", (e as Error).message);
  }

  return assessment.id;
}
