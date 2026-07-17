// D-17: manual export/import — the only backup now that nothing is synced. Pure
// half: build a document from the four on-device stores, and parse an untrusted
// backup file by REUSING each store's own tolerant parser (malformed entries
// drop, never throw). Merge never overwrites local data — an import can only add
// what the phone doesn't already have. The IO (file write, share sheet,
// document picker) is the thin backup-io.ts.
//
// v2 (F29, user request 2026-07-16): photo BINARIES travel inside the document
// as base64, so a restore on a fresh phone brings the pictures back. v1 files
// (index only) still import fine — photos just aren't in them.

import {
  parseAssessmentStore,
  serializeAssessmentStore,
  type AssessmentStore,
} from "./assessment-store";
import { parsePhotoIndex, serializePhotoIndex, type PhotoIndex } from "./photo-store";
import { parsePlantStore, serializePlantStore, type PlantStore } from "./plant-store";
import { parseWateringLog, serializeWateringLog, type WateringLog } from "./watering";

export const BACKUP_APP_TAG = "citrus-care";
export const BACKUP_VERSION = 2;

export interface BackupStores {
  plants: PlantStore;
  assessments: AssessmentStore;
  wateringLog: WateringLog;
  photoIndex: PhotoIndex;
}

/** One photo, carried inside the document (v2+). */
export interface BackupPhoto {
  assessmentId: string;
  plantId: string;
  fileName: string;
  base64: string;
}

export interface BackupDocument extends BackupStores {
  app: typeof BACKUP_APP_TAG;
  version: number;
  exportedAt: string;
  photos: BackupPhoto[];
}

export interface ParsedBackup {
  stores: BackupStores;
  photos: BackupPhoto[];
}

export function buildBackup(
  stores: BackupStores,
  exportedAt: string,
  photos: BackupPhoto[] = [],
): BackupDocument {
  return { app: BACKUP_APP_TAG, version: BACKUP_VERSION, exportedAt, photos, ...stores };
}

export function serializeBackup(doc: BackupDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Re-run a store parser over an already-parsed sub-object by stringifying it
 * back (the parsers take a JSON string and validate entry-by-entry). */
function reparse<T>(value: unknown, parser: (json: string | null) => T): T {
  return parser(value === undefined ? null : JSON.stringify(value));
}

function isValidBackupPhoto(value: unknown): value is BackupPhoto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.assessmentId === "string" &&
    typeof v.plantId === "string" &&
    typeof v.fileName === "string" &&
    v.fileName.length > 0 &&
    !v.fileName.includes("/") &&
    typeof v.base64 === "string" &&
    v.base64.length > 0
  );
}

/** Parse an untrusted backup file. Null when it isn't a Citrus Care backup;
 * otherwise every section is validated by its store's own parser (and each
 * photo field-by-field), so a corrupt/edited file degrades gracefully rather
 * than throwing. v1 files simply have no photos. */
export function parseBackup(json: string): ParsedBackup | null {
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
    stores: {
      plants: reparse(r.plants, parsePlantStore),
      assessments: reparse(r.assessments, parseAssessmentStore),
      wateringLog: reparse(r.wateringLog, parseWateringLog),
      photoIndex: reparse(r.photoIndex, parsePhotoIndex),
    },
    photos: Array.isArray(r.photos) ? r.photos.filter(isValidBackupPhoto) : [],
  };
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 → bytes without atob (not guaranteed on every RN runtime). Tolerates
 * missing padding; used to write restored photos back as binary files. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[=\s]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let i = 0;
  for (const ch of clean) {
    const value = B64_ALPHABET.indexOf(ch);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[i++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, i);
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
