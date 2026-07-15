// Plant detail data: the plant row (incl. zip_code for the quarantine check)
// plus the full assessment timeline, mapped into render-ready entries. Pure
// mapping half is tested (plant-detail.test.ts); the queries are thin.
// Photos are local-only (D-16): entries join to on-phone uris through the
// photo-store index; entries without a local photo render a placeholder.

import type { SupabaseClient } from "@supabase/supabase-js";
import { assessmentDiagnosisSchema, type AssessmentDiagnosis, type Plant } from "@citrus/shared";
import { photoForAssessment, type PhotoIndex } from "./photo-store";

export const PLANT_DETAIL_LOAD_ERROR = "Could not load this plant.";

export type PlantDetailRow = Pick<
  Plant,
  "id" | "name" | "plant_type" | "species" | "cultivar" | "location" | "zip_code" | "created_at"
>;

export const PLANT_DETAIL_SELECT =
  "id,name,plant_type,species,cultivar,location,zip_code,created_at";

/** Timeline columns; photo_path is gone (D-16 — photos never reach the
 * server), is_cut_care lets a row tap restore the assessment's capture mode. */
export const TIMELINE_SELECT = "id,created_at,health_score,diagnosis,is_cut_care";

export interface TimelineRow {
  id: string;
  created_at: string;
  health_score: number;
  /** jsonb straight from Postgres — untrusted until Zod-parsed. */
  diagnosis: unknown;
  is_cut_care: boolean | null;
}

export type TimelineDelta = "better" | "same" | "worse" | "unknown";

export interface TimelineEntry {
  id: string;
  createdAt: string;
  dateLabel: string;
  score: number;
  delta: TimelineDelta | null;
  /** Chip text mirroring the web badge wording; "First" marks the plant's
   * earliest assessment (nothing prior to compare against). */
  deltaLabel: string | null;
  summary: string;
  /** On-phone photo uri from the local index; null (placeholder) when this
   * device has no photo for the assessment (old rows, other devices). */
  localUri: string | null;
  isCutCare: boolean;
  /** Raw jsonb, parsed on tap via parseTimelineDiagnosis. */
  diagnosis: unknown;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jul 10, 2026" — UTC-based for determinism (same convention as reminders.ts). */
export function formatTimelineDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unknown date";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const DELTAS: ReadonlySet<string> = new Set(["better", "same", "worse", "unknown"]);

/** Safely pull comparison.delta out of the untrusted diagnosis jsonb. */
export function comparisonDelta(diagnosis: unknown): TimelineDelta | null {
  if (typeof diagnosis !== "object" || diagnosis === null) return null;
  const comparison = (diagnosis as { comparison?: unknown }).comparison;
  if (typeof comparison !== "object" || comparison === null) return null;
  const delta = (comparison as { delta?: unknown }).delta;
  return typeof delta === "string" && DELTAS.has(delta) ? (delta as TimelineDelta) : null;
}

function summaryOf(diagnosis: unknown): string {
  if (typeof diagnosis !== "object" || diagnosis === null) return "";
  const summary = (diagnosis as { summary?: unknown }).summary;
  return typeof summary === "string" ? summary : "";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Rows arrive reverse-chron (newest first); the last row is the plant's
 * first assessment and gets the "First" chip when it carries no comparison. */
export function mapTimelineRows(rows: TimelineRow[] | null | undefined): TimelineEntry[] {
  const list = rows ?? [];
  return list.map((row, i) => {
    const delta = comparisonDelta(row.diagnosis);
    const isEarliest = i === list.length - 1;
    return {
      id: row.id,
      createdAt: row.created_at,
      dateLabel: formatTimelineDate(row.created_at),
      score: row.health_score,
      delta,
      deltaLabel: delta ? capitalize(delta) : isEarliest ? "First" : null,
      summary: summaryOf(row.diagnosis),
      localUri: null,
      isCutCare: row.is_cut_care === true,
      diagnosis: row.diagnosis,
    };
  });
}

/** Join timeline entries to their on-phone photos via the photo-store index.
 * Entries with no local photo keep localUri null — placeholder, never an error. */
export function attachLocalPhotos(entries: TimelineEntry[], index: PhotoIndex): TimelineEntry[] {
  return entries.map((entry) => ({
    ...entry,
    localUri: photoForAssessment(index, entry.id)?.localUri ?? null,
  }));
}

/** Header trend chip: the latest delta, or "First assessment" for a plant
 * with exactly one; null when there is nothing meaningful to say. */
export function trendChipLabel(entries: TimelineEntry[]): string | null {
  if (entries.length === 0) return null;
  const latest = entries[0];
  if (latest.delta) return capitalize(latest.delta);
  return entries.length === 1 ? "First assessment" : null;
}

/** Oldest vs latest LOCALLY AVAILABLE photo for the before/after slider;
 * null when fewer than two entries have an on-phone photo. */
export function sliderPair(
  entries: TimelineEntry[],
): { before: TimelineEntry; after: TimelineEntry } | null {
  const withPhotos = entries.filter((entry) => entry.localUri !== null);
  if (withPhotos.length < 2) return null;
  return { before: withPhotos[withPhotos.length - 1], after: withPhotos[0] };
}

/** Zod-parse a timeline row's stored diagnosis before opening DiagnosisScreen
 * (same shared-schema guard as the assess flow). Null = don't navigate. */
export function parseTimelineDiagnosis(raw: unknown): AssessmentDiagnosis | null {
  const parsed = assessmentDiagnosisSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[parseTimelineDiagnosis] stored diagnosis failed schema:", parsed.error.message);
    return null;
  }
  return parsed.data;
}

export interface PlantDetailData {
  plant: PlantDetailRow;
  timeline: TimelineEntry[];
}

/** Thin two-query fetch (plant row + all assessments, newest first). Generic
 * client-facing message; details stay in the console (web parity rule). */
export async function fetchPlantDetail(
  client: SupabaseClient,
  plantId: string,
): Promise<PlantDetailData> {
  const { data: plant, error: plantError } = await client
    .from("plants")
    .select(PLANT_DETAIL_SELECT)
    .eq("id", plantId)
    .maybeSingle();
  if (plantError || !plant) {
    console.error("[fetchPlantDetail] plant query failed:", plantError?.message ?? "not found");
    throw new Error(PLANT_DETAIL_LOAD_ERROR);
  }

  const { data: rows, error: rowsError } = await client
    .from("assessments")
    .select(TIMELINE_SELECT)
    .eq("plant_id", plantId)
    .order("created_at", { ascending: false });
  if (rowsError) {
    console.error("[fetchPlantDetail] timeline query failed:", rowsError.message);
    throw new Error(PLANT_DETAIL_LOAD_ERROR);
  }

  return {
    plant: plant as unknown as PlantDetailRow,
    timeline: mapTimelineRows(rows as unknown as TimelineRow[]),
  };
}
