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
//
// Phase 4 (D-W3 rungs 1c / 3 / 5): a photo that decodes a QR on import is a
// TAG CARD; a photo the user marks is a TREE MARKER; both hand their plant to
// the photos after them (assignByMarkers, pure) and are deleted when the walk
// is analyzed or parked. Every re-assignment that touches more than one record
// — propagation, binding, marking — goes through applyReassignment below,
// which moves the files to match the records, so the invariant above holds
// for a whole walk exactly as it does for one tap. A decoded payload is
// normalized and digested inside classifyScan and never reaches a record, a
// log line or a return value here (D-W13).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import type { ImagePickerAsset } from "expo-image-picker";
import { Image } from "react-native";
import type { AssessmentDiagnosis } from "@citrus/shared";
import { loadAssessmentStore } from "./assessment-store-io";
import { newLocalId } from "./local-id";
import {
  assignByMarkers,
  classifyScan,
  fileTagToken,
  orderImportedPhotos,
  takenAtFromAsset,
  type ImportScan,
} from "./photo-import";
import { downscalePhoto } from "./photo-io";
import {
  assignGroups, assignQueued, byWalkOrder, IMPORT_BYTES_PER_PHOTO, INBOX_SWEEP_MIN_AGE_MS, isDecidingEvidence,
  markAnalyzing, markAsMarker, markFailed, markPending, markRejected, parseDurations, parsePhotoQueue,
  PHOTO_QUEUE_STORAGE_KEY, propagateWithinGroup, pushDuration, queuedDirName, reconcileInterrupted,
  removePlantQueued, removeQueued, serializeDurations, serializePhotoQueue, unmarkMarker, upsertQueued,
  WALK_DURATIONS_KEY,
  type AssignEvidence, type PhotoQueue, type QueuedPhoto, type QueueRelink,
} from "./photo-queue";
import { PHOTO_INBOX_DIR, photoFileName } from "./photo-store";
import {
  linkPhotoToAssessment,
  loadPhotoIndex,
  moveIntoPhotoDir,
  plantPhotoDir,
} from "./photo-store-io";
import { allPlants, getPlant } from "./plant-store";
import { bindPlantCode, loadPlantStore, PLANT_CODE_LIMIT_ERROR } from "./plant-store-io";
import { codeOwners } from "./plant-tags";
import { decodeQrFromPhoto, IMPORT_SCAN_OPTIONS } from "./qr-decode-io";

/** User-facing strings: generic and honest. Details go to console.error. */
export const WALK_SAVE_ERROR = "Couldn't save this photo on your phone. Please try again.";
export const ASSIGN_PHOTO_ERROR = "Couldn't move this photo to that plant. Please try again.";
export const REMOVE_PHOTO_ERROR = "Couldn't remove this photo right now. Please try again.";
export const PHOTO_BUSY_ERROR = "This photo is being analyzed — wait for it to finish first.";
export const IMPORT_NO_SPACE_ERROR =
  "Not enough space on this phone for these photos. Free some space and try again.";
export const IMPORT_PARTIAL_ERROR = (n: number) =>
  `Couldn't import ${n} of the photos. The rest are kept.`;
export const BIND_CODE_ERROR = "Couldn't bind that code right now. Please try again.";

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
  /** The bound code's digest when `evidence` is "code-scan" — provenance for
   * the review, never a payload. Ignored for any other evidence. */
  codeDigest?: string | null;
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
      codeDigest: plantId !== null && args.evidence === "code-scan" ? (args.codeDigest ?? null) : null,
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

/** The import sheet's second line: the current photo is being saved, or the
 * io is looking for a tag code on it (rung 3 — a second or two per photo). */
export type ImportPhase = "saving" | "scanning";

/** What rungs 3 and 5 consult: bound code digests and human tags. */
type IdentityPlant = { id: string; tag?: string | null; codes?: ReadonlyArray<string> | null };

/** Multi-select gallery import into one walk. Each photo is enqueued — and so
 * persisted — on its own, in shooting order, so a kill mid-import keeps the
 * ones already done; then it is looked at for a tag code and a file-name
 * token (rungs 3 and 5, recorded on its own record before the next photo
 * starts); then the walk is marker-propagated and gap-grouped. Throws
 * IMPORT_NO_SPACE_ERROR up front (free space unknown → don't block);
 * per-photo failures are counted, never thrown; a failed propagation is
 * logged — the photos are imported either way, and the review shows what
 * still needs a plant. */
export async function importGalleryAssets(
  assets: ImagePickerAsset[],
  /** The screen decides how sure the chip is (D-W3): `user` only when it was
   * set for this import, `carried` when it merely happened to be set. */
  ctx: { walkId: string; seedPlantId: string | null; seedEvidence: AssignEvidence },
  onProgress: (done: number, total: number, phase: ImportPhase) => void,
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
  // Rungs 3 and 5 read the plants once; one added mid-import is simply not
  // matched — the review offers every plant anyway.
  const plants: IdentityPlant[] = allPlants(await loadPlantStore());
  let imported = 0;
  let failed = 0;
  onProgress(0, staged.length, "saving");
  for (const a of staged) {
    let item: QueuedPhoto;
    try {
      const dims = await assetDims(a);
      item = await enqueueWalkShot({
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
      onProgress(imported + failed, staged.length, "saving");
      continue;
    }
    // The photo is durable; what follows only decides where it belongs. The
    // sheet keeps the same count and changes its second line.
    onProgress(imported + failed - 1, staged.length, "scanning");
    try {
      await applyReassignment(await identifyImported(item, plants));
    } catch (e) {
      console.error("[photo-queue-io] identification skipped for one photo:", (e as Error).message);
    }
    onProgress(imported + failed, staged.length, "saving");
  }
  if (imported > 0) {
    // Rungs 3 → 4 over the whole walk, in ladder order: cards and markers
    // hand their plant forward, then the time-gap groups fill in around them.
    try {
      await applyReassignment((q) =>
        propagateWithinGroup(assignGroups(withMarkersApplied(q, ctx.walkId), ctx.walkId), ctx.walkId),
      );
    } catch (e) {
      console.error("[photo-queue-io] walk propagation failed; photos kept as they are:", (e as Error).message);
    }
  }
  return { imported, failed };
}

/** Rungs 3 and 5 (D-W3) for one photo that is already durable; returns the
 * pure change for its record (applyReassignment then moves the file to
 * match). A QR that decodes on an imported photo is a sticker close-up, so
 * the photo becomes a TAG CARD for the code's one owner — not saved, handing
 * the plant to the photos after it; the review has a toggle back to "Plant
 * photo" — UNLESS the chip already decided this photo (rung 1 outranks rung
 * 3 as it outranks rung 5): a photo the user assigned by hand stays that
 * plant's photo, digest kept for provenance, never turned into a card that
 * is later deleted. A code with no or several owners keeps only its digest,
 * for the review's "Bind to a plant" row. The payload is normalized and
 * digested inside classifyScan and never reaches a record, a log line or
 * this return (D-W13); a decode error is a miss, and the import path tries
 * only the full frame and the centre (IMPORT_SCAN_OPTIONS — most photos of a
 * roll hold no code, and the miss path is what costs). A file-name marker
 * token decides unless the chip already decided; a bare tag suggests, and
 * only where nothing has decided. */
async function identifyImported(
  item: QueuedPhoto,
  plants: ReadonlyArray<IdentityPlant>,
): Promise<(q: PhotoQueue) => PhotoQueue> {
  let scan: ImportScan = null;
  try {
    const payload = await decodeQrFromPhoto(queuedPhotoUri(item), { width: item.width, height: item.height }, IMPORT_SCAN_OPTIONS);
    scan = classifyScan(payload, plants);
  } catch (e) {
    console.error("[photo-queue-io] tag-code decode failed; treating as no code:", (e as Error).message);
  }
  const token = fileTagToken(item.fileName, plants);
  return (q) => {
    const current = q[item.id];
    if (!current || current.isMarker) return q;
    if (scan?.role === "tag-card") {
      if (current.plantId !== null && isDecidingEvidence(current.evidence)) {
        return upsertQueued(q, { ...current, codeDigest: scan.digest });
      }
      const marked = markAsMarker(q, item.id, scan.plantId);
      return upsertQueued(marked, { ...marked[item.id], codeDigest: scan.digest });
    }
    const next = scan === null ? q : upsertQueued(q, { ...current, codeDigest: scan.digest });
    if (token === null) return next;
    const now = next[item.id];
    if (token.decides) {
      return now.plantId !== null && isDecidingEvidence(now.evidence)
        ? next
        : assignQueued(next, item.id, token.plantId, "file-tag");
    }
    return now.plantId === null ? upsertQueued(next, { ...now, suggestedPlantId: token.plantId }) : next;
  };
}

/** Rungs 1c / 3 for one walk: every marker (a decoded tag card, or a photo the
 * user marked) hands its plant to the photos after it in display order, until
 * the next marker or explicit photo — assignByMarkers, pure and tested. */
function withMarkersApplied(q: PhotoQueue, walkId: string): PhotoQueue {
  const walk = Object.values(q)
    .filter((item) => item.walkId === walkId)
    .sort(byWalkOrder);
  const markers: Record<string, string> = {};
  for (const item of walk) if (item.isMarker && item.plantId !== null) markers[item.id] = item.plantId;
  let next = q;
  for (const item of assignByMarkers(walk, markers)) {
    if (item !== q[item.id]) next = upsertQueued(next, item);
  }
  return next;
}

/** Move a queued file into `to` (a plant id or the inbox), finishing a
 * half-done move: a kill between an earlier move and its record write leaves
 * the file already where it is going, and that must complete the record
 * instead of failing. Resolves true when this call moved a file. */
async function moveQueuedFile(item: QueuedPhoto, to: string): Promise<boolean> {
  const from = queuedDirName(item);
  if (from === to) return false;
  const source = new File(queuedPhotoUri(item));
  const landed = new File(plantPhotoDir(to), item.basename);
  if (source.exists || !landed.exists) {
    await moveIntoPhotoDir(to, source.uri, item.basename);
    return true;
  }
  return false;
}

/** Undo one moveQueuedFile: the file now in `to` goes back to the directory
 * the record names. Best-effort — logged, never thrown. */
async function moveQueuedFileBack(item: QueuedPhoto, to: string): Promise<void> {
  await moveIntoPhotoDir(queuedDirName(item), new File(plantPhotoDir(to), item.basename).uri, item.basename).catch(
    (err: Error) => console.error("[photo-queue-io] move-back failed:", err.message),
  );
}

/** Apply a pure re-assignment to the queue — files first, records after
 * (D-W2): every record whose plant changed has its file moved into the new
 * directory before the records are written, and moved back if the write
 * fails, so a record never names a file that is not where the record says.
 * Only the records the transform changed are written, onto a fresh read, so
 * an enqueue that lands in between is not lost. A change onto a plant that
 * is gone throws (a directory nothing sweeps must not be made); a change to
 * a photo being analyzed is dropped (the runner is reading that uri); a
 * transform that changes nothing writes nothing. */
async function applyReassignment(transform: (q: PhotoQueue) => PhotoQueue): Promise<void> {
  const before = await loadPhotoQueue();
  const after = transform(before);
  if (after === before) return;
  const changed = Object.values(after).filter((item) => {
    const prev = before[item.id];
    return prev !== undefined && prev !== item && prev.status !== "analyzing";
  });
  if (changed.length === 0) return;
  const plants = await loadPlantStore();
  for (const item of changed) {
    if (item.plantId !== null && getPlant(plants, item.plantId) === null) throw new Error("plant not on this device");
  }
  const moved: { item: QueuedPhoto; to: string }[] = [];
  try {
    for (const item of changed) {
      const prev = before[item.id];
      const to = queuedDirName(item);
      if (await moveQueuedFile(prev, to)) moved.push({ item: prev, to });
    }
    await updateQueue((fresh) => {
      const merged = { ...fresh };
      for (const item of changed) if (fresh[item.id]) merged[item.id] = item;
      return merged;
    });
  } catch (e) {
    for (const m of moved) await moveQueuedFileBack(m.item, m.to);
    throw e;
  }
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
    await applyReassignment((q) => assignQueued(q, id, plantId, evidence));
  } catch (e) {
    console.error("[photo-queue-io] assign failed:", (e as Error).message);
    throw new Error(ASSIGN_PHOTO_ERROR);
  }
}

/** Rung 1c: this photo is a tree marker (a stake, a tag, a hand-written sign)
 * for `plantId` — never analyzed, gone when the walk is analyzed or parked —
 * and the photos after it in its walk take that plant. */
export async function markQueuedAsMarker(id: string, plantId: string): Promise<void> {
  const item = (await loadPhotoQueue())[id];
  if (item?.status === "analyzing") throw new Error(PHOTO_BUSY_ERROR);
  try {
    if (!item) throw new Error("queued photo not found");
    await applyReassignment((q) => withMarkersApplied(markAsMarker(q, id, plantId), item.walkId));
  } catch (e) {
    console.error("[photo-queue-io] mark as marker failed:", (e as Error).message);
    throw new Error(ASSIGN_PHOTO_ERROR);
  }
}

/** The card's "Plant photo" toggle: it is a photo of that plant after all —
 * kept, analyzed, assigned by the user's own decision (unmarkMarker). The
 * photos after it keep what the card gave them: the plant is the same. */
export async function unmarkQueuedMarker(id: string): Promise<void> {
  try {
    await applyReassignment((q) => unmarkMarker(q, id));
  } catch (e) {
    console.error("[photo-queue-io] unmark marker failed:", (e as Error).message);
    throw new Error(ASSIGN_PHOTO_ERROR);
  }
}

/** "Bind to a plant" on an unknown-code row: the code gets its owner on the
 * plant record (bindPlantCode), then every photo of this walk that decoded
 * to that code becomes the plant's tag card and the cards propagate. Plant
 * store first: a kill in between leaves a harmless binding the next import
 * recognizes. "Pick one" on a code SEVERAL plants hold binds nothing (D-W4:
 * a code moves only from its plant's own Tags card) — the tap is a per-walk
 * choice between the current owners, and a plant that is not one of them is
 * refused rather than made a third owner. Photos the viewfinder scanned
 * (code-scan) are plant photos, not cards. */
export async function bindCodeFromWalk(walkId: string, digest: string, plantId: string): Promise<void> {
  try {
    const owners = codeOwners(allPlants(await loadPlantStore()), digest);
    if (owners.length === 0) await bindPlantCode(plantId, digest);
    else if (!owners.includes(plantId)) throw new Error("plant does not hold this code");
    await applyReassignment((q) => {
      let next = q;
      for (const item of Object.values(q)) {
        if (item.walkId === walkId && item.codeDigest === digest && !item.isMarker && item.evidence !== "code-scan") {
          next = markAsMarker(next, item.id, plantId);
        }
      }
      return withMarkersApplied(next, walkId);
    });
  } catch (e) {
    const message = (e as Error).message;
    console.error("[photo-queue-io] bind from walk failed:", message);
    throw new Error(message === PLANT_CODE_LIMIT_ERROR ? message : BIND_CODE_ERROR);
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

/** A marker photo is scaffolding, not a plant photo: when the user answers
 * the every-time question (Analyze now / Later) the cards go — record and
 * file. Best-effort per photo; one that will not delete stays a card row and
 * is never analyzed (runnableItems excludes markers). */
export async function discardMarkerPhotos(items: ReadonlyArray<QueuedPhoto>): Promise<void> {
  for (const item of items) {
    if (!item.isMarker) continue;
    try {
      await removeQueuedPhoto(item.id);
    } catch (e) {
      console.error("[photo-queue-io] marker photo not removed:", (e as Error).message);
    }
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
