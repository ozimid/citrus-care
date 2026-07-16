// Local-first plant store, IO half (D-17): thin AsyncStorage wiring around the
// pure logic in plant-store.ts. Untested by design (README testing policy) —
// the store/parse logic is pure and tested in plant-store.test.ts. One JSON
// blob, whole-store read/write, read-modify-write through the pure functions.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  PLANT_STORAGE_KEY,
  parsePlantStore,
  removePlant,
  serializePlantStore,
  upsertPlant,
  type PlantStore,
  type StoredPlant,
} from "./plant-store";

/** Reads degrade to an empty store — a corrupt blob must not wedge the app. */
export async function loadPlantStore(): Promise<PlantStore> {
  return parsePlantStore(await AsyncStorage.getItem(PLANT_STORAGE_KEY));
}

/** Writes throw — a silently unsaved plant is worse than a visible failure. */
export async function savePlantStore(store: PlantStore): Promise<void> {
  await AsyncStorage.setItem(PLANT_STORAGE_KEY, serializePlantStore(store));
}

export async function putPlant(plant: StoredPlant): Promise<void> {
  await savePlantStore(upsertPlant(await loadPlantStore(), plant));
}

export async function deletePlantRecord(plantId: string): Promise<void> {
  await savePlantStore(removePlant(await loadPlantStore(), plantId));
}
