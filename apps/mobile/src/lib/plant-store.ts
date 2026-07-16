// Local-first plant store, pure half (D-17): plants live ONLY on the phone now
// — no Supabase, no accounts. A single AsyncStorage JSON blob keyed by plant id
// (same Record pattern as photo-store), read back through a never-throwing
// parser because stored data is untrusted. The AsyncStorage wiring is the thin
// plant-store-io.ts; store-adapters.ts reshapes these into the row shapes the
// list/detail mappers already consume, so those mappers stay verbatim.

import type { CareProfile } from "@citrus/shared";

/** The on-device plant record: the plants columns minus user_id (there are no
 * users anymore). care_profile is carried as-is — it is re-validated by
 * parseStoredCareProfile downstream, so a malformed profile is not a malformed
 * plant. */
export interface StoredPlant {
  id: string;
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  location: string | null;
  zip_code: string | null;
  cover_assessment_id: string | null;
  care_profile: CareProfile | null;
  created_at: string;
}

/** plantId → plant. */
export type PlantStore = Record<string, StoredPlant>;

export const PLANT_STORAGE_KEY = "citrus.plants.v1";

export function upsertPlant(store: PlantStore, plant: StoredPlant): PlantStore {
  return { ...store, [plant.id]: plant };
}

export function removePlant(store: PlantStore, plantId: string): PlantStore {
  const next: PlantStore = {};
  for (const [id, plant] of Object.entries(store)) {
    if (id !== plantId) next[id] = plant;
  }
  return next;
}

export function getPlant(store: PlantStore, plantId: string): StoredPlant | null {
  return store[plantId] ?? null;
}

/** Plants newest-first — the order fetchPlants used to get from Postgres. */
export function allPlants(store: PlantStore): StoredPlant[] {
  return Object.values(store).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** care_profile is intentionally NOT validated here (it degrades to null in the
 * mapper): a bad profile must not discard an otherwise-valid plant. */
function isValidStoredPlant(value: unknown): value is StoredPlant {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.plant_type === "string" &&
    typeof p.created_at === "string" &&
    (p.species === null || typeof p.species === "string") &&
    (p.cultivar === null || typeof p.cultivar === "string") &&
    (p.location === null || typeof p.location === "string") &&
    (p.zip_code === null || typeof p.zip_code === "string") &&
    (p.cover_assessment_id === null || typeof p.cover_assessment_id === "string")
  );
}

/** Parse the stored blob. Untrusted: malformed JSON or malformed plants degrade
 * (dropped / empty store), never throw. */
export function parsePlantStore(json: string | null): PlantStore {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const store: PlantStore = {};
  for (const [id, plant] of Object.entries(raw)) {
    if (isValidStoredPlant(plant)) store[id] = plant;
  }
  return store;
}

export function serializePlantStore(store: PlantStore): string {
  return JSON.stringify(store);
}
