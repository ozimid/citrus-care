// Local-first photo store, IO half (D-16): thin expo-file-system +
// AsyncStorage wiring around the pure logic in photo-store.ts. Untested by
// design — README testing policy: expo modules are exercised via `expo export`
// bundling, the mapping logic via photo-store.test.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { isSafeRecordId } from "./local-id";
import {
  parsePhotoIndex,
  PHOTO_INBOX_DIR,
  PHOTO_INDEX_STORAGE_KEY,
  PHOTOS_DIR,
  photoFileName,
  removePlantPhotos,
  serializePhotoIndex,
  upsertPhoto,
  type PhotoIndex,
  type PhotoIndexEntry,
} from "./photo-store";

/** The ONE constructor of a photo directory (D-W16): documents/photos/{name}.
 * `dirName` is a plant id or the walk inbox — anything else (`..`, a slash, a
 * string that merely looks like an id) throws before it can name a path, so a
 * crafted backup or a corrupt store can never point copy()/delete() outside
 * the photos tree. Every file primitive that takes a plant id routes here. */
export function plantPhotoDir(dirName: string): Directory {
  if (dirName !== PHOTO_INBOX_DIR && !isSafeRecordId(dirName)) {
    throw new Error("invalid photo directory");
  }
  return new Directory(Paths.document, PHOTOS_DIR, dirName);
}

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
  const dir = plantPhotoDir(plantId);
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
  const dir = plantPhotoDir(plantId);
  if (dir.exists) dir.delete();
  const index = await loadPhotoIndex();
  await savePhotoIndex(removePlantPhotos(index, plantId));
}

/** Total bytes of all locally stored plant photos (settings/debug display). */
export function totalPhotoUsageBytes(): number {
  const dir = new Directory(Paths.document, PHOTOS_DIR);
  return dir.exists ? (dir.size ?? 0) : 0;
}
