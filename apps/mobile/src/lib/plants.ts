// Plants list data access + pure row mapping. The mapping half is unit-tested
// (plants.test.ts); fetchPlants is a thin query kept in sync with the web list
// page (apps/web/app/plants/page.tsx). RLS scopes rows to the signed-in user.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Assessment, Plant } from "@citrus/shared";

export type AssessmentScoreRow = Pick<Assessment, "health_score" | "created_at">;

/** The columns PLANTS_SELECT pulls, tied to the shared Plant/Assessment types
 * so schema drift shows up as a compile error. */
export type PlantRow = Pick<
  Plant,
  "id" | "name" | "plant_type" | "species" | "cultivar" | "location" | "created_at"
> & {
  assessments?: AssessmentScoreRow[] | null;
};

export interface PlantListItem {
  id: string;
  name: string;
  subLabel: string;
  latestScore: number | null;
  createdAt: string;
}

export const PLANTS_SELECT =
  "id,name,plant_type,species,cultivar,location,created_at,assessments!plant_id(health_score,created_at)";

/** Mirrors the web PlantCard sub-label: Type · species · cultivar (or "Unknown cultivar") · location. */
export function plantSubLabel(row: PlantRow): string {
  const typeLabel = row.plant_type
    ? row.plant_type.charAt(0).toUpperCase() + row.plant_type.slice(1)
    : "";
  return [typeLabel, row.species, row.cultivar ?? "Unknown cultivar", row.location]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" · ");
}

export function latestScore(assessments: AssessmentScoreRow[] | null | undefined): number | null {
  if (!assessments || assessments.length === 0) return null;
  let latest = assessments[0];
  for (const a of assessments) {
    if (a.created_at > latest.created_at) latest = a;
  }
  return latest.health_score;
}

export function mapPlantRows(rows: PlantRow[] | null | undefined): PlantListItem[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    subLabel: plantSubLabel(row),
    latestScore: latestScore(row.assessments),
    createdAt: row.created_at,
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
