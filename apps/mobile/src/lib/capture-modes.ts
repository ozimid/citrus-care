// Pure helpers for the capture flow. The three capture modes that used to live
// here (leaf / whole plant / cut, design doc §6) are gone: F21 removed the
// selector, because pre-classifying a photo for a vision model is backwards
// and the label conditioned the prompt into false "poor quality" verdicts.
// What survives is the photo-quality nudge the capture research earned —
// closer is better — now stated once, for every shot.

import type { PlantListItem } from "./plants";

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

// F36: the one-time photo guide (competitor-inspired "Snap Tips", filtered to
// what actually helps OUR model — one photo, on-device, full frame).
export interface SnapTip {
  glyph: string;
  title: string;
  body: string;
}

export const SNAP_TIPS: SnapTip[] = [
  {
    glyph: "🔍",
    title: "Get close",
    body: "Fill the photo with the sick part — a leaf, a branch, a cut. Closer detail means a better diagnosis.",
  },
  {
    glyph: "☀️",
    title: "Good light",
    body: "Bright, even light works best — daylight beats lamps. Avoid harsh shadows across the plant.",
  },
  {
    glyph: "🖼️",
    title: "The whole photo counts",
    body: "Everything in the frame is analyzed — nothing gets cropped. Keep the phone steady and the plant in focus.",
  },
];

export const SNAP_TIPS_SEEN_KEY = "citrus.snap-tips-seen.v1";

// F39 (Garden Walk): the plant picker in the review screen gains a search
// field. Numeric-aware ordering, because a garden of numbered trees is browsed
// as "L2, L3, L10" — the way the tags read on the stakes — not "L10, L2, L3".

/** Plants matching `query` on name, species or sub-label (case-insensitive),
 * in numeric-aware name order; an empty query lists every plant. Pure. */
export function filterPlantsByQuery(items: PlantListItem[], query: string): PlantListItem[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? items.filter((plant) => [plant.name, plant.species, plant.subLabel].some((v) => v?.toLowerCase().includes(needle)))
    : [...items];
  return matches.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}
