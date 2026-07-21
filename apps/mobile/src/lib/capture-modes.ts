// Pure helpers for the capture flow. The three capture modes that used to live
// here (leaf / whole plant / cut, design doc §6) are gone: F21 removed the
// selector, because pre-classifying a photo for a vision model is backwards
// and the label conditioned the prompt into false "poor quality" verdicts.
// What survives is the photo-quality nudge the capture research earned —
// closer is better — now stated once, for every shot.

/** The one viewfinder hint. It asks for a good photo without asking the user
 * what the photo is; the model decides that (diagnosis.subject). */
export const CAPTURE_HINT = "Get close to the sick part in good light — the whole photo is analyzed, nothing gets cropped";

/** The FAB needs a target plant: an explicitly requested plant wins (the
 * detail screen's "Assess this plant"), then the forced choice when there is
 * exactly one plant; otherwise the user picks in the selector sheet. */
export function preselectedPlantId(
  plants: ReadonlyArray<{ id: string }>,
  preferredId?: string | null,
): string | null {
  if (preferredId && plants.some((p) => p.id === preferredId)) return preferredId;
  return plants.length === 1 ? plants[0].id : null;
}
