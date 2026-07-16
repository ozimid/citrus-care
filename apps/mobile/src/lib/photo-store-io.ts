// Local-first photo store, IO half (D-16): thin expo-file-system +
// AsyncStorage wiring around the pure logic in photo-store.ts. Untested by
// design — README testing policy: expo modules are exercised via `expo export`
// bundling, the mapping logic via photo-store.test.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import {
  parsePhotoIndex,
  PHOTO_INDEX_STORAGE_KEY,
  PHOTOS_DIR,
  photoFileName,
  removePlantPhotos,
  serializePhotoIndex,
  upsertPhoto,
  type PhotoIndex,
  type PhotoIndexEntry,
} from "./photo-store";

export async function loadPhotoIndex(): Promise<PhotoIndex> {
  return parsePhotoIndex(await AsyncStorage.getItem(PHOTO_INDEX_STORAGE_KEY));
}

async function savePhotoIndex(index: PhotoIndex): Promise<void> {
  await AsyncStorage.setItem(PHOTO_INDEX_STORAGE_KEY, serializePhotoIndex(index));
}

/** Replace the whole photo index (backup import). */
export async function replacePhotoIndex(index: PhotoIndex): Promise<void> {
  await savePhotoIndex(index);
}

/** Copy a (downscaled, temp-cache) JPEG into the durable per-plant photos
 * directory: documents/photos/{plantId}/{name}.jpg. Returns the new uri. */
export async function savePlantPhoto(plantId: string, sourceUri: string): Promise<string> {
  const dir = new Directory(Paths.document, PHOTOS_DIR, plantId);
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, photoFileName(Date.now(), Math.random()));
  await new File(sourceUri).copy(dest);
  return dest.uri;
}

/** Record the local uri ↔ assessment id link after an assessment persists. */
export async function linkPhotoToAssessment(
  assessmentId: string,
  entry: PhotoIndexEntry,
): Promise<void> {
  const index = await loadPhotoIndex();
  await savePhotoIndex(upsertPhoto(index, assessmentId, entry));
}

/** Delete a plant's local photos (files + index entries). Called from the
 * plant-delete flow; best-effort semantics live in the caller. */
export async function deleteLocalPlantPhotos(plantId: string): Promise<void> {
  const dir = new Directory(Paths.document, PHOTOS_DIR, plantId);
  if (dir.exists) dir.delete();
  const index = await loadPhotoIndex();
  await savePhotoIndex(removePlantPhotos(index, plantId));
}

/** Total bytes of all locally stored plant photos (settings/debug display). */
export function totalPhotoUsageBytes(): number {
  const dir = new Directory(Paths.document, PHOTOS_DIR);
  return dir.exists ? (dir.size ?? 0) : 0;
}
