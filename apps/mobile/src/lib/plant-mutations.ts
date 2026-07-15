// Edit + delete plant flows. Pure/tested: update payload building, the
// delete sequencing (best-effort local photo cleanup, then the RLS-scoped
// row delete), and generic error mapping. D-16: photos live only on the
// phone, so plant delete clears the local photo store — no API photo call.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewPlantInput } from "@citrus/shared";

export const GENERIC_UPDATE_PLANT_ERROR = "Could not save the changes. Please try again.";
export const GENERIC_DELETE_PLANT_ERROR = "Could not delete the plant. Please try again.";

/** Mirrors the web updatePlant field mapping: null for every absent optional,
 * and never touches user_id (RLS scopes the update). */
export function buildPlantUpdateRow(data: NewPlantInput) {
  return {
    name: data.name,
    plant_type: data.plant_type,
    species: data.species ?? null,
    cultivar: data.cultivar ?? null,
    location: data.location ?? null,
    zip_code: data.zip_code ?? null,
  };
}

export async function updatePlant(
  client: SupabaseClient,
  plantId: string,
  data: NewPlantInput,
): Promise<void> {
  const { error } = await client.from("plants").update(buildPlantUpdateRow(data)).eq("id", plantId);
  if (error) {
    console.error("[updatePlant] update failed:", error.message);
    throw new Error(GENERIC_UPDATE_PLANT_ERROR);
  }
}

export interface DeletePlantDeps {
  client: SupabaseClient;
  /** Removes the plant's on-phone photos + index entries
   * (photo-store-io deleteLocalPlantPhotos). */
  deleteLocalPhotos: (plantId: string) => Promise<void>;
}

/** Local photo cleanup first (best-effort — never blocks the delete),
 * then the plants row; assessments cascade server-side. */
export async function deletePlantWithPhotos(
  deps: DeletePlantDeps,
  plantId: string,
): Promise<void> {
  try {
    await deps.deleteLocalPhotos(plantId);
  } catch (e) {
    console.error("[deletePlantWithPhotos] local photo cleanup failed:", (e as Error).message);
  }

  const { error } = await deps.client.from("plants").delete().eq("id", plantId);
  if (error) {
    console.error("[deletePlantWithPhotos] row delete failed:", error.message);
    throw new Error(GENERIC_DELETE_PLANT_ERROR);
  }
}
