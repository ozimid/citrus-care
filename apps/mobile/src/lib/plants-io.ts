// D-17 plant/assessment queries: thin AsyncStorage orchestration (untested by
// policy) that loads the on-device stores, runs the tested store-adapters, and
// feeds the tested list/detail mappers. Replaces the old Supabase queries — no
// client, no user_id, no network. Generic client-facing errors; details logged.

import type { NewPlantInput } from "@citrus/shared";
import { allAssessments, type AssessmentStore } from "./assessment-store";
import { deletePlantAssessments, loadAssessmentStore } from "./assessment-store-io";
import { deletePlantChat } from "./plant-chat-io";
import { deletePlantQueuedPhotos } from "./photo-queue-io";
import { deletePlantPrunePlans } from "./prune-io";
import { buildStoredPlant, bulkPlantInputs, GENERIC_CREATE_PLANT_ERROR, ZONE_FORMAT_ERROR } from "./new-plant";
import { newLocalId } from "./local-id";
import {
  applyPlantUpdate,
  applyWalkOrders,
  GENERIC_DELETE_PLANT_ERROR,
  GENERIC_UPDATE_PLANT_ERROR,
  placeInZone,
  placeNewPlant,
} from "./plant-mutations";
import {
  mapTimelineRows,
  PLANT_DETAIL_LOAD_ERROR,
  type PlantDetailData,
} from "./plant-detail";
import { attachCoverPhotos, mapPlantRows, type PlantListItem } from "./plants";
import { allPlants, getPlant, upsertPlant, type PlantStore } from "./plant-store";
import { deletePlantRecord, loadPlantStore, savePlantStore } from "./plant-store-io";
import { normalizeTag } from "./plant-tags";
import { deleteLocalPlantPhotos, loadPhotoIndex } from "./photo-store-io";
import { buildDiagnosisContext } from "./spike-vlm";
import {
  plantDetailRowFromStore,
  plantRowsFromStore,
  timelineRowsFromStore,
} from "./store-adapters";
import { lastWateredAt, parseStoredCareProfile } from "./watering";
import { getWateringLog } from "./watering-io";
import { cachedLocalConditions } from "./weather-io";

async function loadStores(): Promise<{ plants: PlantStore; assessments: AssessmentStore }> {
  const [plants, assessments] = await Promise.all([loadPlantStore(), loadAssessmentStore()]);
  return { plants, assessments };
}

/** The plants list, newest-first, with latest score, trend chip and the
 * card's cover photo (joined from the on-phone index — plain file uris). */
export async function fetchPlants(): Promise<PlantListItem[]> {
  const { plants, assessments } = await loadStores();
  const items = mapPlantRows(plantRowsFromStore(allPlants(plants), allAssessments(assessments)));
  return attachCoverPhotos(items, await loadPhotoIndex());
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

/** #4 — the plant's own record (type, species, watering interval, days since
 * the last watering, recent rain, heat) folded into the diagnosis prompt so
 * the model ranks causes with triage pre-answered. Best-effort by design: any
 * failed read means no context ("") — never a blocked assessment. Shared so a
 * batch runner can load it per photo. */
export async function loadDiagnosisContext(plantId: string, now: Date = new Date()): Promise<string> {
  try {
    const [detail, log] = await Promise.all([fetchPlantDetail(plantId), getWateringLog()]);
    const { weather } = await cachedLocalConditions(detail.plant.zip_code, now);
    const profile = parseStoredCareProfile(detail.plant.care_profile);
    const watered = lastWateredAt(log, plantId);
    return buildDiagnosisContext({
      plantType: detail.plant.plant_type,
      species: detail.plant.species,
      wateringIntervalDays: profile?.base_watering_interval_days,
      lastWateredDaysAgo: watered
        ? Math.round((now.getTime() - new Date(watered).getTime()) / 86_400_000)
        : null,
      recentRainMm: weather?.recentPrecipMm ?? null,
      maxTempC: weather?.maxTempC ?? null,
      // No lastScore/lastTrend on purpose: a prior score in the prompt would
      // prime the score the deterministic trend is computed from.
    });
  } catch (e) {
    console.error("[loadDiagnosisContext] context load failed:", (e as Error).message);
    return "";
  }
}

/** Create a plant on the phone; returns its new id (care_profile null — the
 * detail screen backfills it on-device when the model is ready). A plant
 * created in a zone takes the last position in that zone's walk (Phase 3b). */
export async function insertPlant(data: NewPlantInput): Promise<string> {
  try {
    const store = await loadPlantStore();
    const id = newLocalId(Date.now(), Math.random());
    const plant = placeNewPlant(allPlants(store), buildStoredPlant(data, id, new Date().toISOString()));
    await savePlantStore(upsertPlant(store, plant));
    return id;
  } catch (e) {
    console.error("[insertPlant] save failed:", (e as Error).message);
    throw new Error(GENERIC_CREATE_PLANT_ERROR);
  }
}

/** The edit sheet's save. One read-modify-write; a zone change re-places the
 * plant last in its new zone, an input without a zone field keeps it. */
export async function updatePlant(plantId: string, data: NewPlantInput): Promise<void> {
  try {
    const store = await loadPlantStore();
    const next = applyPlantUpdate(store, plantId, data);
    if (!next) throw new Error("plant not found on this device");
    await savePlantStore(upsertPlant(store, next));
  } catch (e) {
    console.error("[updatePlant] save failed:", (e as Error).message);
    throw new Error(GENERIC_UPDATE_PLANT_ERROR);
  }
}

// F39 Phase 3b — zones + walk order (design contract §4: the order RANKS, the
// user's tap COMMITS). Three writes for the Zones sheet; every rule about
// where a plant lands is the tested pure half (plant-mutations / walk-order).

/** "Move to zone…": null clears the zone (and the position); a new zone
 * places the plant last in it. Throws ZONE_FORMAT_ERROR (user-facing) for a
 * label outside the tag alphabet, the generic error when the write fails. */
export async function setPlantZone(plantId: string, zone: string | null): Promise<void> {
  const normalized = zone === null ? null : normalizeTag(zone);
  if (zone !== null && normalized === null) throw new Error(ZONE_FORMAT_ERROR);
  try {
    const store = await loadPlantStore();
    const plant = getPlant(store, plantId);
    if (!plant) throw new Error("plant not found on this device");
    const next = placeInZone(allPlants(store), plant, normalized);
    if (next === plant) return;
    await savePlantStore(upsertPlant(store, next));
  } catch (e) {
    console.error("[setPlantZone] save failed:", (e as Error).message);
    throw new Error(GENERIC_UPDATE_PLANT_ERROR);
  }
}

/** ▲ ▼ on the Zones sheet: persist the whole zone's renumbered positions from
 * reorderWalk in one write, so a kill can never leave two plants on one step. */
export async function setWalkOrders(updates: { id: string; walkOrder: number }[]): Promise<void> {
  if (updates.length === 0) return;
  try {
    const store = await loadPlantStore();
    await savePlantStore(applyWalkOrders(store, updates));
  } catch (e) {
    console.error("[setWalkOrders] save failed:", (e as Error).message);
    throw new Error(GENERIC_UPDATE_PLANT_ERROR);
  }
}

/** "Add several plants…": the drafts bulkPlantDrafts produced, created in
 * order and placed 1..n after whatever the zone already holds. One write for
 * the batch; created_at is one millisecond apart per draft so the parser's
 * duplicate-order repair and the "Newest" sort both see the batch in pattern
 * order. Returns the new ids in draft order. */
export async function insertPlantsBulk(
  drafts: { name: string; plant_type: string; zone: string | null }[],
): Promise<string[]> {
  if (drafts.length === 0) return [];
  // Validated through the sheet's own gate (pure, tested) before anything is
  // written: a bad zone is the user's typo (its error verbatim), not a storage
  // failure. This io only mints ids, places and writes.
  const inputs = bulkPlantInputs(drafts);
  try {
    let store = await loadPlantStore();
    const ids: string[] = [];
    const now = Date.now();
    inputs.forEach((data, i) => {
      const stamp = now + i;
      const id = newLocalId(stamp, Math.random());
      const plant = placeNewPlant(allPlants(store), buildStoredPlant(data, id, new Date(stamp).toISOString()));
      store = upsertPlant(store, plant);
      ids.push(id);
    });
    await savePlantStore(store);
    return ids;
  } catch (e) {
    console.error("[insertPlantsBulk] save failed:", (e as Error).message);
    throw new Error(GENERIC_CREATE_PLANT_ERROR);
  }
}

/** Delete the plant and cascade its assessments, conversation, pruning plans,
 * pending walk photos and on-phone photos. Every cleanup is best-effort; the
 * plant-record delete must succeed (its failure is the one surfaced to the user). */
export async function deletePlantWithPhotos(plantId: string): Promise<void> {
  try {
    await deletePlantAssessments(plantId);
  } catch (e) {
    console.error("[deletePlantWithPhotos] assessment cleanup failed:", (e as Error).message);
  }
  try {
    await deletePlantChat(plantId);
  } catch (e) {
    console.error("[deletePlantWithPhotos] chat cleanup failed:", (e as Error).message);
  }
  try {
    await deletePlantPrunePlans(plantId);
  } catch (e) {
    console.error("[deletePlantWithPhotos] pruning plan cleanup failed:", (e as Error).message);
  }
  // Queue records first: their files live in the plant directory that
  // deleteLocalPlantPhotos removes next, so no record may outlive the files.
  try {
    await deletePlantQueuedPhotos(plantId);
  } catch (e) {
    console.error("[deletePlantWithPhotos] pending photo cleanup failed:", (e as Error).message);
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
