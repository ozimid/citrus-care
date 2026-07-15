// Edit + delete plant flows. Pure/tested: update payload building, the
// delete sequencing (best-effort photo cleanup via apps/api, then the RLS-
// scoped row delete), and generic error mapping. Mirrors the web server
// actions in apps/web/app/plants/actions.ts (updatePlant / deletePlant).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewPlantInput } from "@citrus/shared";
import type { AuthorizedFetch } from "./api";

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

/** The storage prefix apps/api's DELETE /photos ownership check expects. */
export function photoPrefix(userId: string, plantId: string): string {
  return `${userId}/${plantId}/`;
}

export interface DeletePlantDeps {
  client: SupabaseClient;
  /** Bearer-authenticated fetch to apps/api (api.ts / api-io.ts). */
  api: AuthorizedFetch;
}

/** Photo cleanup first (best-effort — never blocks the delete, web parity),
 * then the plants row; assessments cascade server-side. */
export async function deletePlantWithPhotos(
  deps: DeletePlantDeps,
  plantId: string,
): Promise<void> {
  const {
    data: { user },
  } = await deps.client.auth.getUser();
  if (!user) {
    console.error("[deletePlantWithPhotos] no authenticated user");
    throw new Error(GENERIC_DELETE_PLANT_ERROR);
  }

  try {
    await deps.api(`/photos?prefix=${encodeURIComponent(photoPrefix(user.id, plantId))}`, {
      method: "DELETE",
    });
  } catch (e) {
    console.error("[deletePlantWithPhotos] photo cleanup failed:", (e as Error).message);
  }

  const { error } = await deps.client.from("plants").delete().eq("id", plantId);
  if (error) {
    console.error("[deletePlantWithPhotos] row delete failed:", error.message);
    throw new Error(GENERIC_DELETE_PLANT_ERROR);
  }
}
