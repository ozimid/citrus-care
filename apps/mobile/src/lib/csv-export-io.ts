// F39 Phase 6c — CSV export, IO half: read the on-device stores, build the
// rows the pure plantsToCsv writes, save the sheet to the app cache and hand
// it to the share sheet (the backup-io pattern). Thin, untested by policy.
//
// The last-assessed date and score come through the SAME tested mapper path
// the Plants list uses (store-adapters → mapPlantRows), so the sheet and the
// list can never disagree about "last assessed" — and a change to how an
// assessment is dated (Phase 5's photo-time dating) reaches both at once.
// Nothing here is a restore path: the JSON backup is. Nothing leaves the app
// except through the share sheet the user opens (D-17).

import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { assessmentsForPlant, allAssessments } from "./assessment-store";
import { loadAssessmentStore } from "./assessment-store-io";
import { plantsToCsv, sortForSpreadsheet, type CsvPlantRow } from "./csv-export";
import { photosForPlant } from "./photo-store";
import { loadPhotoIndex } from "./photo-store-io";
import { allPlants } from "./plant-store";
import { loadPlantStore } from "./plant-store-io";
import { mapPlantRows } from "./plants";
import { plantRowsFromStore } from "./store-adapters";

export interface CsvExportOutcome {
  /** False when the platform has no share target — nothing left the app; the
   * sheet still sits in the app cache. */
  shared: boolean;
  /** Rows written (one per plant). */
  plants: number;
}

/** Build the spreadsheet from the stores + photo index, write
 * citrus-care-plants-YYYY-MM-DD.csv to the cache dir and open the share sheet
 * so the user can save it wherever they keep files. */
export async function exportPlantsCsv(now: Date = new Date()): Promise<CsvExportOutcome> {
  const [plantStore, assessmentStore, photoIndex] = await Promise.all([
    loadPlantStore(),
    loadAssessmentStore(),
    loadPhotoIndex(),
  ]);
  const plants = allPlants(plantStore);
  const items = mapPlantRows(plantRowsFromStore(plants, allAssessments(assessmentStore)));
  const byId = new Map(items.map((item) => [item.id, item]));

  const rows: CsvPlantRow[] = plants.map((plant) => {
    const item = byId.get(plant.id);
    return {
      plant,
      lastAssessedAt: item?.lastAssessedAt ?? null,
      lastScore: item?.latestScore ?? null,
      assessments: assessmentsForPlant(assessmentStore, plant.id).length,
      photos: photosForPlant(photoIndex, plant.id).length,
    };
  });

  const file = new File(Paths.cache, `citrus-care-plants-${now.toISOString().slice(0, 10)}.csv`);
  if (file.exists) file.delete();
  file.create();
  file.write(plantsToCsv(sortForSpreadsheet(rows)));

  if (!(await Sharing.isAvailableAsync())) {
    return { shared: false, plants: rows.length };
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/csv",
    dialogTitle: "Save your plants spreadsheet",
  });
  return { shared: true, plants: rows.length };
}
