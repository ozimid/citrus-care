// F39 Garden Walk photo queue, IO half (D-W1/D-W2): AsyncStorage + expo-file-
// system wiring around the pure store (photo-queue.ts) and the pure import
// helpers (photo-import.ts). Thin by policy (README testing): every ordering,
// grouping, mark and repair rule is pure and tested there. This file moves
// bytes and persists records, in an order that keeps a record from ever
// naming a file that is not where the record says it is.
//
// A queued file lives in documents/photos/{plantId | _inbox}/{basename}; the
// record stores the basename only and the uri is rebuilt through plantPhotoDir,
// the single guarded directory constructor (D-W16).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import type { ImagePickerAsset } from "expo-image-picker";
import { Image } from "react-native";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { loadAssessmentStore } from "./assessment-store-io";
import { newLocalId } from "./local-id";
import { orderImportedPhotos, takenAtFromAsset } from "./photo-import";
import { downscalePhoto } from "./photo-io";
import {
  assignGroups, assignQueued, IMPORT_BYTES_PER_PHOTO, INBOX_SWEEP_MIN_AGE_MS, markAnalyzing,
  markFailed, markPending, markRejected, parseDurations, parsePhotoQueue, PHOTO_QUEUE_STORAGE_KEY,
  propagateWithinGroup, pushDuration, queuedDirName, reconcileInterrupted, removePlantQueued,
  removeQueued, serializeDurations, serializePhotoQueue, upsertQueued, WALK_DURATIONS_KEY,
  type AssignEvidence, type PhotoQueue, type QueuedPhoto, type QueueRelink,
} from "./photo-queue";
import { PHOTO_INBOX_DIR, photoFileName } from "./photo-store";
import {
  linkPhotoToAssessment,
  loadPhotoIndex,
  moveIntoPhotoDir,
  plantPhotoDir,
} from "./photo-store-io";
import { getPlant } from "./plant-store";
import { loadPlantStore } from "./plant-store-io";

/** User-facing strings: generic and honest. Details go to console.error. */
export const WALK_SAVE_ERROR = "Couldn't save this photo on your phone. Please try again.";
export const ASSIGN_PHOTO_ERROR = "Couldn't move this photo to that plant. Please try again.";
export const REMOVE_PHOTO_ERROR = "Couldn't remove this photo right now. Please try again.";
export const PHOTO_BUSY_ERROR = "This photo is being analyzed — wait for it to finish first.";
export const IMPORT_NO_SPACE_ERROR =
  "Not enough space on this phone for these photos. Free some space and try again.";
export const IMPORT_PARTIAL_ERROR = (n: number) =>
  `Couldn't import ${n} of the photos. The rest are kept.`;

/** Untrusted picker file names are kept for display only (D-W13). */
const MAX_FILE_NAME = 80;

// Process-local guards for the once-per-launch recovery (D-W2): it must never
// reconcile a live run, nor sweep an inbox an enqueue is writing to.
let recovered = false;
let runActive = false;
let enqueueInFlight = 0;

/** WalkRunScreen flips this around a run. */
export function setRunActive(active: boolean): void {
  runActive = active;
}

export function newWalkId(): string {
  return newLocalId(Date.now(), Math.random());
}

/** Reads degrade to an empty queue — a corrupt blob must not wedge a screen. */
export async function loadPhotoQueue(): Promise<PhotoQueue> {
  try {
    return parsePhotoQueue(await AsyncStorage.getItem(PHOTO_QUEUE_STORAGE_KEY));
  } catch (e) {
    console.error("[photo-queue-io] load failed:", (e as Error).message);
    return {};
  }
}

/** Writes throw — a silently unsaved record orphans a photo the user took. */
export async function savePhotoQueue(queue: PhotoQueue): Promise<void> {
  await AsyncStorage.setItem(PHOTO_QUEUE_STORAGE_KEY, serializePhotoQueue(queue));
}

/** Read-modify-write through a pure mutator; resolves to what is stored. A
 * mutator that returns its input unchanged (the pure functions do, when there
 * is nothing to do) writes nothing. */
export async function updateQueue(mutate: (q: PhotoQueue) => PhotoQueue): Promise<PhotoQueue> {
  const current = await loadPhotoQueue();
  const next = mutate(current);
  if (next !== current) await savePhotoQueue(next);
  return next;
}

async function plantExists(plantId: string): Promise<boolean> {
  return getPlant(await loadPlantStore(), plantId) !== null;
}

/** The file's uri, rebuilt from the record — never stored (D-W2). */
export function queuedPhotoUri(item: QueuedPhoto): string {
  return new File(plantPhotoDir(queuedDirName(item)), item.basename).uri;
}

function deleteQuietly(uri: string, what: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (e) {
    console.error(`[photo-queue-io] ${what} cleanup failed:`, (e as Error).message);
  }
}

export interface EnqueueWalkShotArgs {
  sourceUri: string;
  width: number;
  height: number;
  plantId: string | null;
  evidence: AssignEvidence;
  walkId: string;
  source: "camera" | "gallery";
  takenAt: string | null;
  fileName?: string | null;
}

/** Downscale → move into the inbox → move on into the plant directory →
 * record. The record is written only once the file sits where the record
 * says, so a kill leaves at most an orphan file (an inbox one is swept on the
 * next launch), never a record pointing at nothing; if the record cannot be
 * saved the moved file is deleted again. The source (picker copy or camera
 * original) is deleted best-effort once the copy is durable. */
export async function enqueueWalkShot(args: EnqueueWalkShotArgs): Promise<QueuedPhoto> {
  enqueueInFlight += 1;
  try {
    const prepared = await downscalePhoto(args.sourceUri, { width: args.width, height: args.height });
    // A plant deleted since the caller loaded its list must not own a
    // directory nothing sweeps: the photo is kept, unassigned (rung 6).
    const plantId = args.plantId !== null && (await plantExists(args.plantId)) ? args.plantId : null;
    if (plantId !== args.plantId) console.error("[photo-queue-io] plant gone before enqueue; keeping the photo unassigned");
    const id = newLocalId(Date.now(), Math.random());
    const validDims = prepared.width > 0 && prepared.height > 0;
    const item: QueuedPhoto = {
      id,
      walkId: args.walkId,
      groupId: id,
      plantId,
      evidence: plantId === null ? "none" : args.evidence,
      suggestedPlantId: null,
      basename: photoFileName(Date.now(), Math.random()),
      // Unknown dims are flagged and stored as the same placeholder the parse
      // repairs to — never 0 — so the in-memory record matches the stored one.
      width: validDims ? prepared.width : 1,
      height: validDims ? prepared.height : 1,
      ...(validDims ? {} : { needsDims: true as const }),
      takenAt: args.takenAt,
      addedAt: new Date().toISOString(),
      source: args.source,
      codeDigest: null,
      fileName: args.fileName ? args.fileName.slice(0, MAX_FILE_NAME) : null,
      status: "pending",
      startedAt: null,
      runAnchorIso: null,
      attempts: 0,
      error: null,
      timedOut: false,
      rejectedDiagnosis: null,
    };
    let current = prepared.uri;
    try {
      current = await moveIntoPhotoDir(PHOTO_INBOX_DIR, current, item.basename);
      if (plantId !== null) {
        current = await moveIntoPhotoDir(plantId, current, item.basename);
      }
      await updateQueue((q) => upsertQueued(q, item));
    } catch (e) {
      deleteQuietly(current, "unsaved photo");
      throw e;
    }
    deleteQuietly(args.sourceUri, "source photo");
    return item;
  } catch (e) {
    console.error("[photo-queue-io] enqueue failed:", (e as Error).message);
    throw new Error(WALK_SAVE_ERROR);
  } finally {
    enqueueInFlight -= 1;
  }
}

interface StagedAsset {
  uri: string;
  width: number;
  height: number;
  fileName: string | null;
  takenAt: string | null;
}

/** The picker may report 0×0; RN reads the real size from the file. Unknown
 * dims would skip the downscale and keep a full-resolution JPEG, so a photo
 * whose size cannot be read counts as not imported instead. */
async function assetDims(a: StagedAsset): Promise<{ width: number; height: number }> {
  if (a.width > 0 && a.height > 0) return { width: a.width, height: a.height };
  const size = await Image.getSize(a.uri);
  if (!(size.width > 0 && size.height > 0)) throw new Error("image size unreadable");
  return size;
}

/** Multi-select gallery import into one walk. Each photo is enqueued — and so
 * persisted — on its own, in shooting order, so a kill mid-import keeps the
 * ones already done; then the walk is gap-grouped and a group with one decided
 * plant propagates it. Throws IMPORT_NO_SPACE_ERROR up front (free space
 * unknown → don't block); per-photo failures are counted, never thrown. */
export async function importGalleryAssets(
  assets: ImagePickerAsset[],
  /** The screen decides how sure the chip is (D-W3): `user` only when it was
   * set for this import, `carried` when it merely happened to be set. */
  ctx: { walkId: string; seedPlantId: string | null; seedEvidence: AssignEvidence },
  onProgress: (done: number, total: number) => void,
): Promise<{ imported: number; failed: number }> {
  let free: number | null = null;
  try {
    free = Number.isFinite(Paths.availableDiskSpace) ? Paths.availableDiskSpace : null;
  } catch (e) {
    console.error("[photo-queue-io] free space read failed:", (e as Error).message);
  }
  if (free !== null && free < assets.length * IMPORT_BYTES_PER_PHOTO) {
    throw new Error(IMPORT_NO_SPACE_ERROR);
  }
  // D-W13: the EXIF whitelist runs inside takenAtFromAsset here, before the
  // first await; the staged copy carries no raw exif, so GPS and the rest are
  // never read, stored or logged.
  const staged = orderImportedPhotos<StagedAsset>(
    assets.map((a) => ({
      uri: a.uri,
      width: a.width,
      height: a.height,
      fileName: a.fileName ?? null,
      takenAt: takenAtFromAsset({ exif: a.exif, fileName: a.fileName }),
    })),
  );
  let imported = 0;
  let failed = 0;
  onProgress(0, staged.length);
  for (const a of staged) {
    try {
      const dims = await assetDims(a);
      await enqueueWalkShot({
        sourceUri: a.uri,
        ...dims,
        plantId: ctx.seedPlantId,
        evidence: ctx.seedPlantId ? ctx.seedEvidence : "none",
        walkId: ctx.walkId,
        source: "gallery",
        takenAt: a.takenAt,
        fileName: a.fileName,
      });
      imported += 1;
    } catch (e) {
      console.error("[photo-queue-io] one photo not imported:", (e as Error).message);
      failed += 1;
      // The picker's full-resolution copy (EXIF intact) must not linger in
      // cache; a retry re-picks and gets a fresh one.
      deleteQuietly(a.uri, "picker copy");
    }
    onProgress(imported + failed, staged.length);
  }
  if (imported > 0) {
    await updateQueue((q) => propagateWithinGroup(assignGroups(q, ctx.walkId), ctx.walkId));
  }
  return { imported, failed };
}

/** Move a pending photo to another plant, or back to "needs a plant" (null).
 * The plant must exist on this phone. The file moves first and the record
 * follows; if the record cannot be saved the file is moved back. Refused
 * while the photo is being analyzed — the runner is reading that uri. */
export async function assignQueuedPhoto(
  id: string,
  plantId: string | null,
  evidence: AssignEvidence,
): Promise<void> {
  const item = (await loadPhotoQueue())[id];
  if (item?.status === "analyzing") throw new Error(PHOTO_BUSY_ERROR);
  try {
    if (!item) throw new Error("queued photo not found");
    if (plantId !== null && !getPlant(await loadPlantStore(), plantId)) {
      throw new Error("plant not on this device");
    }
    const from = queuedDirName(item);
    const to = plantId ?? PHOTO_INBOX_DIR;
    let moved = false;
    if (from !== to) {
      // A kill between an earlier move and its record write leaves the file
      // already where it is going: finish the record instead of failing.
      const source = new File(queuedPhotoUri(item));
      const landed = new File(plantPhotoDir(to), item.basename);
      if (source.exists || !landed.exists) {
        await moveIntoPhotoDir(to, source.uri, item.basename);
        moved = true;
      }
    }
    try {
      await updateQueue((q) => assignQueued(q, id, plantId, evidence));
    } catch (e) {
      if (moved) {
        await moveIntoPhotoDir(from, new File(plantPhotoDir(to), item.basename).uri, item.basename).catch(
          (err: Error) => console.error("[photo-queue-io] move-back failed:", err.message),
        );
      }
      throw e;
    }
  } catch (e) {
    console.error("[photo-queue-io] assign failed:", (e as Error).message);
    throw new Error(ASSIGN_PHOTO_ERROR);
  }
}

/** Delete a pending photo and its record. Refused while it is being analyzed.
 * When the photo index already owns the file (its assessment landed but the
 * record outlived it), the file is kept and only the stale record goes; a
 * file that cannot be deleted keeps its record, so nothing is orphaned. */
export async function removeQueuedPhoto(id: string): Promise<void> {
  const item = (await loadPhotoQueue())[id];
  if (!item) return;
  if (item.status === "analyzing") throw new Error(PHOTO_BUSY_ERROR);
  try {
    const uri = queuedPhotoUri(item);
    if (Object.values(await loadPhotoIndex()).some((e) => e.localUri === uri)) {
      console.error("[photo-queue-io] file belongs to an assessment; dropping the record only:", id);
    } else {
      const file = new File(uri);
      if (file.exists) file.delete();
    }
    await updateQueue((q) => removeQueued(q, id));
  } catch (e) {
    console.error("[photo-queue-io] remove failed:", (e as Error).message);
    throw new Error(REMOVE_PHOTO_ERROR);
  }
}

// ---- The run's writes (Phase 2) ----
// Thin wrappers the WalkRunScreen's runner deps call. Each is one
// read-modify-write of the queue through the pure mark; a write failure throws
// and the runner ends the run as "storage-error" (D-W18). A record that is not
// in the loaded queue throws too — loadPhotoQueue degrades an unreadable blob
// to {}, and a silent no-op there would let the model run on a photo whose
// `analyzing` mark never landed (D-W2).

async function markQueued(id: string, change: (q: PhotoQueue) => PhotoQueue): Promise<void> {
  await updateQueue((q) => {
    if (!q[id]) throw new Error(`queued photo not found: ${id}`);
    return change(q);
  });
}

export async function markAnalyzingIo(id: string, nowIso: string, anchorIso: string): Promise<void> {
  await markQueued(id, (q) => markAnalyzing(q, id, nowIso, anchorIso));
}

export async function markRejectedIo(id: string, diagnosis: AssessmentDiagnosis): Promise<void> {
  await markQueued(id, (q) => markRejected(q, id, diagnosis));
}

export async function markFailedIo(id: string, error: string, timedOut: boolean): Promise<void> {
  await markQueued(id, (q) => markFailed(q, id, error, timedOut));
}

/** Back to waiting. `attempts` overrides the kept count: 0 is the user's
 * Retry (D-W2 caps automatic re-runs at three; a deliberate tap starts that
 * count over), the runner's pre-mark count is an attempt the engine never ran. */
export async function markPendingIo(id: string, options?: { attempts?: number }): Promise<void> {
  await markQueued(id, (q) => markPending(q, id, options?.attempts));
}

/** D-W1: the record leaves the store the moment its assessment lands — file
 * ownership passes to the photo index, which the assess flow linked. */
export async function completeQueued(id: string): Promise<void> {
  await updateQueue((q) => removeQueued(q, id));
}

/** D-W8: the ring of the last 30 per-photo durations behind "about N min".
 * Read degrades to empty (no history is a supported state). */
export async function loadDurations(): Promise<number[]> {
  try {
    return parseDurations(await AsyncStorage.getItem(WALK_DURATIONS_KEY));
  } catch (e) {
    console.error("[photo-queue-io] durations load failed:", (e as Error).message);
    return [];
  }
}

export async function recordDuration(ms: number): Promise<void> {
  await AsyncStorage.setItem(WALK_DURATIONS_KEY, serializeDurations(pushDuration(await loadDurations(), ms)));
}

/** Cascade on plant delete: records only — the files die with the plant's
 * directory, which plants-io deletes right after this. */
export async function deletePlantQueuedPhotos(plantId: string): Promise<void> {
  await updateQueue((q) => removePlantQueued(q, plantId));
}

/** Once per process, at app mount (D-W2). A record a kill left `analyzing` is
 * matched against the assessment store: landed → the record goes (and the
 * photo index is relinked if the kill hit between those two writes); not
 * landed → back to pending. Then inbox files no record names, older than the
 * age gate, are swept. Skipped while a run or an enqueue is in flight. */
export async function recoverInterruptedWalk(): Promise<void> {
  if (recovered || runActive || enqueueInFlight > 0) return;
  recovered = true;
  try {
    const [assessments, index] = await Promise.all([loadAssessmentStore(), loadPhotoIndex()]);
    // Inside the read-modify-write, so an enqueue that lands during the loads
    // above is never overwritten; nothing analyzing → nothing written.
    let relink: QueueRelink[] = [];
    const next = await updateQueue((q) => {
      const result = reconcileInterrupted(q, assessments, index);
      relink = result.relink;
      return result.queue;
    });
    for (const link of relink) {
      try {
        const file = new File(plantPhotoDir(link.plantId), link.basename);
        if (!file.exists) {
          console.error("[photo-queue-io] relink skipped, file missing for:", link.assessmentId);
          continue;
        }
        await linkPhotoToAssessment(link.assessmentId, {
          localUri: file.uri,
          plantId: link.plantId,
          engine: "on-device",
          createdAt: assessments[link.assessmentId]?.createdAt ?? new Date().toISOString(),
        });
      } catch (e) {
        console.error("[photo-queue-io] relink failed:", (e as Error).message);
      }
    }
    sweepInboxDir(next);
  } catch (e) {
    console.error("[photo-queue-io] recovery failed:", (e as Error).message);
  }
}

/** Delete inbox files no record names. Age-gated: a file younger than the
 * gate, or of unknown age, may belong to an enqueue racing this sweep. */
function sweepInboxDir(queue: PhotoQueue, now: number = Date.now()): void {
  const dir = plantPhotoDir(PHOTO_INBOX_DIR);
  if (!dir.exists) return;
  const named = new Set(Object.values(queue).map((i) => i.basename));
  for (const entry of dir.list()) {
    if (!(entry instanceof File) || named.has(entry.name)) continue;
    const modified = entry.lastModified;
    if (modified === null || now - modified < INBOX_SWEEP_MIN_AGE_MS) continue;
    try {
      entry.delete();
    } catch (e) {
      console.error("[photo-queue-io] inbox sweep skipped a file:", (e as Error).message);
    }
  }
}
