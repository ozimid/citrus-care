// Local-first assessment store, pure half (D-17): every assessment lives on the
// phone, in one AsyncStorage blob keyed by assessment id (a global map, not
// nested under plants, so by-id lookup is O(1) and cross-plant queries are
// trivial). health_score / is_cut_care are NOT stored — they are derived from
// the diagnosis on read (store-adapters), exactly as buildLocalAssessmentRow
// derived them for the old Postgres insert. Untrusted on read: a malformed
// record is dropped, never thrown. IO wiring is the thin assessment-store-io.ts.

import type { AssessmentDiagnosis } from "@citrus/shared";

/** On-device assessment record. `engine` is always "on-device" now — there is
 * only one engine — kept as a field so a future second engine has a home and
 * the timeline mapper's provenance slot stays populated. */
export interface StoredAssessment {
  id: string;
  plantId: string;
  /** ISO timestamp. */
  createdAt: string;
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

function byCreatedAtDesc(a: StoredAssessment, b: StoredAssessment): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

/** A plant's assessments, newest-first (timeline order). */
export function assessmentsForPlant(store: AssessmentStore, plantId: string): StoredAssessment[] {
  return Object.values(store)
    .filter((a) => a.plantId === plantId)
    .sort(byCreatedAtDesc);
}

/** The newest assessment id for a plant — the comparison anchor for the next
 * assessment and the plant's cover thumbnail. Null when the plant has none. */
export function latestAssessmentId(store: AssessmentStore, plantId: string): string | null {
  return assessmentsForPlant(store, plantId)[0]?.id ?? null;
}

export function allAssessments(store: AssessmentStore): StoredAssessment[] {
  return Object.values(store);
}

function isValidStoredAssessment(value: unknown): value is StoredAssessment {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  const diagnosis = a.diagnosis as Record<string, unknown> | null | undefined;
  return (
    typeof a.id === "string" &&
    typeof a.plantId === "string" &&
    typeof a.createdAt === "string" &&
    (a.comparedToId === null || typeof a.comparedToId === "string") &&
    typeof diagnosis === "object" &&
    diagnosis !== null &&
    typeof diagnosis.health_score === "number"
  );
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
    if (isValidStoredAssessment(assessment)) store[id] = assessment;
  }
  return store;
}

export function serializeAssessmentStore(store: AssessmentStore): string {
  return JSON.stringify(store);
}
