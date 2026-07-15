// New-plant form logic: form state → validated insert payload. Pure module
// (no react-native/expo imports) so vitest runs it in Node; the sheet UI in
// src/components/NewPlantSheet.tsx stays thin. Validation is the shared
// newPlantSchema (web parity) plus a mobile-side 5-digit ZIP rule; the insert
// row mirrors the web server action (apps/web/app/plants/actions.ts):
// explicit user_id, nulls for missing optionals, RLS enforces ownership.

import type { SupabaseClient } from "@supabase/supabase-js";
import { newPlantSchema, type NewPlantInput } from "@citrus/shared";

export const GENERIC_CREATE_PLANT_ERROR = "Could not add the plant. Please try again.";

export interface NewPlantForm {
  name: string;
  plant_type: string;
  species: string;
  cultivar: string;
  location: string;
  zip_code: string;
}

export const emptyNewPlantForm: NewPlantForm = {
  name: "",
  plant_type: "tree",
  species: "",
  cultivar: "",
  location: "",
  zip_code: "",
};

/** The web form (apps/web/app/plants/new/new-plant-form.tsx) shows the citrus
 * cultivar select only for plant_type "tree"; every other type gets a free
 * text input. Same gating here. */
export function showsCitrusCultivarPicker(plantType: string): boolean {
  return plantType === "tree";
}

export type NewPlantFieldErrors = Partial<Record<keyof NewPlantForm, string>>;

export type NewPlantValidation =
  | { ok: true; data: NewPlantInput }
  | { ok: false; errors: NewPlantFieldErrors };

export function validateNewPlant(form: NewPlantForm): NewPlantValidation {
  const errors: NewPlantFieldErrors = {};

  // Mobile-only tightening: the shared schema allows any <=10-char string, but
  // the native sheet asks for a US 5-digit ZIP (numeric keyboard, maxLength 5).
  const zip = form.zip_code.trim();
  if (zip.length > 0 && !/^\d{5}$/.test(zip)) {
    errors.zip_code = "Enter a 5-digit ZIP code";
  }

  const parsed = newPlantSchema.safeParse({
    name: form.name,
    plant_type: form.plant_type,
    species: form.species,
    cultivar: form.cultivar,
    location: form.location,
    zip_code: form.zip_code,
  });

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in errors)) {
        errors[field as keyof NewPlantForm] = issue.message;
      }
    }
    if (Object.keys(errors).length === 0) errors.name = "Invalid input";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (!parsed.success) return { ok: false, errors: { name: "Invalid input" } };
  return { ok: true, data: parsed.data };
}

/** Mirrors the web createPlant insert: explicit user_id (RLS also scopes it),
 * null for every absent optional. */
export function buildPlantInsertRow(data: NewPlantInput, userId: string) {
  return {
    user_id: userId,
    name: data.name,
    plant_type: data.plant_type,
    species: data.species ?? null,
    cultivar: data.cultivar ?? null,
    location: data.location ?? null,
    zip_code: data.zip_code ?? null,
  };
}

/** Thin insert wrapper (same pattern as fetchPlants in plants.ts): generic
 * client-facing message, details only in the console. */
export async function insertPlant(client: SupabaseClient, data: NewPlantInput): Promise<void> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    console.error("[insertPlant] no authenticated user");
    throw new Error(GENERIC_CREATE_PLANT_ERROR);
  }
  const { error } = await client.from("plants").insert(buildPlantInsertRow(data, user.id));
  if (error) {
    console.error("[insertPlant] insert failed:", error.message);
    throw new Error(GENERIC_CREATE_PLANT_ERROR);
  }
}
