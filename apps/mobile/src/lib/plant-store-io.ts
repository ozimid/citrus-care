// Local-first plant store, IO half (D-17): thin AsyncStorage wiring around the
// pure logic in plant-store.ts. Untested by design (README testing policy) —
// the store/parse logic is pure and tested in plant-store.test.ts. One JSON
// blob, whole-store read/write, read-modify-write through the pure functions.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CareProfile } from "@citrus/shared";
import { isSafeBasename } from "./local-id";
import {
  PLANT_STORAGE_KEY,
  addPlantCode,
  getPlant,
  parsePlantStore,
  removePlant,
  removePlantCode,
  serializePlantStore,
  upsertPlant,
  type PlantStore,
  type StoredPlant,
} from "./plant-store";
import { MAX_CODES_PER_PLANT, isCodeDigest, normalizeTag } from "./plant-tags";

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

/** Set a single field on one plant (no-op if the plant is gone). */
async function patchPlant(plantId: string, patch: Partial<StoredPlant>): Promise<void> {
  const store = await loadPlantStore();
  const plant = getPlant(store, plantId);
  if (!plant) return;
  await savePlantStore(upsertPlant(store, { ...plant, ...patch }));
}

/** F20: store the (locally generated) care profile on the plant. */
export async function setPlantCareProfile(plantId: string, careProfile: CareProfile): Promise<void> {
  await patchPlant(plantId, { care_profile: careProfile });
}

/** Point the plant's cover thumbnail at its newest assessment (best-effort). */
export async function setPlantCover(plantId: string, assessmentId: string): Promise<void> {
  await patchPlant(plantId, { cover_assessment_id: assessmentId });
}

// F39 (D-W4): the two identifiers on the plant record. A code is stored ONLY
// as the SHA-256 digest of its normalized payload — the payload itself never
// reaches this module — and moves between plants only from the owning
// plant's Tags card (never from the viewfinder, which switches instead).
// The cap / dedupe / filter logic is the tested pure half (addPlantCode /
// removePlantCode); this file only reads, calls it, and writes.

/** Written for the user (shown verbatim, like IMPORT_NO_SPACE_ERROR). */
export const PLANT_CODE_LIMIT_ERROR = `This plant already has ${MAX_CODES_PER_PLANT} codes — remove one on its Tags card first.`;
export const PLANT_TAG_INVALID_ERROR = "Use letters, numbers, spaces and . _ # - only, up to 24 characters.";

function assertDigest(digest: string): void {
  // The parser would drop a malformed entry on the next read; refusing here
  // keeps the UI from ever saying "bound" about something that was not.
  if (!isCodeDigest(digest)) throw new Error("invalid code digest");
}

/** addPlantCode returns the same reference when nothing was written: fine
 * when the digest is already there (idempotent), a refusal (user-facing
 * message) when the plant is at its cap. */
function withCode(plant: StoredPlant, digest: string): StoredPlant {
  const next = addPlantCode(plant, digest);
  if (next === plant && !(plant.codes ?? []).includes(digest)) throw new Error(PLANT_CODE_LIMIT_ERROR);
  return next;
}

/** Bind a scanned code (its digest) to a plant. Idempotent. Throws when the
 * plant is gone — a silent no-op would let the screen announce a binding
 * that does not exist. */
export async function bindPlantCode(plantId: string, digest: string): Promise<void> {
  assertDigest(digest);
  const store = await loadPlantStore();
  const plant = getPlant(store, plantId);
  if (!plant) throw new Error("plant not found");
  await savePlantStore(upsertPlant(store, withCode(plant, digest)));
}

export async function unbindPlantCode(plantId: string, digest: string): Promise<void> {
  const store = await loadPlantStore();
  const plant = getPlant(store, plantId);
  if (!plant) return;
  const next = removePlantCode(plant, digest);
  if ((next.codes ?? []).length === (plant.codes ?? []).length) return;
  await savePlantStore(upsertPlant(store, next));
}

/** Rebind — from the owning plant's Tags card only. One read-modify-write, so
 * a kill between the two halves can never leave the code on both plants or
 * on neither. The destination's cap is checked before anything changes. */
export async function movePlantCode(fromPlantId: string, toPlantId: string, digest: string): Promise<void> {
  assertDigest(digest);
  if (fromPlantId === toPlantId) return;
  const store = await loadPlantStore();
  const to = getPlant(store, toPlantId);
  if (!to) throw new Error("plant not found");
  let next = upsertPlant(store, withCode(to, digest));
  const from = getPlant(store, fromPlantId);
  if (from) next = upsertPlant(next, removePlantCode(from, digest));
  await savePlantStore(next);
}

/** The human tag ("7", "L-3"). Normalized here as well as in the form, so a
 * caller can never store what the parser would repair away. */
export async function setPlantTag(plantId: string, tag: string | null): Promise<void> {
  const normalized = tag === null ? null : normalizeTag(tag);
  if (tag !== null && normalized === null) throw new Error(PLANT_TAG_INVALID_ERROR);
  await patchPlant(plantId, { tag: normalized });
}

/** The photo of this plant's physical tag — a basename inside the plant's own
 * photo directory (D-W16), never a uri. */
export async function setPlantTagPhoto(plantId: string, basename: string | null): Promise<void> {
  if (basename !== null && !isSafeBasename(basename)) throw new Error("invalid photo file name");
  await patchPlant(plantId, { tag_photo: basename });
}

/** "Tag missing" — the stake fell off; shown on the card and in the picker
 * until the plant is re-tagged. */
export async function setPlantTagMissing(plantId: string, missing: boolean): Promise<void> {
  await patchPlant(plantId, { tag_missing: missing });
}
