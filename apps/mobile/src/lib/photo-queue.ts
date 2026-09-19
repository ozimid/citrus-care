// F39 Garden Walk — the photo queue, pure half (D-W1). A photo that has no
// assessment yet lives HERE, in its own AsyncStorage blob keyed by its own id,
// never as a placeholder assessment (which would poison latestScore, the trend,
// the cover, the watering anchor, the timeline and the backup). A record
// leaves the store the moment its assessment lands — file ownership passes to
// the photo index.
//
// Identity lives in the record and the plant directory, never in the file
// name: a record stores a BASENAME, and the uri is rebuilt by the io through
// the one guarded `plantPhotoDir(plantId ?? _inbox)` (D-W2, D-W16). Every id
// and basename is gated on parse because each can name a path.
//
// Which plant a photo belongs to is decided by explicit, deterministic
// evidence (D-W3) — the model never assigns. The AsyncStorage wiring, the file
// moves and the sweep are the thin photo-queue-io.ts.

import { assessmentDiagnosisSchema, type AssessmentDiagnosis } from "@citrus/shared";
import type { AssessmentStore } from "./assessment-store";
import { isSafeBasename, isSafeRecordId } from "./local-id";
import { PHOTO_INBOX_DIR, type PhotoIndex } from "./photo-store";

export const PHOTO_QUEUE_STORAGE_KEY = "citrus.photo-queue.v1";
/** Ring of the last 30 per-photo run durations — D-W8's "about N min". */
export const WALK_DURATIONS_KEY = "citrus.walk-durations.v1";
export const MAX_IMPORT = 30;
/** Automatic re-runs per photo; a user Retry or a reassign resets the count. */
export const MAX_AUTO_ATTEMPTS = 3;
/** Shots further apart than this start a new time-gap group (rung 4). */
export const GROUP_GAP_MS = 45_000;
/** Idle time after which walk-mode shots carry `carried`, not `user`. */
export const CARRY_IDLE_MS = 120_000;
/** A group propagates its one deciding plant to at most this many photos. */
export const MAX_GROUP_PROPAGATION = 4;
/** The inbox sweep leaves files younger than this alone. */
export const INBOX_SWEEP_MIN_AGE_MS = 10 * 60_000;
/** Free-space guard per imported photo (original copy + 1600 px output). */
export const IMPORT_BYTES_PER_PHOTO = 1_500_000;

/** "assessed" is not a status: an assessed record is deleted. */
export type QueueStatus = "pending" | "analyzing" | "rejected" | "failed";
const STATUSES: readonly string[] = ["pending", "analyzing", "rejected", "failed"];

/** How the photo got its plant (D-W3). Shown as a badge until the run commits. */
export type AssignEvidence =
  | "user"
  | "user-run"
  | "code-scan"
  | "carried"
  | "tag-card"
  | "marker"
  | "group"
  | "file-tag"
  | "none";
const EVIDENCE: readonly string[] = ["user", "user-run", "code-scan", "carried", "tag-card", "marker", "group", "file-tag", "none"];
const DECIDING: readonly string[] = ["user", "user-run", "code-scan", "tag-card", "marker"];

/** Evidence strong enough to decide a group or end a run (rungs 1–3); the
 * rest is propagation or suggestion and yields to it. */
export function isDecidingEvidence(evidence: AssignEvidence): boolean {
  return DECIDING.includes(evidence);
}

export interface QueuedPhoto {
  id: string;
  walkId: string;
  /** Time-gap group within the walk (assignGroups); own id until grouped. */
  groupId: string;
  plantId: string | null;
  evidence: AssignEvidence;
  /** A soft hint (rung 5) the review screen shows; never analyzed on its own. */
  suggestedPlantId: string | null;
  /** File name inside plantPhotoDir(plantId ?? PHOTO_INBOX_DIR). Never a uri. */
  basename: string;
  width: number;
  height: number;
  /** Set on parse when the stored dimensions were unusable; the io re-measures. */
  needsDims?: true;
  /** EXIF instant; null when unknown — never a fake "now" for a gallery photo. */
  takenAt: string | null;
  addedAt: string;
  source: "camera" | "gallery";
  codeDigest: string | null;
  fileName: string | null;
  status: QueueStatus;
  /** Persisted BEFORE the model runs, so a kill mid-item is reconcilable. */
  startedAt: string | null;
  /** Comparison anchor for this plant in this walk (D-W6); set once. */
  runAnchorIso: string | null;
  attempts: number;
  /** Generic, user-facing string — never raw model/runtime text. */
  error: string | null;
  timedOut: boolean;
  /** Kept for "Score it anyway" after a not-a-plant rejection. */
  rejectedDiagnosis: AssessmentDiagnosis | null;
}

/** photoId → record. */
export type PhotoQueue = Record<string, QueuedPhoto>;

export function queuedDirName(item: QueuedPhoto): string {
  return item.plantId ?? PHOTO_INBOX_DIR;
}

// ---- Records ----

export function upsertQueued(q: PhotoQueue, item: QueuedPhoto): PhotoQueue {
  return { ...q, [item.id]: item };
}

export function removeQueued(q: PhotoQueue, id: string): PhotoQueue {
  if (!(id in q)) return q;
  const { [id]: _gone, ...rest } = q;
  return rest;
}

/** Cascade on plant delete: drop the plant's photos and forget any suggestion
 * that pointed at it, so the review screen never offers a plant that is gone. */
export function removePlantQueued(q: PhotoQueue, plantId: string): PhotoQueue {
  const next: PhotoQueue = {};
  for (const [id, item] of Object.entries(q)) {
    if (item.plantId === plantId) continue;
    next[id] =
      item.suggestedPlantId === plantId
        ? { ...item, suggestedPlantId: null, evidence: item.plantId === null ? "none" : item.evidence }
        : item;
  }
  return next;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Known shooting times ascending, unknown last. */
function takenAtAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmp(a, b);
}

/** Shooting order with the id as the tiebreak, so two shots in one second
 * never swap between renders. */
function byShotOrder(a: QueuedPhoto, b: QueuedPhoto): number {
  return takenAtAsc(a.takenAt, b.takenAt) || cmp(a.id, b.id);
}

/** Run order (D-W6): walk, then plant, then shooting order — so a plant's
 * photos from one walk run back to back against one anchor. */
function byRunOrder(a: QueuedPhoto, b: QueuedPhoto): number {
  return cmp(a.walkId, b.walkId) || cmp(a.plantId ?? "", b.plantId ?? "") || byShotOrder(a, b);
}

export function queuedForPlant(q: PhotoQueue, plantId: string): QueuedPhoto[] {
  return Object.values(q)
    .filter((item) => item.plantId === plantId)
    .sort(byShotOrder);
}

function awaitsAnalysis(item: QueuedPhoto): boolean {
  return item.status === "pending" || item.status === "failed";
}

/** Photos still waiting for the model (pending or failed) — the honest count
 * for "N photos are waiting". Analyzing and rejected ones are not waiting. */
export function pendingCount(q: PhotoQueue): number {
  return Object.values(q).filter(awaitsAnalysis).length;
}

export function pendingByPlant(q: PhotoQueue): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of Object.values(q)) {
    if (awaitsAnalysis(item) && item.plantId !== null) counts[item.plantId] = (counts[item.plantId] ?? 0) + 1;
  }
  return counts;
}

/** What a run will analyze: assigned, waiting, under the automatic-attempt
 * cap; in run order. Unassigned photos never spend model time (D-W3). */
export function runnableItems(q: PhotoQueue, filter: { walkId?: string; plantId?: string } = {}): QueuedPhoto[] {
  return Object.values(q)
    .filter(
      (item) =>
        awaitsAnalysis(item) &&
        item.plantId !== null &&
        item.attempts < MAX_AUTO_ATTEMPTS &&
        (filter.walkId === undefined || item.walkId === filter.walkId) &&
        (filter.plantId === undefined || item.plantId === filter.plantId),
    )
    .sort(byRunOrder);
}

/** Photos automation has given up on, or the model refused — the user decides. */
export function stalledItems(q: PhotoQueue): QueuedPhoto[] {
  return Object.values(q)
    .filter((item) => item.attempts >= MAX_AUTO_ATTEMPTS || item.status === "rejected")
    .sort(byRunOrder);
}

// ---- Run transitions ----

function patch(q: PhotoQueue, id: string, change: (item: QueuedPhoto) => QueuedPhoto): PhotoQueue {
  const item = q[id];
  return item ? { ...q, [id]: change(item) } : q;
}

/** Persisted before the model is called (D-W2). Counts the attempt; the
 * comparison anchor is set once and reused on resume and retry (D-W6). */
export function markAnalyzing(q: PhotoQueue, id: string, nowIso: string, anchorIso: string): PhotoQueue {
  return patch(q, id, (item) => ({
    ...item,
    status: "analyzing",
    startedAt: nowIso,
    attempts: item.attempts + 1,
    runAnchorIso: item.runAnchorIso ?? anchorIso,
    error: null,
    timedOut: false,
  }));
}

export function markRejected(q: PhotoQueue, id: string, diagnosis: AssessmentDiagnosis): PhotoQueue {
  return patch(q, id, (item) => ({ ...item, status: "rejected", rejectedDiagnosis: diagnosis, error: null, timedOut: false }));
}

export function markFailed(q: PhotoQueue, id: string, error: string, timedOut: boolean): PhotoQueue {
  return patch(q, id, (item) => ({ ...item, status: "failed", error, timedOut }));
}

function pendingAgain(item: QueuedPhoto): QueuedPhoto {
  return { ...item, status: "pending", startedAt: null, error: null, timedOut: false };
}

/** Back to waiting. The attempt count is kept (it is what caps automation)
 * unless `attempts` says otherwise: 0 for the user's Retry (a deliberate tap
 * starts the count over, D-W2), or the pre-mark count when markAnalyzing
 * counted an attempt the engine never ran. */
export function markPending(q: PhotoQueue, id: string, attempts?: number): PhotoQueue {
  return patch(q, id, (item) => {
    const next = pendingAgain(item);
    return attempts === undefined ? next : { ...next, attempts: Math.max(0, attempts) };
  });
}

// ---- Assignment (D-W3) ----

/** One record, (re)assigned: the suggestion and the per-walk anchor are stale
 * for a different plant; a failed run gets a fresh start (attempts → 0). A
 * rejected photo stays rejected — moving it does not make it a plant. */
export function assignedPhoto(item: QueuedPhoto, plantId: string | null, evidence: AssignEvidence): QueuedPhoto {
  const base = item.status === "failed" ? pendingAgain(item) : item;
  return { ...base, plantId, evidence, suggestedPlantId: null, runAnchorIso: null, attempts: 0 };
}

export function assignQueued(q: PhotoQueue, id: string, plantId: string | null, evidence: AssignEvidence): PhotoQueue {
  return patch(q, id, (item) => assignedPhoto(item, plantId, evidence));
}

function withChanges(q: PhotoQueue, changed: PhotoQueue): PhotoQueue {
  return Object.keys(changed).length > 0 ? { ...q, ...changed } : q;
}

/** Rung 4: group a walk's photos by shooting time. A new group starts after a
 * pause longer than `gapMs` or when the source changes; a photo with no known
 * time is a group of one — it is never chained onto a neighbour. The group id
 * is the first member's id, so regrouping is deterministic. */
export function assignGroups(q: PhotoQueue, walkId: string, gapMs: number = GROUP_GAP_MS): PhotoQueue {
  const changed: PhotoQueue = {};
  let prev: QueuedPhoto | null = null;
  let groupId = "";
  for (const item of Object.values(q).filter((i) => i.walkId === walkId).sort(byShotOrder)) {
    const gap = item.takenAt !== null && prev?.takenAt != null ? Date.parse(item.takenAt) - Date.parse(prev.takenAt) : Number.NaN;
    const startsGroup = item.takenAt === null || prev === null || item.source !== prev.source || !(gap <= gapMs);
    if (startsGroup) groupId = item.id;
    if (item.groupId !== groupId) changed[item.id] = { ...item, groupId };
    prev = item;
  }
  return withChanges(q, changed);
}

/** Rung 4: a group with exactly ONE deciding plant hands it to its unassigned
 * members (earliest first, at most `max`) as `group` evidence. Two deciders
 * disagreeing, or none, propagates nothing — the group needs a plant. */
export function propagateWithinGroup(q: PhotoQueue, walkId: string, max: number = MAX_GROUP_PROPAGATION): PhotoQueue {
  const groups = new Map<string, QueuedPhoto[]>();
  for (const item of Object.values(q)) {
    if (item.walkId === walkId) groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item]);
  }
  const changed: PhotoQueue = {};
  for (const members of groups.values()) {
    const deciders = new Set(members.filter((m) => m.plantId !== null && isDecidingEvidence(m.evidence)).map((m) => m.plantId as string));
    if (deciders.size !== 1) continue;
    const [plantId] = deciders;
    for (const member of members.filter((m) => m.plantId === null).sort(byShotOrder).slice(0, max)) {
      changed[member.id] = assignedPhoto(member, plantId, "group");
    }
  }
  return withChanges(q, changed);
}

// ---- Recovery (D-W2) ----

export interface QueueRelink {
  assessmentId: string;
  plantId: string;
  basename: string;
}

/** The trailing segment of a stored uri — the basename the record keeps. */
function uriBasename(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

/** The assessment whose photo-index entry names this record's file (the
 * runner passes the queued file as the assessment's savedUri, so a landed walk
 * photo is linked under its queue basename). Null when none does. */
function indexOwnerOf(index: PhotoIndex, plantId: string, basename: string, claimed: Set<string>): string | null {
  for (const [assessmentId, entry] of Object.entries(index)) {
    if (!claimed.has(assessmentId) && entry.plantId === plantId && uriBasename(entry.localUri) === basename) return assessmentId;
  }
  return null;
}

/** After a kill mid-run: an `analyzing` record whose assessment DID land is
 * done — drop it. Landed means, first, that a photo-index entry for the plant
 * names the record's file (the file is owned, whatever the clocks say); else
 * that a same-plant assessment created at or after `startedAt` has NO index
 * entry at all (the kill hit between the store write and the link) — then the
 * io is asked to write that link. An assessment whose index entry names a
 * different file is somebody else's photo (a single-shot taken after the
 * kill) and never settles a record. One with no landed assessment goes back
 * to pending, attempts unchanged. Each assessment settles at most one record. */
export function reconcileInterrupted(
  q: PhotoQueue,
  assessments: AssessmentStore,
  index: PhotoIndex,
): { queue: PhotoQueue; relink: QueueRelink[] } {
  const relink: QueueRelink[] = [];
  const removed = new Set<string>();
  const changed: PhotoQueue = {};
  const claimed = new Set<string>();
  for (const item of Object.values(q).filter((i) => i.status === "analyzing").sort(byRunOrder)) {
    const { plantId, startedAt } = item;
    if (plantId === null) {
      changed[item.id] = pendingAgain(item);
      continue;
    }
    const owner = indexOwnerOf(index, plantId, item.basename, claimed);
    if (owner !== null) {
      claimed.add(owner);
      removed.add(item.id);
      continue;
    }
    const match =
      startedAt !== null
        ? Object.values(assessments)
            .filter((a) => a.plantId === plantId && a.createdAt >= startedAt && !claimed.has(a.id) && !index[a.id])
            .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id))[0]
        : undefined;
    if (!match) {
      changed[item.id] = pendingAgain(item);
      continue;
    }
    claimed.add(match.id);
    removed.add(item.id);
    relink.push({ assessmentId: match.id, plantId, basename: item.basename });
  }
  if (removed.size === 0 && Object.keys(changed).length === 0) return { queue: q, relink };
  const queue: PhotoQueue = {};
  for (const [id, item] of Object.entries(q)) {
    if (!removed.has(id)) queue[id] = changed[id] ?? item;
  }
  return { queue, relink };
}

/** D-W9: one cover per plant at run end — a whole-plant shot, else a leaf,
 * else the first by shooting time. Null for nothing. */
export function pickWalkCover(items: { assessmentId: string; subject: string; takenAt: string | null }[]): string | null {
  const ordered = [...items].sort((a, b) => takenAtAsc(a.takenAt, b.takenAt));
  const pick = ordered.find((i) => i.subject === "whole_plant") ?? ordered.find((i) => i.subject === "leaf") ?? ordered[0];
  return pick?.assessmentId ?? null;
}

// ---- Durations ring (D-W8) ----

const DURATION_RING_MAX = 30;

export function pushDuration(ring: number[], ms: number, max: number = DURATION_RING_MAX): number[] {
  if (!Number.isFinite(ms) || ms < 0) return ring;
  const next = [...ring, ms];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function durationStats(ring: number[]): { median: number | null; count: number } {
  if (ring.length === 0) return { median: null, count: 0 };
  const sorted = [...ring].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, count: ring.length };
}

export function parseDurations(json: string | null): number[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const clean = raw.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  return clean.length > DURATION_RING_MAX ? clean.slice(clean.length - DURATION_RING_MAX) : clean;
}

export function serializeDurations(ring: number[]): string {
  return JSON.stringify(ring);
}

// ---- Persistence (untrusted on read) ----

/** D-W13: a file name is display text only, and capped. */
const MAX_FILE_NAME = 80;
/** A stored error is a generic line the app itself wrote; a corrupt blob must
 * not turn it into a wall of text once the run screen renders it. */
const MAX_ERROR_LEN = 200;
/** An ISO instant is ≤ 30 chars; longer, or unparseable, is not a date. */
const MAX_ISO_LEN = 40;

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A date field survives only as a parseable instant of sane length. */
function optionalIso(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_ISO_LEN && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** null | absent → null; a safe id → itself; anything else → "drop". */
function optionalPlantId(value: unknown): string | null | "drop" {
  if (value === null || value === undefined) return null;
  return isSafeRecordId(value) ? value : "drop";
}

/** A record is kept whenever its load-bearing fields hold (the id, the
 * basename, the plant, the status); everything else is repaired — losing a
 * flag is nothing, losing a photo is not (D-W3 rung 6). A record with no walk
 * is its own walk; one with no arrival time takes its shooting time.
 * Dimensions the io could not read are flagged, never stored as zero (a zero
 * makes every aspect ratio lie) — and the flag itself is kept across saves,
 * or the placeholder 1×1 would pass as a real size on the next parse. */
function validRecord(key: string, value: unknown): QueuedPhoto | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (!isSafeRecordId(r.id) || r.id !== key || !isSafeBasename(r.basename)) return null;
  if (!STATUSES.includes(r.status as string)) return null;
  if (!(r.plantId === null || isSafeRecordId(r.plantId))) return null;
  const suggestedPlantId = optionalPlantId(r.suggestedPlantId);
  if (suggestedPlantId === "drop") return null;
  const dimsOk = isDimension(r.width) && isDimension(r.height);
  const rejected = r.rejectedDiagnosis == null ? null : assessmentDiagnosisSchema.safeParse(r.rejectedDiagnosis);
  const takenAt = optionalIso(r.takenAt);
  const item: QueuedPhoto = {
    id: r.id,
    walkId: typeof r.walkId === "string" && r.walkId.length > 0 ? r.walkId : r.id,
    groupId: typeof r.groupId === "string" ? r.groupId : r.id,
    plantId: r.plantId as string | null,
    evidence: EVIDENCE.includes(r.evidence as string) ? (r.evidence as AssignEvidence) : "none",
    suggestedPlantId,
    basename: r.basename,
    width: dimsOk ? (r.width as number) : 1,
    height: dimsOk ? (r.height as number) : 1,
    takenAt,
    addedAt: optionalIso(r.addedAt) ?? takenAt ?? "",
    source: r.source === "camera" ? "camera" : "gallery",
    codeDigest: optionalString(r.codeDigest),
    fileName: optionalString(r.fileName)?.slice(0, MAX_FILE_NAME) ?? null,
    status: r.status as QueueStatus,
    startedAt: optionalIso(r.startedAt),
    runAnchorIso: optionalIso(r.runAnchorIso),
    attempts: Number.isInteger(r.attempts) && (r.attempts as number) >= 0 ? (r.attempts as number) : 0,
    error: optionalString(r.error)?.slice(0, MAX_ERROR_LEN) ?? null,
    timedOut: r.timedOut === true,
    rejectedDiagnosis: rejected?.success ? rejected.data : null,
  };
  if (!dimsOk || r.needsDims === true) item.needsDims = true;
  return item;
}

/** Parse the stored blob. Untrusted: malformed JSON or records degrade
 * (dropped / repaired / empty queue), never throw. */
export function parsePhotoQueue(json: string | null): PhotoQueue {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const queue: PhotoQueue = {};
  for (const [key, value] of Object.entries(raw)) {
    const item = validRecord(key, value);
    if (item) queue[key] = item;
  }
  return queue;
}

export function serializePhotoQueue(q: PhotoQueue): string {
  return JSON.stringify(q);
}
