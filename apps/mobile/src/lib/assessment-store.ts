// Local-first assessment store, pure half (D-17): every assessment lives on the
// phone, in one AsyncStorage blob keyed by assessment id (a global map, not
// nested under plants, so by-id lookup is O(1) and cross-plant queries are
// trivial). health_score / is_cut_care are NOT stored — they are derived from
// the diagnosis on read (store-adapters), exactly as the old Postgres insert
// derived them at write time. Untrusted on read: a malformed record is
// dropped, never thrown. IO wiring is the thin assessment-store-io.ts.

import type { AssessmentDiagnosis } from "@citrus/shared";
import { isSafeRecordId, newestFirst } from "./local-id";

/** On-device assessment record. `engine` is always "on-device" now — there is
 * only one engine — kept as a field so a future second engine has a home and
 * the timeline mapper's provenance slot stays populated. */
export interface StoredAssessment {
  id: string;
  plantId: string;
  /** ISO timestamp of the analysis — when this row was written. */
  createdAt: string;
  /** F39 Phase 5 (D-W14): when the PHOTO was taken (ISO), for a walk photo
   * that knew it (EXIF, or the in-app shutter). Absent for a single-shot
   * assessment, where the analysis follows the photo within a minute. Every
   * "newest" / "before" question reads effectiveTime(), never this directly. */
  takenAt?: string;
  /** F39 Phase 6b: the walk this row landed in, so "Undo this walk" can take
   * back exactly its assessments. Absent for a single-shot assessment. */
  walkId?: string;
  /** The model's structured output — untrusted on read, guarded before use. */
  diagnosis: AssessmentDiagnosis;
  /** Previous assessment this one was compared against (timeline anchor). */
  comparedToId: string | null;
  engine: "on-device";
}

/** assessmentId → assessment. */
export type AssessmentStore = Record<string, StoredAssessment>;

export const ASSESSMENT_STORAGE_KEY = "citrus.assessments.v1";

export function upsertAssessment(store: AssessmentStore, assessment: StoredAssessment): AssessmentStore {
  return { ...store, [assessment.id]: assessment };
}

/** Cascade on plant delete: drop every assessment for the plant. */
export function removePlantAssessments(store: AssessmentStore, plantId: string): AssessmentStore {
  const next: AssessmentStore = {};
  for (const [id, assessment] of Object.entries(store)) {
    if (assessment.plantId !== plantId) next[id] = assessment;
  }
  return next;
}

/** When this assessment HAPPENED, for every "newest" / "before" question: the
 * photo's own time when a walk knew it, else the analysis time (Phase 5). */
export function effectiveTime(a: StoredAssessment): string {
  return a.takenAt ?? a.createdAt;
}

/** Newest first by effective time; on a shared second the higher id wins. The
 * tiebreak is what lets the timeline, the comparison anchor and the cover
 * agree on "newest" when a walk lands two photos of one plant in the same
 * second — and the effective time is what keeps last month's roll, analyzed
 * today, from becoming the plant's latest. */
export function byEffectiveTimeDesc(a: StoredAssessment, b: StoredAssessment): number {
  return newestFirst(effectiveTime(a), a.id, effectiveTime(b), b.id);
}

/** A plant's assessments, newest-first (timeline order). */
export function assessmentsForPlant(store: AssessmentStore, plantId: string): StoredAssessment[] {
  return Object.values(store)
    .filter((a) => a.plantId === plantId)
    .sort(byEffectiveTimeDesc);
}

/** The newest assessment id for a plant — the comparison anchor for the next
 * assessment and the plant's cover thumbnail. Null when the plant has none. */
export function latestAssessmentId(store: AssessmentStore, plantId: string): string | null {
  return assessmentsForPlant(store, plantId)[0]?.id ?? null;
}

export function allAssessments(store: AssessmentStore): StoredAssessment[] {
  return Object.values(store).sort(byEffectiveTimeDesc);
}

/** Every assessment a walk landed, across plants, newest-first — what "Undo
 * this walk" takes back (Phase 6b). Single-shot rows carry no walkId and
 * never match. */
export function assessmentsForWalk(store: AssessmentStore, walkId: string): StoredAssessment[] {
  return Object.values(store)
    .filter((a) => a.walkId === walkId)
    .sort(byEffectiveTimeDesc);
}

/** Where a row must look back FROM when its anchor is taken away. Its own
 * effective time normally — but a walk row measures against the PRE-walk
 * state (D-W6), so for one of those the cut-off is the earliest effective
 * time this plant has in that walk: a second angle shot 40 s later must never
 * fall back onto its own sibling ("Worse" between two angles is noise). */
function reanchorBefore(store: AssessmentStore, a: StoredAssessment): string {
  let earliest = effectiveTime(a);
  if (a.walkId === undefined) return earliest;
  for (const other of Object.values(store)) {
    if (other.plantId !== a.plantId || other.walkId !== a.walkId) continue;
    const time = effectiveTime(other);
    if (time < earliest) earliest = time;
  }
  return earliest;
}

/** Remove one assessment (Phase 6b). Rows that were compared against it are
 * RE-ANCHORED against the next older row they still have — a plant with
 * history must never read "First assessment" on the card just because the row
 * above it was undone — and only a row with nothing older loses its
 * `comparedToId` and its computed comparison. Unknown id → the same store,
 * `removed: null`. Pure; untouched rows keep their identity. */
export function removeAssessment(
  store: AssessmentStore,
  id: string,
): { store: AssessmentStore; removed: StoredAssessment | null } {
  const removed = store[id];
  if (!removed) return { store, removed: null };
  const next: AssessmentStore = {};
  const dependants: string[] = [];
  for (const [key, a] of Object.entries(store)) {
    if (key === id) continue;
    next[key] = a;
    if (a.comparedToId === id) dependants.push(key);
  }
  // Second pass: the anchor is looked up in the store WITHOUT the removed row.
  for (const key of dependants) {
    const a = next[key];
    const anchor = comparisonAnchor(next, a.plantId, reanchorBefore(next, a));
    next[key] = {
      ...a,
      comparedToId: anchor?.id ?? null,
      diagnosis: withComputedComparison(a.diagnosis, anchor?.diagnosis.health_score ?? null),
    };
  }
  return { store: next, removed };
}

/** What the next assessment of this plant is compared against (D-W6). With
 * no `beforeIso` it is simply the newest — the single-shot flow, unchanged. A
 * walk passes the instant its first photo of the plant started, so a second
 * angle taken 40 s later measures against the PRE-walk state, never against
 * its sibling ("Worse" between two angles of one tree is noise, not a trend). */
export function comparisonAnchor(
  store: AssessmentStore,
  plantId: string,
  beforeIso?: string,
): StoredAssessment | null {
  const rows = assessmentsForPlant(store, plantId);
  if (beforeIso === undefined) return rows[0] ?? null;
  // Effective time (Phase 5): a photo shot before the anchor is "before" it
  // however late it was analyzed, and one shot after it never is.
  return rows.find((a) => effectiveTime(a) < beforeIso) ?? null;
}

/** id keys the photo index and plantId names a directory (D-W16): both must
 * be ids this app could have minted. */
function isValidStoredAssessment(value: unknown): value is StoredAssessment {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  const diagnosis = a.diagnosis as Record<string, unknown> | null | undefined;
  return (
    isSafeRecordId(a.id) &&
    isSafeRecordId(a.plantId) &&
    typeof a.createdAt === "string" &&
    (a.comparedToId === null || typeof a.comparedToId === "string") &&
    typeof diagnosis === "object" &&
    diagnosis !== null &&
    typeof diagnosis.health_score === "number"
  );
}

/** The Phase 5 / 6b fields are optional AND repairable: a takenAt that is not
 * a string, or a walkId that is not a safe record id (D-W16 — it is compared
 * against ids the app minted), is dropped and the assessment kept. Returns the
 * same object when nothing needs repair. */
function repairOptionalFields(a: StoredAssessment): StoredAssessment {
  const takenAtOk = a.takenAt === undefined || typeof a.takenAt === "string";
  const walkIdOk = a.walkId === undefined || isSafeRecordId(a.walkId);
  if (takenAtOk && walkIdOk) return a;
  const { takenAt, walkId, ...rest } = a;
  return {
    ...rest,
    ...(takenAtOk && takenAt !== undefined ? { takenAt } : {}),
    ...(walkIdOk && walkId !== undefined ? { walkId } : {}),
  };
}

/** Parse the stored blob. Untrusted: malformed JSON or records degrade (dropped
 * / empty store), never throw. */
export function parseAssessmentStore(json: string | null): AssessmentStore {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const store: AssessmentStore = {};
  for (const [id, assessment] of Object.entries(raw)) {
    if (isValidStoredAssessment(assessment) && assessment.id === id) store[id] = repairOptionalFields(assessment);
  }
  return store;
}

export function serializeAssessmentStore(store: AssessmentStore): string {
  return JSON.stringify(store);
}

// ---- Deterministic trend (D-17) ----

/** Score change within ±this is "same" — noise, not a real trend. */
export const COMPARISON_SAME_BAND = 5;

export type Delta = "better" | "same" | "worse";

/** better/same/worse from the previous vs current health score. */
export function deltaFromScores(previous: number, current: number): Delta {
  const change = current - previous;
  if (change >= COMPARISON_SAME_BAND) return "better";
  if (change <= -COMPARISON_SAME_BAND) return "worse";
  return "same";
}

function comparisonNote(previous: number, current: number, delta: Delta): string {
  if (delta === "better") return `Health rose from ${previous} to ${current}.`;
  if (delta === "worse") return `Health fell from ${previous} to ${current}.`;
  return `Health held around ${current}.`;
}

/** The on-device model is stateless per photo and emits no `comparison`, so we
 * compute one from the two scores. A first assessment (no previous score) gets
 * NO comparison — that is what makes the timeline read "First". */
export function withComputedComparison(
  diagnosis: AssessmentDiagnosis,
  previousScore: number | null,
): AssessmentDiagnosis {
  if (previousScore === null) {
    if (diagnosis.comparison === undefined) return diagnosis;
    const { comparison: _stray, ...rest } = diagnosis;
    return rest;
  }
  const delta = deltaFromScores(previousScore, diagnosis.health_score);
  return {
    ...diagnosis,
    comparison: { delta, notes: comparisonNote(previousScore, diagnosis.health_score, delta) },
  };
}
