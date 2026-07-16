// D-17: manual export/import — the only backup now that nothing is synced. Pure
// half: build a document from the four on-device stores, and parse an untrusted
// backup file by REUSING each store's own tolerant parser (malformed entries
// drop, never throw). Merge never overwrites local data — an import can only add
// what the phone doesn't already have. The IO (file write, share sheet,
// document picker) is the thin backup-io.ts. Photo BINARIES are not in the
// document (they stay as files on the phone); only the index is carried.

import {
  parseAssessmentStore,
  serializeAssessmentStore,
  type AssessmentStore,
} from "./assessment-store";
import { parsePhotoIndex, serializePhotoIndex, type PhotoIndex } from "./photo-store";
import { parsePlantStore, serializePlantStore, type PlantStore } from "./plant-store";
import { parseWateringLog, serializeWateringLog, type WateringLog } from "./watering";

export const BACKUP_APP_TAG = "citrus-care";
export const BACKUP_VERSION = 1;

export interface BackupStores {
  plants: PlantStore;
  assessments: AssessmentStore;
  wateringLog: WateringLog;
  photoIndex: PhotoIndex;
}

export interface BackupDocument extends BackupStores {
  app: typeof BACKUP_APP_TAG;
  version: number;
  exportedAt: string;
}

export function buildBackup(stores: BackupStores, exportedAt: string): BackupDocument {
  return { app: BACKUP_APP_TAG, version: BACKUP_VERSION, exportedAt, ...stores };
}

export function serializeBackup(doc: BackupDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Re-run a store parser over an already-parsed sub-object by stringifying it
 * back (the parsers take a JSON string and validate entry-by-entry). */
function reparse<T>(value: unknown, parser: (json: string | null) => T): T {
  return parser(value === undefined ? null : JSON.stringify(value));
}

/** Parse an untrusted backup file. Null when it isn't a Citrus Care backup;
 * otherwise every section is validated by its store's own parser, so a
 * corrupt/edited file degrades gracefully rather than throwing. */
export function parseBackup(json: string): BackupStores | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.app !== BACKUP_APP_TAG) return null;
  return {
    plants: reparse(r.plants, parsePlantStore),
    assessments: reparse(r.assessments, parseAssessmentStore),
    wateringLog: reparse(r.wateringLog, parseWateringLog),
    photoIndex: reparse(r.photoIndex, parsePhotoIndex),
  };
}

function countNew(current: Record<string, unknown>, incoming: Record<string, unknown>): number {
  return Object.keys(incoming).filter((id) => !(id in current)).length;
}

export interface MergeResult {
  merged: BackupStores;
  added: { plants: number; assessments: number };
}

/** Merge an imported backup into the current stores. On an id collision the
 * EXISTING (local) entry wins — an import adds, it never clobbers a newer local
 * edit. Pure: inputs are not mutated. */
export function mergeBackup(current: BackupStores, incoming: BackupStores): MergeResult {
  return {
    merged: {
      plants: { ...incoming.plants, ...current.plants },
      assessments: { ...incoming.assessments, ...current.assessments },
      wateringLog: { ...incoming.wateringLog, ...current.wateringLog },
      photoIndex: { ...incoming.photoIndex, ...current.photoIndex },
    },
    added: {
      plants: countNew(current.plants, incoming.plants),
      assessments: countNew(current.assessments, incoming.assessments),
    },
  };
}

// Re-exported so backup-io can serialize each store the same way the document
// does, without importing four modules.
export { serializeAssessmentStore, serializePhotoIndex, serializePlantStore, serializeWateringLog };
