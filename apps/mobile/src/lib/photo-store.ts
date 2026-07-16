// Local-first photo store, pure half (D-16): photos live ONLY on the phone,
// under documents/photos/{plantId}/, and an AsyncStorage JSON index maps
// assessmentId → { localUri, plantId, engine, createdAt } so timelines can
// join synced assessments to their on-device photos. All mapping logic here
// is pure and tested; the filesystem/AsyncStorage wiring is the thin
// photo-store-io.ts (same split as photo.ts vs photo-io.ts).

/** Which engine produced the diagnosis. Since D-17 only "on-device" (Gemma 4
 * E2B) is ever written — "gemini" stays in the union so index entries recorded
 * before the pivot still parse instead of being dropped by the sanitizer. */
export type AssessEngine = "gemini" | "on-device";

export interface PhotoIndexEntry {
  /** Durable file uri under the app documents directory. */
  localUri: string;
  plantId: string;
  engine: AssessEngine;
  /** ISO timestamp of the local save. */
  createdAt: string;
}

/** assessmentId → entry. */
export type PhotoIndex = Record<string, PhotoIndexEntry>;

export const PHOTO_INDEX_STORAGE_KEY = "citrus.photo-index.v1";

/** Documents subdirectory that holds all plant photos. */
export const PHOTOS_DIR = "photos";

export function upsertPhoto(
  index: PhotoIndex,
  assessmentId: string,
  entry: PhotoIndexEntry,
): PhotoIndex {
  return { ...index, [assessmentId]: entry };
}

/** Drop every index entry belonging to a plant (cascade on plant delete). */
export function removePlantPhotos(index: PhotoIndex, plantId: string): PhotoIndex {
  const next: PhotoIndex = {};
  for (const [assessmentId, entry] of Object.entries(index)) {
    if (entry.plantId !== plantId) next[assessmentId] = entry;
  }
  return next;
}

export function photoForAssessment(
  index: PhotoIndex,
  assessmentId: string,
): PhotoIndexEntry | null {
  return index[assessmentId] ?? null;
}

export function photosForPlant(index: PhotoIndex, plantId: string): PhotoIndexEntry[] {
  return Object.values(index).filter((entry) => entry.plantId === plantId);
}

function isValidEntry(value: unknown): value is PhotoIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.localUri === "string" &&
    typeof e.plantId === "string" &&
    (e.engine === "gemini" || e.engine === "on-device") &&
    typeof e.createdAt === "string"
  );
}

/** Parse the stored index JSON. Stored data is untrusted: malformed JSON or
 * malformed entries degrade to "no local photo" (placeholder), never throw. */
export function parsePhotoIndex(json: string | null): PhotoIndex {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const index: PhotoIndex = {};
  for (const [assessmentId, entry] of Object.entries(raw)) {
    if (isValidEntry(entry)) index[assessmentId] = entry;
  }
  return index;
}

export function serializePhotoIndex(index: PhotoIndex): string {
  return JSON.stringify(index);
}

/** Collision-resistant jpg filename from a timestamp + a [0,1) random value —
 * deterministic for tests, no crypto/uuid dependency needed. */
export function photoFileName(nowMs: number, random: number): string {
  const time = nowMs.toString(36);
  const rand = Math.floor(random * 36 ** 8)
    .toString(36)
    .padStart(8, "0");
  return `${time}-${rand}.jpg`;
}
