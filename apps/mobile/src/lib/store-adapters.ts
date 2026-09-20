// D-17 store → mapper adapters (pure). The list/detail mappers (mapPlantRows,
// mapTimelineRows) were written against PostgREST nested-join / row shapes and
// are well-tested; rather than rewrite them for the local flat store, these
// adapters reconstruct exactly the shapes they consume. So the mappers — and
// their ~500 lines of passing tests — stay verbatim, and only these thin,
// tested reshapers are new.

import type { AssessmentScoreRow, PlantRow } from "./plants";
import type { PlantDetailRow, TimelineRow } from "./plant-detail";
import { byCreatedAtDesc, type StoredAssessment } from "./assessment-store";
import type { StoredPlant } from "./plant-store";

function scoreRow(assessment: StoredAssessment): AssessmentScoreRow {
  return {
    health_score: assessment.diagnosis.health_score,
    created_at: assessment.createdAt,
    diagnosis: assessment.diagnosis,
  };
}

/** Attach each plant's assessments (as the score-row subset the list mapper
 * reads) so mapPlantRows can derive latest score / trend / last-assessed. */
export function plantRowsFromStore(plants: StoredPlant[], assessments: StoredAssessment[]): PlantRow[] {
  const byPlant = new Map<string, AssessmentScoreRow[]>();
  for (const assessment of assessments) {
    const list = byPlant.get(assessment.plantId) ?? [];
    list.push(scoreRow(assessment));
    byPlant.set(assessment.plantId, list);
  }
  return plants.map((plant) => ({
    id: plant.id,
    name: plant.name,
    plant_type: plant.plant_type,
    species: plant.species,
    cultivar: plant.cultivar,
    location: plant.location,
    zip_code: plant.zip_code,
    cover_assessment_id: plant.cover_assessment_id,
    care_profile: plant.care_profile,
    created_at: plant.created_at,
    assessments: byPlant.get(plant.id) ?? [],
    // F39 (D-W4): defaults for pre-F39 plants, so the mapper sees one shape.
    tag: plant.tag ?? null,
    codes: plant.codes ?? [],
    tag_missing: plant.tag_missing === true,
    // Phase 3b: zone grouping + walk order for the list and the viewfinder.
    zone: plant.zone ?? null,
    walk_order: plant.walk_order ?? null,
  }));
}

/** The plant header row (no assessments — the timeline is fetched separately).
 * Phase 3b adds zone + walk_order on top of the detail row so the edit sheet
 * can prefill the zone (formFromPlant) — without them the sheet leaves the
 * stored zone untouched, so an older caller is safe either way. */
export function plantDetailRowFromStore(
  plant: StoredPlant,
): PlantDetailRow & { zone: string | null; walk_order: number | null } {
  return {
    id: plant.id,
    name: plant.name,
    plant_type: plant.plant_type,
    species: plant.species,
    cultivar: plant.cultivar,
    location: plant.location,
    zip_code: plant.zip_code,
    care_profile: plant.care_profile,
    created_at: plant.created_at,
    // F39 (D-W4): everything PlantTagsCard shows and edits.
    tag: plant.tag ?? null,
    codes: plant.codes ?? [],
    tag_photo: plant.tag_photo ?? null,
    tag_missing: plant.tag_missing === true,
    zone: plant.zone ?? null,
    walk_order: plant.walk_order ?? null,
  };
}

/** A plant's timeline rows, newest-first (mapTimelineRows treats the last row
 * as the earliest), with health_score / is_cut_care derived from the diagnosis
 * (F21: the cut split is the model's own subject). Sorted by the store's own
 * comparator so a same-second pair reads in the same order the anchor and
 * cover logic resolved it. */
export function timelineRowsFromStore(assessments: StoredAssessment[], plantId: string): TimelineRow[] {
  return assessments
    .filter((a) => a.plantId === plantId)
    .sort(byCreatedAtDesc)
    .map((assessment) => ({
      id: assessment.id,
      created_at: assessment.createdAt,
      health_score: assessment.diagnosis.health_score,
      diagnosis: assessment.diagnosis,
      is_cut_care: assessment.diagnosis.subject === "cut",
    }));
}
