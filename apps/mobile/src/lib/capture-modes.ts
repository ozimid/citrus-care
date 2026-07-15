// The three capture modes from the native design doc §6 (competitor/model
// research 2026-07-14): leaf close-up is the default because disease models
// and the 1600px pipeline need lesion detail; whole-plant exists for vigor
// tracking; cut mirrors the web pruning-cut toggle. Pure module (tested);
// the viewfinder overlay shapes live in CaptureScreen.

export type CaptureModeKey = "leaf" | "plant" | "cut";

export interface CaptureMode {
  key: CaptureModeKey;
  label: string;
  hint: string;
  /** Overlay guide the viewfinder draws for this mode. */
  guide: "leaf-ellipse" | "plant-frame" | "cut-circle";
}

export const CAPTURE_MODES: CaptureMode[] = [
  {
    key: "leaf",
    label: "Leaf",
    hint: "Get close — fill the outline with the affected leaf",
    guide: "leaf-ellipse",
  },
  {
    key: "plant",
    label: "Whole plant",
    hint: "Step back — fit the whole plant in the frame",
    guide: "plant-frame",
  },
  {
    key: "cut",
    label: "Cut",
    hint: "Frame the fresh cut end inside the circle",
    guide: "cut-circle",
  },
];

export const DEFAULT_CAPTURE_MODE: CaptureModeKey = "leaf";

export function captureMode(key: CaptureModeKey): CaptureMode {
  // CAPTURE_MODES covers every CaptureModeKey, so the lookup always hits.
  return CAPTURE_MODES.find((m) => m.key === key) as CaptureMode;
}

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
