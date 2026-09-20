// Pure helpers for the capture flow. The three capture modes that used to live
// here (leaf / whole plant / cut, design doc §6) are gone: F21 removed the
// selector, because pre-classifying a photo for a vision model is backwards
// and the label conditioned the prompt into false "poor quality" verdicts.
// What survives is the photo-quality nudge the capture research earned —
// closer is better — now stated once, for every shot.

import { normalizeTag, numericTagOrder } from "./plant-tags";
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

/** F39 D-W7: walk mode is a remembered, visibly checked viewfinder toggle
 * (default off). The -io half reads/writes this key; reads degrade to off. */
export const WALK_MODE_KEY = "citrus.capture-walk.v1";

// F39 (Garden Walk): the plant picker in the review screen gains a search
// field. Numeric-aware ordering, because a garden of numbered trees is browsed
// as "L2, L3, L10" — the way the tags read on the stakes — not "L10, L2, L3".

const byNumericName = (a: PlantListItem, b: PlantListItem) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Plants matching `query`, ranked for a garden of numbered stakes (D-W4, the
 * tag is co-primary): an exact tag match first, then plants whose tag starts
 * with the query (numeric order — "2, 20, 21"), then the contains match on
 * name / species / sub-label / tag in numeric-aware name order. An empty
 * query lists every plant in name order. Pure. */
export function filterPlantsByQuery(items: PlantListItem[], query: string): PlantListItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items].sort(byNumericName);
  const tagNeedle = normalizeTag(query);
  const exact: PlantListItem[] = [];
  const prefix: PlantListItem[] = [];
  const contains: PlantListItem[] = [];
  for (const plant of items) {
    const tag = plant.tag ?? null;
    if (tagNeedle !== null && tag === tagNeedle) exact.push(plant);
    else if (tagNeedle !== null && tag !== null && tag.startsWith(tagNeedle)) prefix.push(plant);
    else if ([plant.name, plant.species, plant.subLabel, tag].some((v) => v?.toLowerCase().includes(needle))) {
      contains.push(plant);
    }
  }
  return [...exact.sort(numericTagOrder), ...prefix.sort(numericTagOrder), ...contains.sort(byNumericName)];
}
