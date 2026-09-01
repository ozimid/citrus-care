// Plants list row mapping (pure, unit-tested). D-17: rows are reconstructed
// from the on-device stores by store-adapters and fed here; the thin read is
// fetchPlants in plants-io.ts. The nested-assessments shape is a legacy of the
// PostgREST embed the adapter now recreates — kept so these mappers, and their
// tests, are unchanged.

import type { Assessment, CareProfile, Plant } from "@citrus/shared";
import { photoForAssessment, photosForPlant, type PhotoIndex } from "./photo-store";
import { comparisonDelta } from "./plant-detail";
import { parseStoredCareProfile } from "./watering";

export type AssessmentScoreRow = Pick<Assessment, "health_score" | "created_at"> & {
  /** jsonb from the embed — untrusted; only comparison.delta is read, safely. */
  diagnosis?: unknown;
};

/** The columns PLANTS_SELECT pulls, tied to the shared Plant/Assessment types
 * so schema drift shows up as a compile error. */
export type PlantRow = Pick<
  Plant,
  "id" | "name" | "plant_type" | "species" | "cultivar" | "location" | "created_at"
> & {
  zip_code?: string | null;
  /** The card's photo anchor — updated best-effort after each assessment. */
  cover_assessment_id?: string | null;
  /** jsonb from Postgres — untrusted until parseStoredCareProfile validates it. */
  care_profile?: unknown;
  assessments?: AssessmentScoreRow[] | null;
};

export interface PlantListItem {
  id: string;
  name: string;
  /** Pack selection (Today card's prune-window check) needs the real
   * identity, not the pet name. */
  plantType: string;
  species: string | null;
  subLabel: string;
  latestScore: number | null;
  /** Card trend chip: "Better"/"Same"/"Worse"/"Unknown" from the latest
   * assessment's comparison, "First assessment" when nothing prior existed. */
  trend: string | null;
  createdAt: string;
  /** F20 watering inputs, carried on the list item so the needs-water chip is
   * computed locally — no per-card query, no per-card network. */
  location: string | null;
  zipCode: string | null;
  careProfile: CareProfile | null;
  lastAssessedAt: string | null;
  coverAssessmentId: string | null;
  /** On-phone uri of the card's photo, joined by attachCoverPhotos; null =
   * placeholder (a plant never photographed, or photos not on this device). */
  coverUri: string | null;
}

/** Mirrors the web PlantCard sub-label: Type · species · cultivar (or "Unknown cultivar") · location. */
export function plantSubLabel(row: PlantRow): string {
  const typeLabel = row.plant_type
    ? row.plant_type.charAt(0).toUpperCase() + row.plant_type.slice(1)
    : "";
  return [typeLabel, row.species, row.cultivar ?? "Unknown cultivar", row.location]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" · ");
}

function latestAssessment(
  assessments: AssessmentScoreRow[] | null | undefined,
): AssessmentScoreRow | null {
  if (!assessments || assessments.length === 0) return null;
  let latest = assessments[0];
  for (const a of assessments) {
    if (a.created_at > latest.created_at) latest = a;
  }
  return latest;
}

export function latestScore(assessments: AssessmentScoreRow[] | null | undefined): number | null {
  return latestAssessment(assessments)?.health_score ?? null;
}

/** When the plant was last assessed — the watering math's anchor of last
 * resort for a plant that has never been logged as watered (watering.ts). */
export function latestAssessedAt(
  assessments: AssessmentScoreRow[] | null | undefined,
): string | null {
  return latestAssessment(assessments)?.created_at ?? null;
}

/** Trend chip for the plant card, from the latest assessment's comparison
 * delta (web AssessmentTimeline badge wording). A latest assessment with no
 * comparison had nothing prior to compare — "First assessment". */
export function latestTrend(assessments: AssessmentScoreRow[] | null | undefined): string | null {
  const latest = latestAssessment(assessments);
  if (!latest) return null;
  const delta = comparisonDelta(latest.diagnosis);
  if (!delta) return "First assessment";
  return delta.charAt(0).toUpperCase() + delta.slice(1);
}

export function mapPlantRows(rows: PlantRow[] | null | undefined): PlantListItem[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    plantType: row.plant_type,
    species: row.species,
    subLabel: plantSubLabel(row),
    latestScore: latestScore(row.assessments),
    trend: latestTrend(row.assessments),
    createdAt: row.created_at,
    location: row.location,
    zipCode: row.zip_code ?? null,
    // Stored jsonb is untrusted: a profile that no longer parses means "no
    // watering guidance for this plant", never bad math on a bad baseline.
    careProfile: parseStoredCareProfile(row.care_profile),
    lastAssessedAt: latestAssessedAt(row.assessments),
    coverAssessmentId: row.cover_assessment_id ?? null,
    coverUri: null,
  }));
}

/** Join each card to its photo (same shape as plant-detail's attachLocalPhotos):
 * the cover assessment's photo when this phone has it, else the plant's newest
 * photo — pre-cover rows and restores land there — else null for the
 * placeholder. Pure; a plant is never shown another plant's picture. */
export function attachCoverPhotos(items: PlantListItem[], index: PhotoIndex): PlantListItem[] {
  return items.map((item) => {
    const cover = item.coverAssessmentId
      ? photoForAssessment(index, item.coverAssessmentId)
      : null;
    const fallback =
      cover ??
      photosForPlant(index, item.id).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      )[0] ??
      null;
    return { ...item, coverUri: fallback?.localUri ?? null };
  });
}

export interface GardenTrend {
  improving: number;
  /** Plants with a real directional trend (Better/Same/Worse — >= 2 assessments). */
  compared: number;
  line: string;
}

/**
 * #3 — the north star made visible, phrased so a healthy garden never reads
 * as failure (designer finding: "0 of 2 improving" punished stability):
 * decline is named when present, all-steady is celebrated, and Unknown is not
 * a trend. Null until at least one plant has a real trend.
 */
export function gardenTrend(items: PlantListItem[]): GardenTrend | null {
  const compared = items.filter(
    (item) => item.trend === "Better" || item.trend === "Same" || item.trend === "Worse",
  );
  if (compared.length === 0) return null;
  const improving = compared.filter((item) => item.trend === "Better").length;
  const declining = compared.filter((item) => item.trend === "Worse").length;
  const noun = compared.length === 1 ? "plant" : "plants";

  let line: string;
  if (improving > 0 && declining > 0) {
    line = `${improving} improving · ${declining} getting worse`;
  } else if (declining > 0) {
    line = `${declining} of ${compared.length} ${noun} getting worse`;
  } else if (improving === 0) {
    line = `All ${compared.length} ${noun} holding steady`;
  } else {
    line = `${improving} of ${compared.length} ${noun} improving`;
  }
  return { improving, compared: compared.length, line };
}
