// New-plant form logic: form state → validated payload → local StoredPlant.
// Pure module (no react-native/expo imports) so vitest runs it in Node; the
// sheet UI in src/components/NewPlantSheet.tsx and the AsyncStorage write in
// plants-io.ts stay thin. Validation is the shared newPlantSchema (web parity)
// plus a mobile-side 5-digit ZIP rule. D-17: no user_id — plants live only on
// the phone.

import { PLANT_TYPES, newPlantSchema, type AssessmentDiagnosis, type NewPlantInput } from "@citrus/shared";
import type { StoredPlant } from "./plant-store";
import { TAG_MAX_LENGTH, normalizeTag } from "./plant-tags";

export const GENERIC_CREATE_PLANT_ERROR = "Could not add the plant. Please try again.";
/** F39 D-W4: the human tag is unique across the garden. */
export const TAG_TAKEN_ERROR = "Another plant already has this tag";
export const TAG_FORMAT_ERROR = `Use up to ${TAG_MAX_LENGTH} letters, numbers, spaces or - _ . #`;

export interface NewPlantForm {
  name: string;
  plant_type: string;
  species: string;
  cultivar: string;
  location: string;
  zip_code: string;
  /** F39: the number/label on the physical tag; "" = none. */
  tag: string;
}

export const emptyNewPlantForm: NewPlantForm = {
  name: "",
  plant_type: "tree",
  species: "",
  cultivar: "",
  location: "",
  zip_code: "",
  tag: "",
};

/** Prefill for the edit sheet: DB row (nulls) → form state (empty strings). */
/** F35: draft the new-plant form from the AI's optional plant_guess. The user
 * always confirms — a guess is a starting point, never a decision. Unknown
 * types collapse to "other"; no guess = empty prefill (form opens blank). */
export function prefillFromDiagnosis(diagnosis: AssessmentDiagnosis): Partial<NewPlantForm> {
  const guess = diagnosis.plant_guess;
  if (!guess) return {};
  const prefill: Partial<NewPlantForm> = {};
  if (guess.plant_type) {
    const normalized = guess.plant_type.trim().toLowerCase();
    prefill.plant_type = (PLANT_TYPES as readonly string[]).includes(normalized)
      ? normalized
      : "other";
  }
  if (guess.species) {
    prefill.species = guess.species;
    prefill.name = guess.species;
  }
  return prefill;
}

export function formFromPlant(plant: {
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  location: string | null;
  zip_code: string | null;
  /** Optional so every existing caller compiles; a tagged plant MUST pass it
   * or saving the edit would clear the tag (the whole form is written). */
  tag?: string | null;
}): NewPlantForm {
  return {
    name: plant.name,
    plant_type: plant.plant_type,
    species: plant.species ?? "",
    cultivar: plant.cultivar ?? "",
    location: plant.location ?? "",
    zip_code: plant.zip_code ?? "",
    tag: plant.tag ?? "",
  };
}

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

export interface NewPlantValidationOptions {
  /** Tags held by OTHER plants (any casing — compared after normalizeTag). The
   * caller excludes the plant being edited. */
  takenTags?: Iterable<string>;
}

function isIterable(value: unknown): value is Iterable<string> {
  return typeof value === "object" && value !== null && Symbol.iterator in value;
}

/** `taken` may be the options object or, for the two sheets that only need the
 * uniqueness check, the other plants' tags directly (an array or a Set). */
export function validateNewPlant(
  form: NewPlantForm,
  taken: NewPlantValidationOptions | Iterable<string> = {},
): NewPlantValidation {
  const errors: NewPlantFieldErrors = {};
  const takenTags = isIterable(taken) ? taken : taken.takenTags ?? [];

  // Mobile-only tightening: the shared schema allows any <=10-char string, but
  // the native sheet asks for a US 5-digit ZIP (numeric keyboard, maxLength 5).
  const zip = form.zip_code.trim();
  if (zip.length > 0 && !/^\d{5}$/.test(zip)) {
    errors.zip_code = "Enter a 5-digit ZIP code";
  }

  // F39 D-W4: whitelisted, ≤ 24, unique. Normalized here so the stored form
  // ("L3") is what the picker grid and the walk chip compare against.
  let tag: string | null = null;
  if (form.tag.trim().length > 0) {
    tag = normalizeTag(form.tag);
    if (tag === null) {
      errors.tag = TAG_FORMAT_ERROR;
    } else {
      const takenNormalized = new Set(Array.from(takenTags, (t) => normalizeTag(t)));
      if (takenNormalized.has(tag)) errors.tag = TAG_TAKEN_ERROR;
    }
  }

  const parsed = newPlantSchema.safeParse({
    name: form.name,
    plant_type: form.plant_type,
    species: form.species,
    cultivar: form.cultivar,
    location: form.location,
    zip_code: form.zip_code,
    tag: form.tag,
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
  return { ok: true, data: { ...parsed.data, tag } };
}

/** Validated form input → a new on-device plant record. No user_id (no
 * accounts), care_profile null until it is generated on-device (F20), cover
 * null until the first assessment. id + createdAt are injected so this stays
 * pure/testable; the IO caller mints them. */
export function buildStoredPlant(data: NewPlantInput, id: string, createdAt: string): StoredPlant {
  return {
    id,
    name: data.name,
    plant_type: data.plant_type,
    species: data.species ?? null,
    cultivar: data.cultivar ?? null,
    location: data.location ?? null,
    zip_code: data.zip_code ?? null,
    cover_assessment_id: null,
    care_profile: null,
    created_at: createdAt,
    // F39: the tag is normalized (idempotent after validateNewPlant); codes
    // start empty — a sticker is bound by scanning, never typed.
    tag: normalizeTag(data.tag) ?? null,
    codes: [],
  };
}
