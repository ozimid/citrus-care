// Plants list data access + pure row mapping. The mapping half is unit-tested
// (plants.test.ts); fetchPlants is a thin query kept in sync with the web list
// page (apps/web/app/plants/page.tsx). RLS scopes rows to the signed-in user.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Assessment, CareProfile, Plant } from "@citrus/shared";
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
  /** jsonb from Postgres — untrusted until parseStoredCareProfile validates it. */
  care_profile?: unknown;
  assessments?: AssessmentScoreRow[] | null;
};

export interface PlantListItem {
  id: string;
  name: string;
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
}

export const PLANTS_SELECT =
  "id,name,plant_type,species,cultivar,location,zip_code,care_profile,created_at,assessments!plant_id(health_score,created_at,diagnosis)";

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
  }));
}

export async function fetchPlants(client: SupabaseClient): Promise<PlantListItem[]> {
  const { data, error } = await client
    .from("plants")
    .select(PLANTS_SELECT)
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "assessments", ascending: false })
    .limit(1, { referencedTable: "assessments" });

  if (error) {
    // Generic client-facing message; details stay in the console (web parity rule).
    console.error("[fetchPlants] query failed:", error.message);
    throw new Error("Could not load your plants.");
  }
  return mapPlantRows(data as unknown as PlantRow[]);
}
