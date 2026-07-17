// D-17 backup, IO half: write the export document to a cache file and open the
// share sheet; pick a file and merge it back. Thin (untested by policy) around
// the pure build/parse/merge in backup.ts.
//
// v2 (F29): photos travel inside the document as base64. Export reads each
// indexed JPEG; import writes them back under this phone's documents dir and
// rewrites the index entries with the NEW local uris (the exporting phone's
// absolute paths would be dead here). Missing/unreadable photos are skipped —
// a backup with fewer pictures beats a failed backup.

import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { loadAssessmentStore, saveAssessmentStore } from "./assessment-store-io";
import {
  base64ToBytes,
  buildBackup,
  mergeBackup,
  parseBackup,
  serializeBackup,
  type BackupPhoto,
  type BackupStores,
} from "./backup";
import { PHOTOS_DIR, type PhotoIndex, type PhotoIndexEntry } from "./photo-store";
import { loadPhotoIndex, replacePhotoIndex } from "./photo-store-io";
import { loadPlantStore, savePlantStore } from "./plant-store-io";
import { getWateringLog, saveWateringLog } from "./watering-io";

export const BACKUP_IMPORT_INVALID = "That file isn't a Citrus Care backup.";

async function currentStores(): Promise<BackupStores> {
  const [plants, assessments, wateringLog, photoIndex] = await Promise.all([
    loadPlantStore(),
    loadAssessmentStore(),
    getWateringLog(),
    loadPhotoIndex(),
  ]);
  return { plants, assessments, wateringLog, photoIndex };
}

/** Read every indexed photo as base64 for the document. Unreadable files are
 * skipped (logged) rather than failing the whole export. */
async function collectPhotos(index: PhotoIndex): Promise<BackupPhoto[]> {
  const photos: BackupPhoto[] = [];
  for (const [assessmentId, entry] of Object.entries(index)) {
    try {
      const file = new File(entry.localUri);
      if (!file.exists) continue;
      const fileName = entry.localUri.split("/").pop();
      if (!fileName) continue;
      photos.push({ assessmentId, plantId: entry.plantId, fileName, base64: await file.base64() });
    } catch (e) {
      console.error("[backup] photo read skipped:", (e as Error).message);
    }
  }
  return photos;
}

/** Write a backup JSON to the cache dir and open the share sheet so the user
 * can save it wherever they keep files. Returns false when the platform has no
 * share target (nothing left the app). */
export async function exportBackup(now: Date = new Date()): Promise<boolean> {
  const stores = await currentStores();
  const photos = await collectPhotos(stores.photoIndex);
  const doc = buildBackup(stores, now.toISOString(), photos);
  const file = new File(Paths.cache, `citrus-care-backup-${now.toISOString().slice(0, 10)}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(serializeBackup(doc));

  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: "Save your Citrus Care backup",
  });
  return true;
}

/** Restore carried photos onto THIS phone: write the binary back under
 * documents/photos/{plantId}/ and return corrected index entries pointing at
 * the new uris. Existing local files/entries are never overwritten. */
function restorePhotos(photos: BackupPhoto[], currentIndex: PhotoIndex): PhotoIndex {
  const restored: PhotoIndex = {};
  for (const photo of photos) {
    if (photo.assessmentId in currentIndex) continue;
    try {
      const dir = new Directory(Paths.document, PHOTOS_DIR, photo.plantId);
      dir.create({ intermediates: true, idempotent: true });
      const file = new File(dir, photo.fileName);
      if (!file.exists) {
        file.create();
        file.write(base64ToBytes(photo.base64));
      }
      const entry: PhotoIndexEntry = {
        localUri: file.uri,
        plantId: photo.plantId,
        engine: "on-device",
        createdAt: new Date().toISOString(),
      };
      restored[photo.assessmentId] = entry;
    } catch (e) {
      console.error("[backup] photo restore skipped:", (e as Error).message);
    }
  }
  return restored;
}

export interface ImportOutcome {
  plants: number;
  assessments: number;
}

/** Pick a backup file and merge it in — an import only ADDS what the phone
 * doesn't already have (existing entries are kept). Null when the user cancels;
 * throws BACKUP_IMPORT_INVALID for a file that isn't a Citrus Care backup. */
export async function importBackup(): Promise<ImportOutcome | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/json",
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;

  const incoming = parseBackup(await new File(result.assets[0].uri).text());
  if (!incoming) throw new Error(BACKUP_IMPORT_INVALID);

  const current = await currentStores();
  const { merged, added } = mergeBackup(current, incoming.stores);
  // Carried photos land as real files on THIS phone; their fresh index entries
  // override the exporting phone's dead absolute uris that came via the merge.
  const restoredIndex = restorePhotos(incoming.photos, current.photoIndex);
  await Promise.all([
    savePlantStore(merged.plants),
    saveAssessmentStore(merged.assessments),
    saveWateringLog(merged.wateringLog),
    replacePhotoIndex({ ...merged.photoIndex, ...restoredIndex }),
  ]);
  return added;
}
