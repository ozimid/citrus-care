// Edit-plant payload building (pure/tested). D-17: the update write and the
// delete cascade are thin AsyncStorage orchestration in plants-io.ts; this
// module only maps a validated form to the fields an update touches.

import type { NewPlantInput } from "@citrus/shared";

export const GENERIC_UPDATE_PLANT_ERROR = "Could not save the changes. Please try again.";
export const GENERIC_DELETE_PLANT_ERROR = "Could not delete the plant. Please try again.";

/** The editable fields of a plant: null for every absent optional. Never
 * touches id / created_at / care_profile / cover. */
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
