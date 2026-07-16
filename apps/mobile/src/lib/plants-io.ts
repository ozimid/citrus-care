// D-17 plant/assessment queries: thin AsyncStorage orchestration (untested by
// policy) that loads the on-device stores, runs the tested store-adapters, and
// feeds the tested list/detail mappers. Replaces the old Supabase queries — no
// client, no user_id, no network. Generic client-facing errors; details logged.

import type { NewPlantInput } from "@citrus/shared";
import { allAssessments, type AssessmentStore } from "./assessment-store";
import { deletePlantAssessments, loadAssessmentStore } from "./assessment-store-io";
import { buildStoredPlant, GENERIC_CREATE_PLANT_ERROR } from "./new-plant";
import { newLocalId } from "./local-id";
import {
  buildPlantUpdateRow,
  GENERIC_DELETE_PLANT_ERROR,
  GENERIC_UPDATE_PLANT_ERROR,
} from "./plant-mutations";
import {
  mapTimelineRows,
  PLANT_DETAIL_LOAD_ERROR,
  type PlantDetailData,
} from "./plant-detail";
import { mapPlantRows, type PlantListItem } from "./plants";
import { allPlants, getPlant, type PlantStore } from "./plant-store";
import { deletePlantRecord, loadPlantStore, putPlant } from "./plant-store-io";
import { deleteLocalPlantPhotos } from "./photo-store-io";
import {
  plantDetailRowFromStore,
  plantRowsFromStore,
  timelineRowsFromStore,
} from "./store-adapters";

async function loadStores(): Promise<{ plants: PlantStore; assessments: AssessmentStore }> {
  const [plants, assessments] = await Promise.all([loadPlantStore(), loadAssessmentStore()]);
  return { plants, assessments };
}

/** The plants list, newest-first, with latest score + trend chip. */
export async function fetchPlants(): Promise<PlantListItem[]> {
  const { plants, assessments } = await loadStores();
  return mapPlantRows(plantRowsFromStore(allPlants(plants), allAssessments(assessments)));
}

/** One plant's header row + full timeline (newest-first). */
export async function fetchPlantDetail(plantId: string): Promise<PlantDetailData> {
  const { plants, assessments } = await loadStores();
  const plant = getPlant(plants, plantId);
  if (!plant) {
    console.error("[fetchPlantDetail] plant not found on this device:", plantId);
    throw new Error(PLANT_DETAIL_LOAD_ERROR);
  }
  return {
    plant: plantDetailRowFromStore(plant),
    timeline: mapTimelineRows(timelineRowsFromStore(allAssessments(assessments), plantId)),
  };
}

/** Create a plant on the phone; returns its new id (care_profile null — the
 * detail screen backfills it on-device when the model is ready). */
export async function insertPlant(data: NewPlantInput): Promise<string> {
  try {
    const id = newLocalId(Date.now(), Math.random());
    await putPlant(buildStoredPlant(data, id, new Date().toISOString()));
    return id;
  } catch (e) {
    console.error("[insertPlant] save failed:", (e as Error).message);
    throw new Error(GENERIC_CREATE_PLANT_ERROR);
  }
}

export async function updatePlant(plantId: string, data: NewPlantInput): Promise<void> {
  try {
    const store = await loadPlantStore();
    const plant = getPlant(store, plantId);
    if (!plant) throw new Error("plant not found on this device");
    await putPlant({ ...plant, ...buildPlantUpdateRow(data) });
  } catch (e) {
    console.error("[updatePlant] save failed:", (e as Error).message);
    throw new Error(GENERIC_UPDATE_PLANT_ERROR);
  }
}

/** Delete the plant and cascade its assessments + on-phone photos. The
 * assessment/photo cleanup is best-effort; the plant-record delete must
 * succeed (its failure is the one surfaced to the user). */
export async function deletePlantWithPhotos(plantId: string): Promise<void> {
  try {
    await deletePlantAssessments(plantId);
  } catch (e) {
    console.error("[deletePlantWithPhotos] assessment cleanup failed:", (e as Error).message);
  }
  try {
    await deleteLocalPlantPhotos(plantId);
  } catch (e) {
    console.error("[deletePlantWithPhotos] photo cleanup failed:", (e as Error).message);
  }
  try {
    await deletePlantRecord(plantId);
  } catch (e) {
    console.error("[deletePlantWithPhotos] plant delete failed:", (e as Error).message);
    throw new Error(GENERIC_DELETE_PLANT_ERROR);
  }
}
