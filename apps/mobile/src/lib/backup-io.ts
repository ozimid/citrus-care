// D-17 backup, IO half: write the export document to a cache file and open the
// share sheet; pick a file and merge it back. Thin (untested by policy) around
// the pure build/parse/merge in backup.ts. Photos are NOT copied — only the
// index travels; the JPEG files stay on the phone.

import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { loadAssessmentStore, saveAssessmentStore } from "./assessment-store-io";
import {
  buildBackup,
  mergeBackup,
  parseBackup,
  serializeBackup,
  type BackupStores,
} from "./backup";
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

/** Write a backup JSON to the cache dir and open the share sheet so the user
 * can save it wherever they keep files. Returns false when the platform has no
 * share target (nothing left the app). */
export async function exportBackup(now: Date = new Date()): Promise<boolean> {
  const doc = buildBackup(await currentStores(), now.toISOString());
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

  const { merged, added } = mergeBackup(await currentStores(), incoming);
  await Promise.all([
    savePlantStore(merged.plants),
    saveAssessmentStore(merged.assessments),
    saveWateringLog(merged.wateringLog),
    replacePhotoIndex(merged.photoIndex),
  ]);
  return added;
}
