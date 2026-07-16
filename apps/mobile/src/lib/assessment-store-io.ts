// Local-first assessment store, IO half (D-17): thin AsyncStorage wiring around
// the pure logic in assessment-store.ts. Untested by design — the store/parse
// logic is pure and tested in assessment-store.test.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ASSESSMENT_STORAGE_KEY,
  parseAssessmentStore,
  removePlantAssessments,
  serializeAssessmentStore,
  upsertAssessment,
  type AssessmentStore,
  type StoredAssessment,
} from "./assessment-store";

/** Reads degrade to an empty store — a corrupt blob must not wedge the app. */
export async function loadAssessmentStore(): Promise<AssessmentStore> {
  return parseAssessmentStore(await AsyncStorage.getItem(ASSESSMENT_STORAGE_KEY));
}

/** Writes throw — a silently unsaved assessment loses the user's diagnosis. */
export async function saveAssessmentStore(store: AssessmentStore): Promise<void> {
  await AsyncStorage.setItem(ASSESSMENT_STORAGE_KEY, serializeAssessmentStore(store));
}

export async function putAssessment(assessment: StoredAssessment): Promise<void> {
  await saveAssessmentStore(upsertAssessment(await loadAssessmentStore(), assessment));
}

export async function deletePlantAssessments(plantId: string): Promise<void> {
  await saveAssessmentStore(removePlantAssessments(await loadAssessmentStore(), plantId));
}
