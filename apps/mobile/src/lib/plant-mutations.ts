// Edit-plant payload building (pure/tested). D-17: the update write and the
// delete cascade are thin AsyncStorage orchestration in plants-io.ts; this
// module only maps a validated form to the fields an update touches.

import type { NewPlantInput } from "@citrus/shared";
import { normalizeTag } from "./plant-tags";

export const GENERIC_UPDATE_PLANT_ERROR = "Could not save the changes. Please try again.";
export const GENERIC_DELETE_PLANT_ERROR = "Could not delete the plant. Please try again.";

/** The editable fields of a plant: null for every absent optional. Never
 * touches id / created_at / care_profile / cover — nor codes / tag_photo /
 * tag_missing, which change only from the plant's Tags card (D-W4).
 *
 * F39: `tag` is included only when the input carries the field — normalized
 * when set, null to clear. An input without it leaves the stored tag alone, so
 * a caller editing just the name can never wipe a stake number. */
export function buildPlantUpdateRow(data: NewPlantInput) {
  return {
    name: data.name,
    plant_type: data.plant_type,
    species: data.species ?? null,
    cultivar: data.cultivar ?? null,
    location: data.location ?? null,
    zip_code: data.zip_code ?? null,
    ...(data.tag !== undefined ? { tag: normalizeTag(data.tag) } : {}),
  };
}
