// On-device engine, IO half (D-15 Stage 2): AsyncStorage for the opt-in
// setting + the RLS-scoped Supabase insert that persists a locally produced
// assessment. Thin by design (README testing policy) — the row shape, the
// state machine and the settings parsing are pure and tested in
// local-engine.ts / local-engine.test.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paths } from "expo-file-system";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  ENGINE_STATS_LIMIT,
  LOCAL_ENGINE_STORAGE_KEY,
  parseLocalEngineSettings,
  serializeLocalEngineSettings,
  type LocalEngineSettings,
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

/** F22 — the engines behind this user's most recent assessments, newest first
 * (RLS scopes it to their own rows; the tally is pure, in local-engine.ts).
 * Returns [] on any failure — a stat line is never worth an error on Profile,
 * and before migration 0007 is applied this column simply doesn't exist. */
export async function fetchRecentEngines(client: SupabaseClient): Promise<(string | null)[]> {
  const { data, error } = await client
    .from("assessments")
    .select("engine")
    .order("created_at", { ascending: false })
    .limit(ENGINE_STATS_LIMIT);
  if (error || !data) {
    console.error("[local-engine-io] engine stats query failed:", error?.message);
    return [];
  }
  return (data as { engine: string | null }[]).map((row) => row.engine);
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
