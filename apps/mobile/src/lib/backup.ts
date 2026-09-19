// D-17: manual export/import — the only backup now that nothing is synced. Pure
// half: build a document from the on-device stores, and parse an untrusted
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
import { parseChatStore, serializeChatStore, type ChatStore } from "./chat-store";
import { isSafeBasename, isSafeRecordId, newestFirst } from "./local-id";
import { parsePhotoIndex, serializePhotoIndex, type PhotoIndex } from "./photo-store";
import { parsePlantStore, serializePlantStore, type PlantStore } from "./plant-store";
import { parseWateringLog, serializeWateringLog, type WateringLog } from "./watering";

export const BACKUP_APP_TAG = "citrus-care";
export const BACKUP_VERSION = 3;

export interface BackupStores {
  plants: PlantStore;
  assessments: AssessmentStore;
  wateringLog: WateringLog;
  photoIndex: PhotoIndex;
  /** v3 (F38) — the per-plant conversations. Pruning plans are deliberately
   * NOT here: a plan IS its annotated photo, and the photo carrier below is
   * keyed to assessment ids, so a restored plan would open on a dead file. */
  chat: ChatStore;
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

/** D-W16: plantId and fileName are joined into a path on restore, and the
 * assessment id keys the index — each must be a value this app could have
 * minted, or the photo is not restored at all. */
function isValidBackupPhoto(value: unknown): value is BackupPhoto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isSafeRecordId(v.assessmentId) &&
    isSafeRecordId(v.plantId) &&
    isSafeBasename(v.fileName) &&
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
      chat: reparse(r.chat, parseChatStore),
    },
    photos: Array.isArray(r.photos) ? r.photos.filter(isValidBackupPhoto) : [],
  };
}

// ---- Photo carrier budget (D-W11) ----

/** A photo the export could carry: its index entry plus the file's size when
 * the io could read it (null → estimated). */
export interface BackupPhotoCandidate {
  assessmentId: string;
  plantId: string;
  localUri: string;
  createdAt: string;
  bytes: number | null;
}

/** Export base64-encodes every carried photo into ONE in-memory string, so the
 * carrier is capped: a walk season of photos would otherwise fail to build. */
export const BACKUP_PHOTO_CAP_BYTES = 120 * 1024 * 1024;
/** Stand-in size for a file the io could not measure (a 1600 px JPEG). */
export const BACKUP_PHOTO_BYTES_ESTIMATE = 700 * 1024;

/** The photos an export carries: newest first while they fit under the cap.
 * A newest-first PREFIX (stop at the first that would not fit) rather than a
 * best-fit, so "Backup includes N of M photos" means "your N most recent". The
 * newest photo is always carried, however large. `total` is the M. */
export function selectBackupPhotos(
  candidates: BackupPhotoCandidate[],
  capBytes: number = BACKUP_PHOTO_CAP_BYTES,
): { selected: BackupPhotoCandidate[]; total: number } {
  const ordered = [...candidates].sort((a, b) =>
    newestFirst(a.createdAt, a.assessmentId, b.createdAt, b.assessmentId),
  );
  const selected: BackupPhotoCandidate[] = [];
  let running = 0;
  for (const candidate of ordered) {
    const size = candidate.bytes ?? BACKUP_PHOTO_BYTES_ESTIMATE;
    if (selected.length > 0 && running + size > capBytes) break;
    selected.push(candidate);
    running += size;
  }
  return { selected, total: candidates.length };
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
      // Per-PLANT arrays, so the collision unit is the whole conversation:
      // a phone that has talked about this plant keeps what it has.
      chat: { ...incoming.chat, ...current.chat },
    },
    added: {
      plants: countNew(current.plants, incoming.plants),
      assessments: countNew(current.assessments, incoming.assessments),
    },
  };
}

// Re-exported so backup-io can serialize each store the same way the document
// does, without importing four modules.
export {
  serializeAssessmentStore,
  serializeChatStore,
  serializePhotoIndex,
  serializePlantStore,
  serializeWateringLog,
};
