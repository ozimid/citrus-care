// D-17 backup, IO half: write the export document to a cache file and open the
// share sheet; pick a file and merge it back. Thin (untested by policy) around
// the pure build/parse/merge in backup.ts.
//
// v3 (F38): the per-plant conversations travel too — plain text, no photos.
// v2 (F29): photos travel inside the document as base64. Export reads each
// indexed JPEG; import writes them back under this phone's documents dir and
// rewrites the index entries with the NEW local uris (the exporting phone's
// absolute paths would be dead here). Missing/unreadable photos are skipped —
// a backup with fewer pictures beats a failed backup.
// F39 (D-W11): the carried photos are CAPPED by bytes, newest first
// (selectBackupPhotos) — a garden walk multiplies the photo count ~10× and the
// whole document is one in-memory string. The outcome says "N of M" so the
// Profile card can be honest about it. Restore keeps a photo's original
// createdAt; export's reads and restore's writes both go only through the
// guarded plantPhotoDir (D-W16) — a stored uri is never trusted as a path.

import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { loadAssessmentStore, saveAssessmentStore } from "./assessment-store-io";
import { isSafeBasename } from "./local-id";
import { loadChatStore, saveChatStore } from "./plant-chat-io";
import {
  base64ToBytes,
  buildBackup,
  mergeBackup,
  parseBackup,
  selectBackupPhotos,
  serializeBackup,
  type BackupPhoto,
  type BackupPhotoCandidate,
  type BackupStores,
} from "./backup";
import type { PhotoIndex, PhotoIndexEntry } from "./photo-store";
import { loadPhotoIndex, plantPhotoDir, replacePhotoIndex } from "./photo-store-io";
import { loadPlantStore, savePlantStore } from "./plant-store-io";
import { getWateringLog, saveWateringLog } from "./watering-io";

export const BACKUP_IMPORT_INVALID = "That file isn't a Citrus Care backup.";

async function currentStores(): Promise<BackupStores> {
  const [plants, assessments, wateringLog, photoIndex, chat] = await Promise.all([
    loadPlantStore(),
    loadAssessmentStore(),
    getWateringLog(),
    loadPhotoIndex(),
    loadChatStore(),
  ]);
  return { plants, assessments, wateringLog, photoIndex, chat };
}

/** On-disk size, or null when the platform won't say (the selector then
 * counts the photo at its estimate). */
function fileBytes(file: File): number | null {
  try {
    const size = file.size;
    return typeof size === "number" && size > 0 ? size : null;
  } catch {
    return null;
  }
}

interface CollectedPhotos {
  /** The photos carried in the document (`photos.length` is the N of "N of M"). */
  photos: BackupPhoto[];
  /** Indexed photos that exist on this phone (the M). */
  total: number;
}

/** Pick the newest photos that fit the byte cap, then read ONLY those as
 * base64. The index entry's uri is never opened as-is (D-W16): the file is
 * re-derived from plantPhotoDir(plantId) + a photoFileName-shaped basename, so
 * an entry that arrived via a crafted backup can name nothing outside the
 * photos tree. Unreadable files are skipped (logged) rather than failing the
 * whole export. */
async function collectPhotos(index: PhotoIndex): Promise<CollectedPhotos> {
  const candidates: BackupPhotoCandidate[] = [];
  const files = new Map<string, { file: File; fileName: string }>();
  for (const [assessmentId, entry] of Object.entries(index)) {
    try {
      const fileName = entry.localUri.split("/").pop();
      if (!isSafeBasename(fileName)) {
        console.error("[backup] photo skipped, unexpected file name for:", assessmentId);
        continue;
      }
      const file = new File(plantPhotoDir(entry.plantId), fileName);
      if (!file.exists) continue;
      files.set(assessmentId, { file, fileName });
      candidates.push({
        assessmentId,
        plantId: entry.plantId,
        localUri: file.uri,
        createdAt: entry.createdAt,
        bytes: fileBytes(file),
      });
    } catch (e) {
      console.error("[backup] photo stat skipped:", (e as Error).message);
    }
  }
  const { selected, total } = selectBackupPhotos(candidates);
  const photos: BackupPhoto[] = [];
  for (const candidate of selected) {
    const found = files.get(candidate.assessmentId);
    if (!found) continue;
    try {
      photos.push({
        assessmentId: candidate.assessmentId,
        plantId: candidate.plantId,
        fileName: found.fileName,
        base64: await found.file.base64(),
      });
    } catch (e) {
      console.error("[backup] photo read skipped:", (e as Error).message);
    }
  }
  return { photos, total };
}

export interface ExportOutcome {
  /** False when the platform has no share target — nothing left the app; the
   * document still sits in the app cache. */
  shared: boolean;
  /** Photos carried vs photos on the phone — equal unless the cap bit. */
  included: number;
  total: number;
}

/** Write a backup JSON to the cache dir and open the share sheet so the user
 * can save it wherever they keep files. */
export async function exportBackup(now: Date = new Date()): Promise<ExportOutcome> {
  const stores = await currentStores();
  const { photos, total } = await collectPhotos(stores.photoIndex);
  const included = photos.length;
  const doc = buildBackup(stores, now.toISOString(), photos);
  const file = new File(Paths.cache, `citrus-care-backup-${now.toISOString().slice(0, 10)}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(serializeBackup(doc));

  if (!(await Sharing.isAvailableAsync())) {
    return { shared: false, included, total };
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: "Save your Citrus Care backup",
  });
  return { shared: true, included, total };
}

/** Restore carried photos onto THIS phone: write the binary back under
 * documents/photos/{plantId}/ and return corrected index entries pointing at
 * the new uris. Existing local files/entries are never overwritten. The
 * incoming index entry's createdAt is kept (it dates the photo, not the
 * import); a plantId that fails the directory guard is skipped, logged. */
function restorePhotos(
  photos: BackupPhoto[],
  currentIndex: PhotoIndex,
  incomingIndex: PhotoIndex,
): PhotoIndex {
  const restored: PhotoIndex = {};
  for (const photo of photos) {
    if (photo.assessmentId in currentIndex) continue;
    try {
      const dir = plantPhotoDir(photo.plantId);
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
        createdAt: incomingIndex[photo.assessmentId]?.createdAt ?? new Date().toISOString(),
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
  const restoredIndex = restorePhotos(
    incoming.photos,
    current.photoIndex,
    incoming.stores.photoIndex,
  );
  await Promise.all([
    savePlantStore(merged.plants),
    saveAssessmentStore(merged.assessments),
    saveWateringLog(merged.wateringLog),
    replacePhotoIndex({ ...merged.photoIndex, ...restoredIndex }),
    saveChatStore(merged.chat),
  ]);
  return added;
}
